# Flower WMS Sprint E2.4（E2.2 依赖）· staging 迁移前后验证（preflight / post）
#
# 退出码：
#   0 = 通过
#   2 = 连通性/目标错误
#   3 = 非预期迁移历史（数据库超前/落后、_prisma_migrations 异常）
#   4 = 迁移执行失败/未完成
#   5 = 迁移后核对失败
#
# 用法：
#   pwsh -File deploy/staging/scripts/Test-StagingMigration.ps1 -Mode preflight
#   pwsh -File deploy/staging/scripts/Test-StagingMigration.ps1 -Mode post
#
# 说明：本文件是 E2.4 的最小实现（E2.2 集成所需）；空库/增量/失败注入等完整场景在 E2.4 批次扩展。

param(
  [ValidateSet('preflight', 'post')]
  [string]$Mode = 'preflight',
  [ValidateSet('Baseline', 'Verify')]
  [string]$ContextMode = 'Baseline',
  [string]$Image,
  [string]$ExpectedPending
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Staging.Common.ps1')

Initialize-StagingContext -Mode $ContextMode -Image $Image
$script:Cfg.Image = Resolve-StagingImage
$env:STAGING_IMAGE = $script:Cfg.Image
Start-EvidenceRun -Mode "migration-$Mode"
Start-EvidenceLog -Name "migration-$Mode" -Title "E2.4 迁移$Mode 检查" -Package '4' | Out-Null

function Get-ImageMigrationList {
  $r = Invoke-StagingCompose -Arguments @('run', '--rm', '--no-deps', '--entrypoint', 'sh', 'flower-web', '-ec', 'ls prisma/v2/migrations | sort') -AllowExitCodes @(0, 1) -NoThrow
  if ($r.ExitCode -ne 0) { return $null }
  return @($r.Output -split "`r?`n" | Where-Object { $_ -match '^\d{4}_' })
}

function Get-AppliedMigrations([string]$Db) {
  $r = Invoke-StagingCompose -Arguments @('exec', '-T', 'db', 'psql', '-U', $script:Cfg.DbUser, '-d', $Db, '-t', '-A', '-c', 'SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL ORDER BY migration_name') -AllowExitCodes @(0, 1) -NoThrow
  return @($r.Output -split "`r?`n" | Where-Object { $_ })
}

Add-EvidenceSection '连通性/目标预检'
$pre = Invoke-StagingCompose -Arguments @('run', '--rm', '--no-deps', '--entrypoint', 'sh', 'flower-web', '-ec', 'node scripts/check-v2-database-target.mjs --connect') -AllowExitCodes @(0, 1) -NoThrow
if ($pre.ExitCode -ne 0) {
  Add-Evidence "  [FAIL] --connect 预检 exit=$($pre.ExitCode)"
  Stop-EvidenceLog
  Write-Host '[exit 2] 数据库目标/连通性错误'
  exit 2
}
Add-Evidence '  [OK] V1/V2 目标可连接且库名不同'

Add-EvidenceSection '迁移历史与待应用清单'
$imageList = Get-ImageMigrationList
if ($null -eq $imageList -or $imageList.Count -eq 0) {
  Add-Evidence '  [FAIL] 无法读取镜像内 V2 迁移清单'
  Stop-EvidenceLog
  Write-Host '[exit 4] 无法读取镜像内迁移清单'
  exit 4
}
$applied = Get-AppliedMigrations -Db $script:Cfg.V2Db
$pending = @($imageList | Where-Object { $applied -notcontains $_ })
$unexpected = @($applied | Where-Object { $imageList -notcontains $_ })
Add-Evidence "  image_migrations=$($imageList.Count) applied=$($applied.Count) pending=$($pending.Count) unexpected=$($unexpected.Count)"
foreach ($p in $pending) { Add-Evidence "  pending: $p" }
foreach ($u in $unexpected) { Add-Evidence "  unexpected: $u" }

if ($unexpected.Count -gt 0) {
  Add-Evidence '  [FAIL] 数据库存在镜像外的迁移历史（非预期历史）'
  Stop-EvidenceLog
  Write-Host '[exit 3] 非预期迁移历史'
  exit 3
}

if ($ExpectedPending) {
  $expected = @($ExpectedPending -split ',' | ForEach-Object { $_.Trim() } | Where-Object { $_ })
  $diff = @($pending | Where-Object { $expected -notcontains $_ }) + @($expected | Where-Object { $pending -notcontains $_ })
  if ($diff.Count -gt 0) {
    Add-Evidence "  [FAIL] 待应用清单与期望不一致：$($diff -join ', ')"
    Stop-EvidenceLog
    Write-Host '[exit 3] 待应用迁移清单与期望不一致'
    exit 3
  }
}

if ($Mode -eq 'preflight') {
  Add-EvidenceSection 'preflight 结论'
  Add-Evidence "  OK pending=$($pending.Count)（计划内待应用）"
  Stop-EvidenceLog
  Write-Host "MIGRATION_PREFLIGHT_OK pending=$($pending.Count)"
  exit 0
}

# ---------- post ----------
Add-EvidenceSection '迁移后状态'
if ($pending.Count -gt 0) {
  Add-Evidence "  [FAIL] 仍有 $($pending.Count) 个迁移未应用"
  Stop-EvidenceLog
  Write-Host '[exit 4] 迁移未完成'
  exit 4
}
$unfinished = (Invoke-StagingCompose -Arguments @('exec', '-T', 'db', 'psql', '-U', $script:Cfg.DbUser, '-d', $script:Cfg.V2Db, '-t', '-A', '-c', 'SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NULL')).Output.Trim()
if ($unfinished -ne '0') {
  Add-Evidence "  [FAIL] unfinished=$unfinished"
  Stop-EvidenceLog
  Write-Host '[exit 4] 存在未完成迁移'
  exit 4
}

$v2Status = Get-StagingMigrationStatusText -V2
Add-Evidence "  V2 migrate status: $(($v2Status -split "`r?`n" | Where-Object { $_ -match 'up to date|pending|Database schema' } | Select-Object -First 2) -join ' | ')"
$schemaLines = Invoke-StagingPsqlFile -Database $script:Cfg.V2Db -SqlFile (Join-Path $script:ChecksDir 'v2-schema-0008.sql')
$missing = @()
foreach ($line in $schemaLines) {
  if ($line -match '^(?<item>[^|]+)\|(?<value>\d+)$') {
    if ([int]$Matches['value'] -lt 1) { $missing += $Matches['item'] }
  }
}
if ($missing.Count -gt 0) {
  Add-Evidence "  [FAIL] schema 核对缺失：$($missing -join ', ')"
  Stop-EvidenceLog
  Write-Host '[exit 5] 迁移后 schema 核对失败'
  exit 5
}
$counts = Get-StagingRowCounts -Database $script:Cfg.V2Db -SqlFile (Join-Path $script:ChecksDir 'v2-row-counts.sql')
Add-Evidence "  V2 applied=$($counts['_prisma_migrations_applied']) StaffUser=$($counts['StaffUser']) Tenant=$($counts['Tenant'])"
if ([long]$counts['_prisma_migrations_applied'] -ne $imageList.Count) {
  Add-Evidence '  [FAIL] 已应用迁移数与镜像迁移清单不一致'
  Stop-EvidenceLog
  Write-Host '[exit 5] 迁移后核对失败'
  exit 5
}
Add-EvidenceSection 'post 结论'
Add-Evidence "  OK migrations=$($imageList.Count) unfinished=0 schema_ok"
Stop-EvidenceLog
Write-Host "MIGRATION_POST_OK migrations=$($imageList.Count)"
exit 0


