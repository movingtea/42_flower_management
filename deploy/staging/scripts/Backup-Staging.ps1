# Flower WMS Sprint E2.3 · staging 自动备份
#
# 用途：对显式目标（本 staging 项目的 V1/V2 库）执行分库 pg_dump -Fc，校验后才登记为恢复候选，
# 并按保留策略清理旧成功备份；失败产物隔离到 failed/，退出非零且不删除上一份有效备份。
#
# 用法：
#   pwsh -File deploy/staging/scripts/Backup-Staging.ps1 -Label manual
#   pwsh -File deploy/staging/scripts/Backup-Staging.ps1 -Label predeploy -Retention 5
#
# 输出：deploy/staging/.runtime/backup/<UTC>-<label>/（gitignore）
# 证据：docs/evidence/sprint-e2/logs/e23-backup-<run_id>.log
#
# 安全：只通过本 staging 项目的 db 容器执行；不接受任意连接串；不触碰其他数据库实例。

param(
  [ValidateSet('manual', 'predeploy', 'scheduled')]
  [string]$Label = 'manual',
  [int]$Retention = 5,
  [string]$Image
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Staging.Common.ps1')

Initialize-StagingContext -Mode Baseline -Image $Image
$script:Cfg.Image = Resolve-StagingImage
$env:STAGING_IMAGE = $script:Cfg.Image
Start-EvidenceRun -Mode "backup-$Label"
Start-EvidenceLog -Name 'backup' -Title "E2.3 staging 备份（label=$Label）" -Package '3' | Out-Null
Initialize-StagingRuntime

$utc = (Get-Date).ToUniversalTime()
$ts = $utc.ToString('yyyyMMddTHHmmssZ')
$setName = "$ts-$Label"
$hostSetDir = Join-Path $script:BackupDir $setName
$containerSetDir = "/backup/$setName"
$failedDir = Join-Path $script:BackupDir 'failed'
New-Item -ItemType Directory -Force -Path $hostSetDir | Out-Null

Add-EvidenceSection "备份集 $setName"
Add-Evidence "  source_utc: $($utc.ToString('o'))"
Add-Evidence "  source_sha: $((git -C $script:RepoRoot rev-parse HEAD).Trim())"
Add-Evidence "  project: $($script:Cfg.Project)  image: $($script:Cfg.Image)"

$serverVersion = (Invoke-StagingCompose -Arguments @('exec', '-T', 'db', 'psql', '-U', $script:Cfg.DbUser, '-d', $script:Cfg.V1Db, '-t', '-A', '-c', 'SHOW server_version')).Output.Trim()
Add-Evidence "  source_server_version: $serverVersion"

$files = @()
$failed = $false

foreach ($db in @(
    [pscustomobject]@{ Role = 'v1'; Name = $script:Cfg.V1Db },
    [pscustomobject]@{ Role = 'v2'; Name = $script:Cfg.V2Db }
  )) {
  $fileRel = "$($db.Role)-$ts.dump"
  $hostFile = Join-Path $hostSetDir $fileRel
  $containerFile = "$containerSetDir/$fileRel"
  Add-EvidenceSection "备份 $($db.Role)：$($db.Name)"

  $identity = (Invoke-StagingCompose -Arguments @('exec', '-T', 'db', 'psql', '-U', $script:Cfg.DbUser, '-d', $db.Name, '-t', '-A', '-c', 'SELECT current_database()')).Output.Trim()
  if ($identity -ne $db.Name) { throw "备份目标校验失败：期望 $($db.Name)，实际 $identity" }

  $dump = Invoke-StagingCompose -Arguments @(
    'exec', '-T', 'db', 'pg_dump', '-U', $script:Cfg.DbUser, '-Fc', '-d', $db.Name, '-f', $containerFile
  ) -AllowExitCodes @(0, 1) -NoThrow
  if ($dump.ExitCode -ne 0) {
    Add-Evidence "  [FAIL] pg_dump exit=$($dump.ExitCode)"
    $failed = $true
    continue
  }

  if (-not (Test-Path $hostFile) -or ((Get-Item $hostFile).Length -le 0)) {
    Add-Evidence '  [FAIL] 备份文件缺失或为空'
    $failed = $true
    continue
  }
  $sha = (Get-FileHash -Algorithm SHA256 -Path $hostFile).Hash.ToLowerInvariant()
  $size = (Get-Item $hostFile).Length
  Add-Evidence "  file: $fileRel  size=$size  sha256=$sha"

  # 结构校验：pg_restore --list 可读
  $list = Invoke-StagingCompose -Arguments @('exec', '-T', 'db', 'pg_restore', '--list', $containerFile) -AllowExitCodes @(0, 1) -NoThrow
  $structureOk = ($list.ExitCode -eq 0) -and ($list.Output -match 'Archive created|;')
  Add-Evidence "  pg_restore --list exit=$($list.ExitCode) structure_ok=$structureOk"
  if (-not $structureOk) { $failed = $true }

  $files += [pscustomobject]@{
    role = $db.Role
    database = $db.Name
    file = $fileRel
    sizeBytes = $size
    sha256 = $sha
    structureOk = $structureOk
  }
}

Add-EvidenceSection '备份时关键表行数基线（供恢复后比对）'
$counts = [ordered]@{}
foreach ($db in @(
    [pscustomobject]@{ Role = 'v1'; Name = $script:Cfg.V1Db; Sql = 'v1-row-counts.sql' },
    [pscustomobject]@{ Role = 'v2'; Name = $script:Cfg.V2Db; Sql = 'v2-row-counts.sql' }
  )) {
  $sqlFile = Join-Path $script:ChecksDir $db.Sql
  $table = Get-StagingRowCounts -Database $db.Name -SqlFile $sqlFile
  $counts[$db.Role] = $table
  Add-Evidence "  $($db.Role) migration_applied=$($table['_prisma_migrations_applied'])"
}

$manifest = [pscustomobject]@{
  runId = $script:RunStamp
  label = $Label
  set = $setName
  sourceUtc = $utc.ToString('o')
  sourceSha = (git -C $script:RepoRoot rev-parse HEAD).Trim()
  sourceServerVersion = $serverVersion
  project = $script:Cfg.Project
  image = $script:Cfg.Image
  status = if ($failed) { 'failed' } else { 'success' }
  files = $files
  counts = $counts
}
$manifestPath = Join-Path $hostSetDir 'manifest.json'
$manifest | ConvertTo-Json -Depth 6 | Set-Content -Path $manifestPath -Encoding utf8NoBOM

if ($failed) {
  Add-EvidenceSection '备份失败处理'
  New-Item -ItemType Directory -Force -Path $failedDir | Out-Null
  $target = Join-Path $failedDir $setName
  Move-Item -Path $hostSetDir -Destination $target -Force
  Add-Evidence "  [FAIL] 备份集已移入 failed/: $target；上一份有效备份保留"
  Stop-EvidenceLog
  Write-Error "备份失败：$setName（已隔离，退出非零）"
  exit 1
}

Add-EvidenceSection '保留策略'
$successful = @(Get-ChildItem -Path $script:BackupDir -Directory -ErrorAction SilentlyContinue |
  Where-Object { $_.Name -ne 'failed' -and (Test-Path (Join-Path $_.FullName 'manifest.json')) } |
  Sort-Object Name -Descending)
$keep = @($successful | Select-Object -First $Retention)
$prune = @($successful | Select-Object -Skip $Retention)
foreach ($k in $keep) { Add-Evidence "  keep: $($k.Name)" }
foreach ($p in $prune) {
  Remove-Item -Recurse -Force $p.FullName
  Add-Evidence "  prune: $($p.Name)（仅在新备份校验通过后清理）"
}

Add-EvidenceSection '备份完成'
Add-Evidence "  backup_set: $setName"
Add-Evidence "  host_path: deploy/staging/.runtime/backup/$setName"
Add-Evidence "  manifest: manifest.json"
Add-Evidence "  status: success  files=$($files.Count)"
Stop-EvidenceLog
Write-Host "BACKUP_OK $setName"
exit 0


