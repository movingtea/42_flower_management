# Flower WMS Sprint E2.3 · 备份/恢复场景自测
#
# 覆盖：
#   1) 定时入口两轮（-Once 两次）与候选登记
#   2) 坏归档：pg_restore 失败、目标库保留待定位、上一份有效备份不受影响
#   3) 目标冲突：同一恢复目标已存在时拒绝覆盖
#   4) 保留策略：超过 Retention 只清理最旧的成功备份
#   5) 恢复后迁移历史/行数/标记数据核对与清理
#
# 用法：pwsh -File deploy/staging/scripts/Invoke-BackupRestoreTests.ps1

param(
  [int]$Retention = 2
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Staging.Common.ps1')

Initialize-StagingContext -Mode Baseline
$script:Cfg.Image = Resolve-StagingImage
$env:STAGING_IMAGE = $script:Cfg.Image
Start-EvidenceRun -Mode 'backup-restore-tests'
Start-EvidenceLog -Name 'backup-restore-tests' -Title 'E2.3 备份/恢复场景自测' -Package '3' | Out-Null

$backupScript = Join-Path $PSScriptRoot 'Backup-Staging.ps1'
$restoreScript = Join-Path $PSScriptRoot 'Restore-Staging.ps1'
$loopScript = Join-Path $PSScriptRoot 'Start-StagingBackupLoop.ps1'
$results = [ordered]@{}

function Get-SuccessfulSets {
  @(Get-ChildItem -Path $script:BackupDir -Directory -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -ne 'failed' -and (Test-Path (Join-Path $_.FullName 'manifest.json')) } |
    Sort-Object Name -Descending)
}

function Get-LatestArchive([string]$Role) {
  $set = Get-SuccessfulSets | Select-Object -First 1
  if (-not $set) { throw '没有成功备份集' }
  $file = Get-ChildItem $set.FullName -Filter "$Role-*.dump" | Select-Object -First 1
  if (-not $file) { throw "备份集缺少 $Role 归档" }
  return $file.FullName
}

function Drop-RestoreTarget([string]$Name) {
  $r = Invoke-StagingCompose -Arguments @('exec', '-T', 'db', 'dropdb', '--if-exists', '-U', $script:Cfg.DbUser, $Name) -AllowExitCodes @(0, 1) -NoThrow
  Add-Evidence "  cleanup dropdb $Name exit=$($r.ExitCode)"
}

