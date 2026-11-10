# Flower WMS Sprint E2.3 · staging 独立恢复
#
# 用途：把已验证的备份恢复到一个**本次新建的隔离库**，核对迁移历史/关键表行数/代表性不变量，
# 记录备份与恢复耗时和实际恢复点；清理仅限本次创建的资源。
#
# 用法：
#   pwsh -File deploy/staging/scripts/Restore-Staging.ps1 `
#     -Archive deploy/staging/.runtime/backup/<set>/v2-<ts>.dump `
#     -TargetDatabase flower_e2_restore_20261110T140000Z `
#     -ConfirmNewTarget
#
# 安全：目标库必须匹配 flower_e2_restore_* 且不存在；只通过本 staging 项目 db 容器执行；
# 拒绝任意连接串/端口，拒绝生产、开发与 staging 基线库名。

param(
  [Parameter(Mandatory)][string]$Archive,
  [Parameter(Mandatory)][string]$TargetDatabase,
  [switch]$ConfirmNewTarget,
  [switch]$KeepTarget,
  [string]$Image
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Staging.Common.ps1')

Initialize-StagingContext -Mode Baseline -Image $Image
$script:Cfg.Image = Resolve-StagingImage
$env:STAGING_IMAGE = $script:Cfg.Image
Start-EvidenceRun -Mode 'restore'
Start-EvidenceLog -Name 'restore' -Title 'E2.3 staging 独立恢复' -Package '3' | Out-Null
Initialize-StagingRuntime

if (-not $ConfirmNewTarget) { throw '恢复必须显式 -ConfirmNewTarget' }
if ($TargetDatabase -notmatch '^flower_e2_restore_[a-z0-9_]+$') {
  throw "目标库名必须以 flower_e2_restore_ 开头且仅含小写字母/数字/下划线：$TargetDatabase"
}
$denied = @(
  'flower_hub_prod', 'flower_v2_prod', 'flower_e2_v1', 'flower_e2_v2_test',
  'flower_e2_verify_v1', 'flower_e2_verify_v2_test', 'flower_v2_test', 'postgres'
)
if ($denied -contains $TargetDatabase) { throw "拒绝恢复到受保护库名：$TargetDatabase" }

$backupRoot = (Resolve-Path $script:BackupDir).Path
$archivePath = (Resolve-Path $Archive).Path
if (-not $archivePath.StartsWith($backupRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
  throw "备份文件必须位于 deploy/staging/.runtime/backup 下：$archivePath"
}
$rel = [System.IO.Path]::GetRelativePath($backupRoot, $archivePath) -replace '\\', '/'
$containerArchive = "/backup/$rel"
$manifestPath = Join-Path (Split-Path $archivePath -Parent) 'manifest.json'
$manifest = $null
if (Test-Path $manifestPath) { $manifest = Get-Content $manifestPath -Raw | ConvertFrom-Json }
$fileName = Split-Path $archivePath -Leaf
$role = if ($fileName -like 'v2-*') { 'v2' } elseif ($fileName -like 'v1-*') { 'v1' } else { throw "无法从文件名判断 V1/V2：$fileName" }
$checksFile = if ($role -eq 'v2') { 'v2-row-counts.sql' } else { 'v1-row-counts.sql' }
$expectedMigrations = if ($role -eq 'v2') { 8 } else { 45 }

Add-EvidenceSection '恢复前校验'
Add-Evidence "  archive: deploy/staging/.runtime/backup/$rel"
Add-Evidence "  role: $role  target: $TargetDatabase  keep_target: $([bool]$KeepTarget)"
$sha = (Get-FileHash -Algorithm SHA256 -Path $archivePath).Hash.ToLowerInvariant()
Add-Evidence "  archive_sha256: $sha"

$exists = (Invoke-StagingCompose -Arguments @(
  'exec', '-T', 'db', 'psql', '-U', $script:Cfg.DbUser, '-d', $script:Cfg.V1Db, '-t', '-A', '-c',
  "SELECT count(*) FROM pg_database WHERE datname = '$TargetDatabase'"
)).Output.Trim()
if ($exists -ne '0') { throw "目标库已存在，拒绝覆盖：$TargetDatabase" }
Add-Evidence '  [OK] 目标库不存在（由本脚本新建）'

$utc = (Get-Date).ToUniversalTime()
$restoreStart = Get-Date
Add-EvidenceSection '创建目标库并恢复'
$create = Invoke-StagingCompose -Arguments @('exec', '-T', 'db', 'createdb', '-U', $script:Cfg.DbUser, $TargetDatabase) -AllowExitCodes @(0, 1) -NoThrow
if ($create.ExitCode -ne 0) { throw "创建目标库失败（exit $($create.ExitCode)）" }

$restore = Invoke-StagingCompose -Arguments @(
  'exec', '-T', 'db', 'pg_restore', '-U', $script:Cfg.DbUser, '-d', $TargetDatabase, '--no-owner', '--no-privileges', $containerArchive
) -AllowExitCodes @(0, 1) -NoThrow
if ($restore.ExitCode -ne 0) {
  Add-Evidence "  [FAIL] pg_restore exit=$($restore.ExitCode)；保留目标库用于定位（不自动删除）"
  Stop-EvidenceLog
  Write-Error "恢复失败（exit $($restore.ExitCode)）；目标库保留：$TargetDatabase"
  exit 1
}
$restoreSeconds = [math]::Round(((Get-Date) - $restoreStart).TotalSeconds, 2)
Add-Evidence "  pg_restore 完成，耗时 ${restoreSeconds}s"

Add-EvidenceSection '恢复后核对'
$counts = Get-StagingRowCounts -Database $TargetDatabase -SqlFile (Join-Path $script:ChecksDir $checksFile)
$applied = [long]$counts['_prisma_migrations_applied']
Add-Evidence "  migration_applied=$applied（期望 $expectedMigrations）"
if ($applied -ne $expectedMigrations) { throw "迁移历史不一致：$applied != $expectedMigrations" }

$mismatch = @()
if ($manifest -and $manifest.counts -and $manifest.counts.$role) {
  $before = $manifest.counts.$role
  foreach ($key in $before.PSObject.Properties.Name) {
    $expected = [long]$before.$key
    $actual = if ($counts.Contains($key)) { [long]$counts[$key] } else { $null }
    if ($null -eq $actual) { $mismatch += "$key missing"; continue }
    if ($actual -ne $expected) { $mismatch += "${key}: $expected -> $actual" }
    Add-Evidence "  compare ${key}: $actual"
  }
} else {
  Add-Evidence '  [WARN] manifest 缺少行数基线，仅记录恢复后行数'
}
if ($mismatch.Count -gt 0) { throw "恢复后行数不一致：$($mismatch -join '; ')" }

$actualRestorePoint = if ($manifest) { $manifest.sourceUtc } else { 'unknown（manifest 缺失）' }
Add-Evidence "  actual_restore_point: $actualRestorePoint"
Add-Evidence "  backup_set: $(if ($manifest) { $manifest.set } else { 'unknown' })"
Add-Evidence "  restore_started_utc: $($utc.ToString('o'))"
Add-Evidence "  restore_seconds: $restoreSeconds"

$result = [pscustomobject]@{
  runId = $script:RunStamp
  archive = $rel
  role = $role
  target = $TargetDatabase
  sha256 = $sha
  restoreSeconds = $restoreSeconds
  actualRestorePoint = $actualRestorePoint
  migrationApplied = $applied
  counts = $counts
  keepTarget = [bool]$KeepTarget
}
$resultPath = Join-Path (Split-Path $script:CurrentLog) ("e23-restore-result-{0}.json" -f $script:RunStamp)
$result | ConvertTo-Json -Depth 6 | Set-Content -Path $resultPath -Encoding utf8NoBOM
Add-Evidence "  result: docs/evidence/sprint-e2/logs/$(Split-Path $resultPath -Leaf)"

Add-EvidenceSection '清理（仅本次创建的恢复库）'
if ($KeepTarget) {
  Add-Evidence "  -KeepTarget：保留 $TargetDatabase 供人工检查"
} else {
  $drop = Invoke-StagingCompose -Arguments @('exec', '-T', 'db', 'dropdb', '--if-exists', '-U', $script:Cfg.DbUser, $TargetDatabase) -AllowExitCodes @(0, 1) -NoThrow
  Add-Evidence "  dropdb exit=$($drop.ExitCode)"
}
Stop-EvidenceLog
Write-Host "RESTORE_OK target=$TargetDatabase role=$role seconds=$restoreSeconds"
exit 0