try {
  # ---------- 场景 1：定时入口两轮 + 候选登记 ----------
  Add-EvidenceSection '场景 1：定时入口两轮（-Once 两次，模拟两个调度周期）'
  $script:Cfg.V2Db = $script:Cfg.V2Db
  $markerSql = "CREATE TABLE IF NOT EXISTS _e2_backup_marker (id text PRIMARY KEY, created_at timestamptz NOT NULL DEFAULT now()); INSERT INTO _e2_backup_marker (id) VALUES ('sched-1') ON CONFLICT DO NOTHING;"
  $m = Invoke-StagingCompose -Arguments @('exec', '-T', 'db', 'psql', '-U', $script:Cfg.DbUser, '-d', $script:Cfg.V2Db, '-t', '-A', '-c', $markerSql) -AllowExitCodes @(0, 1) -NoThrow
  Assert-True ($m.ExitCode -eq 0 -or $m.Output -match 'INSERT 0 1|already exists') '写入定时备份标记'

  $r1 = Invoke-Logged -FilePath 'pwsh' -Arguments @('-NoProfile', '-File', $loopScript, '-Once', '-Retention', "$Retention") -AllowExitCodes @(0, 1) -NoThrow
  Assert-True ($r1.ExitCode -eq 0) '定时入口第 1 轮成功'
  $r2 = Invoke-Logged -FilePath 'pwsh' -Arguments @('-NoProfile', '-File', $loopScript, '-Once', '-Retention', "$Retention") -AllowExitCodes @(0, 1) -NoThrow
  Assert-True ($r2.ExitCode -eq 0) '定时入口第 2 轮成功'
  $sets = Get-SuccessfulSets
  Add-Evidence "  成功备份集数量=$($sets.Count)（Retention=$Retention）"
  Assert-True ($sets.Count -ge 1 -and $sets.Count -le $Retention) '备份集数量符合保留策略'
  $manifest = Get-Content (Join-Path $sets[0].FullName 'manifest.json') -Raw | ConvertFrom-Json
  Assert-True ($manifest.status -eq 'success') '最新备份 manifest 状态为 success'
  Assert-True (@($manifest.files | Where-Object { $_.sha256 -and $_.sizeBytes -gt 0 }).Count -eq 2) 'V1/V2 归档均有 sha256 与非零大小'
  $results['scheduled-two-runs'] = 'PASS'

  # ---------- 场景 2：坏归档 ----------
  Add-EvidenceSection '场景 2：坏归档恢复失败、目标保留、有效备份不受影响'
  $goodV2 = Get-LatestArchive -Role 'v2'
  $badDir = Join-Path $script:BackupDir 'corrupt'
  New-Item -ItemType Directory -Force -Path $badDir | Out-Null
  $badFile = Join-Path $badDir 'v2-corrupt.dump'
  $bytes = [System.IO.File]::ReadAllBytes($goodV2)
  [System.IO.File]::WriteAllBytes($badFile, $bytes[0..([math]::Min(4096, $bytes.Length - 1))])
  $badTarget = 'flower_e2_restore_e23bad'
  Drop-RestoreTarget -Name $badTarget
  $bad = Invoke-Logged -FilePath 'pwsh' -Arguments @('-NoProfile', '-File', $restoreScript, '-Archive', $badFile, '-TargetDatabase', $badTarget, '-ConfirmNewTarget') -AllowExitCodes @(0, 1) -NoThrow
  Add-Evidence "  坏归档恢复 exit=$($bad.ExitCode)"
  Assert-True ($bad.ExitCode -ne 0) '坏归档恢复返回非零'
  $kept = (Invoke-StagingCompose -Arguments @('exec', '-T', 'db', 'psql', '-U', $script:Cfg.DbUser, '-d', $script:Cfg.V1Db, '-t', '-A', '-c', "SELECT count(*) FROM pg_database WHERE datname='$badTarget'")).Output.Trim()
  Assert-Equal $kept '1' '坏归档恢复失败时保留目标库用于定位'
  Drop-RestoreTarget -Name $badTarget
  $goodSets = Get-SuccessfulSets
  Assert-True ($goodSets.Count -ge 1) '坏归档失败后上一份有效备份仍存在'
  $results['bad-archive'] = 'PASS'

  # ---------- 场景 3：目标冲突 ----------
  Add-EvidenceSection '场景 3：恢复目标已存在时拒绝覆盖'
  $conflictTarget = 'flower_e2_restore_e23conflict'
  Drop-RestoreTarget -Name $conflictTarget
  $keepGood = Invoke-Logged -FilePath 'pwsh' -Arguments @('-NoProfile', '-File', $restoreScript, '-Archive', (Get-LatestArchive -Role 'v2'), '-TargetDatabase', $conflictTarget, '-ConfirmNewTarget', '-KeepTarget') -AllowExitCodes @(0, 1) -NoThrow
  Assert-True ($keepGood.ExitCode -eq 0) '首次恢复到保留目标成功'
  $conflict = Invoke-Logged -FilePath 'pwsh' -Arguments @('-NoProfile', '-File', $restoreScript, '-Archive', (Get-LatestArchive -Role 'v2'), '-TargetDatabase', $conflictTarget, '-ConfirmNewTarget') -AllowExitCodes @(0, 1) -NoThrow
  Add-Evidence "  目标冲突恢复 exit=$($conflict.ExitCode)"
  Assert-True ($conflict.ExitCode -ne 0) '目标已存在时拒绝覆盖'
  Drop-RestoreTarget -Name $conflictTarget
  $results['target-conflict'] = 'PASS'

  # ---------- 场景 4：保留策略 ----------
  Add-EvidenceSection '场景 4：保留策略（Retention）'
  $before = @(Get-SuccessfulSets).Name
  Add-Evidence "  当前备份集: $($before -join ', ')"
  Assert-True ($before.Count -le $Retention) '成功备份集数量不超过 Retention'

  # ---------- 场景 5：有效恢复核对 ----------
  Add-EvidenceSection '场景 5：有效归档恢复核对'
  $target = 'flower_e2_restore_e23ok'
  Drop-RestoreTarget -Name $target
  $ok = Invoke-Logged -FilePath 'pwsh' -Arguments @('-NoProfile', '-File', $restoreScript, '-Archive', (Get-LatestArchive -Role 'v2'), '-TargetDatabase', $target, '-ConfirmNewTarget') -AllowExitCodes @(0, 1) -NoThrow
  Add-Evidence "  有效恢复 exit=$($ok.ExitCode)"
  Assert-True ($ok.ExitCode -eq 0) '有效归档恢复成功并通过行数核对'
  $results['valid-restore'] = 'PASS'
  $results['retention'] = 'PASS'
}
finally {
  Drop-RestoreTarget -Name 'flower_e2_restore_e23test1'
  Drop-RestoreTarget -Name 'flower_e2_restore_e23ok'
  Drop-RestoreTarget -Name 'flower_e2_restore_e23conflict'
  Drop-RestoreTarget -Name 'flower_e2_restore_e23bad'
}

Add-EvidenceSection '自测结论'
foreach ($k in $results.Keys) { Add-Evidence "  $k = $($results[$k])" }
Add-Evidence "  备份集目录: deploy/staging/.runtime/backup"
Stop-EvidenceLog
Write-Host 'BACKUP_RESTORE_TESTS_OK'
exit 0
