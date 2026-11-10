# Flower WMS Sprint E2.5 · 回滚与恢复演练
#
# 场景：
#   1 坏镜像部署失败（健康失败）→ 半自动回滚到上一版镜像 → 健康/冒烟/耗时记录
#   2 兼容性证据不足（破坏性迁移）→ 回滚入口拒绝（exit 9），不改动运行中的栈
#   3 数据库恢复路径：从 E2.3 备份恢复到隔离副本，核对迁移历史/行数后清理
#      （数据库恢复与镜像回滚分别记录；生产恢复仍需审批与停写窗口）
#
# 用法：pwsh -File deploy/staging/scripts/Invoke-StagingRollbackDrills.ps1

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Staging.Common.ps1')

Initialize-StagingContext -Mode Baseline
$script:Cfg.Image = Resolve-StagingImage
$env:STAGING_IMAGE = $script:Cfg.Image
Start-EvidenceRun -Mode 'rollback-drills'
Start-EvidenceLog -Name 'rollback-drills' -Title 'E2.5 回滚与恢复演练' -Package '5' | Out-Null
Initialize-StagingRuntime

$goodImage = $script:Cfg.Image
$badImage = 'flower-e2-staging:bad-health'
$rollbackScript = Join-Path $PSScriptRoot 'Invoke-StagingRollback.ps1'
$deployScript = Join-Path $PSScriptRoot 'Deploy-Staging.ps1'
$restoreScript = Join-Path $PSScriptRoot 'Restore-Staging.ps1'
$results = [ordered]@{}

try {
  # ---------- 场景 1：坏镜像 → 回滚 ----------
  Add-EvidenceSection '场景 1：坏镜像健康失败 → 回滚上一版'
  if (-not (Get-StagingImageId -Reference $badImage)) {
    $r = Invoke-Logged -FilePath 'docker' -Arguments @('build', '-q', '-f', (Join-Path $script:StagingDir 'images\Dockerfile.bad-health'), '-t', $badImage, '.') -AllowExitCodes @(0, 1) -NoThrow
    if ($r.ExitCode -ne 0) { throw "坏镜像构建失败（exit $($r.ExitCode)）" }
  }
  $badDeploy = Invoke-Logged -FilePath 'pwsh' -Arguments @('-NoProfile', '-File', $deployScript, '-TargetImage', $badImage) -AllowExitCodes @(0, 1, 2, 3, 4, 5, 6, 7, 8) -NoThrow
  Add-Evidence "  坏镜像部署 exit=$($badDeploy.ExitCode)（期望非零）"
  Assert-True ($badDeploy.ExitCode -ne 0) '坏镜像部署按失败停止'

  $safeEvidence = Join-Path $script:RuntimeDir 'compat-safe.json'
  @{ safe = $true; migrationTypes = @('additive'); evidence = '0008 仅加列/加表/加枚举值；E2.4 已验证旧镜像在 8 迁移 schema 上健康' } | ConvertTo-Json | Set-Content -Path $safeEvidence -Encoding utf8NoBOM
  $rollback = Invoke-Logged -FilePath 'pwsh' -Arguments @('-NoProfile', '-File', $rollbackScript, '-PreviousImage', $goodImage, '-CompatibilityEvidence', $safeEvidence) -AllowExitCodes @(0, 1, 4, 6, 9) -NoThrow
  Add-Evidence "  回滚 exit=$($rollback.ExitCode)"
  Assert-True ($rollback.ExitCode -eq 0) '坏镜像后回滚到上一版成功（健康+冒烟）'
  $webImage = (& docker inspect "$($script:Cfg.Project)-web" --format '{{.Config.Image}}' 2>$null)
  Assert-Equal "$webImage".Trim() $goodImage '回滚后 web 镜像与上一版一致'
  $results['bad-image-rollback'] = 'PASS'

  # ---------- 场景 2：不安全兼容性证据 → 拒绝回滚 ----------
  Add-EvidenceSection '场景 2：兼容性证据不足 → 拒绝回滚（不改变运行栈）'
  $unsafe = Join-Path $script:RuntimeDir 'compat-unsafe.json'
  @{ safe = $false; reason = '受控演练：假设本次迁移包含删除列/收紧约束，旧镜像不兼容'; migrationTypes = @('destructive') } | ConvertTo-Json | Set-Content -Path $unsafe -Encoding utf8NoBOM
  $beforeStatus = (& docker inspect "$($script:Cfg.Project)-web" --format '{{.State.Status}}' 2>$null)
  $denied = Invoke-Logged -FilePath 'pwsh' -Arguments @('-NoProfile', '-File', $rollbackScript, '-PreviousImage', $goodImage, '-CompatibilityEvidence', $unsafe) -AllowExitCodes @(0, 1, 4, 6, 9) -NoThrow
  Add-Evidence "  不安全证据回滚 exit=$($denied.ExitCode)（期望 9）"
  Assert-Equal $denied.ExitCode 9 '破坏性迁移证据下拒绝回滚'
  $afterStatus = (& docker inspect "$($script:Cfg.Project)-web" --format '{{.State.Status}}' 2>$null)
  Assert-Equal "$afterStatus".Trim() "$beforeStatus".Trim() '拒绝回滚未改变运行中的 web 状态'
  $results['unsafe-refusal'] = 'PASS'

  # ---------- 场景 3：数据库恢复路径（隔离副本） ----------
  Add-EvidenceSection '场景 3：数据库恢复路径（从 E2.3 备份恢复到隔离副本）'
  $backupRoot = (Resolve-Path $script:BackupDir).Path
  $sets = @(Get-ChildItem $backupRoot -Directory | Where-Object { $_.Name -match '^\d{8}T\d{6}Z-' -and (Test-Path (Join-Path $_.FullName 'manifest.json')) } | Sort-Object Name -Descending)
  if ($sets.Count -eq 0) { throw '没有可用的成功备份集' }
  $v2 = Get-ChildItem $sets[0].FullName -Filter 'v2-*.dump' | Select-Object -First 1
  $copyTarget = 'flower_e2_restore_e25copy'
  $restore = Invoke-Logged -FilePath 'pwsh' -Arguments @('-NoProfile', '-File', $restoreScript, '-Archive', $v2.FullName, '-TargetDatabase', $copyTarget, '-ConfirmNewTarget', '-KeepTarget') -AllowExitCodes @(0, 1) -NoThrow
  Add-Evidence "  恢复副本 exit=$($restore.ExitCode)"
  Assert-True ($restore.ExitCode -eq 0) '备份恢复到隔离副本成功并完成行数核对'
  $copied = (Invoke-StagingCompose -Arguments @('exec', '-T', 'db', 'psql', '-U', $script:Cfg.DbUser, '-d', $copyTarget, '-t', '-A', '-c', 'SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL')).Output.Trim()
  Assert-Equal $copied 8 '恢复副本迁移历史 = 8'
  Add-Evidence '  说明：数据库恢复与镜像回滚分别记录；生产恢复需停写窗口与项目用户批准。'
  $drop = Invoke-StagingCompose -Arguments @('exec', '-T', 'db', 'dropdb', '--if-exists', '-U', $script:Cfg.DbUser, $copyTarget) -AllowExitCodes @(0, 1) -NoThrow
  Add-Evidence "  清理副本 dropdb exit=$($drop.ExitCode)"
  $results['db-recovery-path'] = 'PASS'
}
finally {
  Add-EvidenceSection '清理演练临时资源'
  Invoke-StagingCompose -Arguments @('exec', '-T', 'db', 'dropdb', '--if-exists', '-U', $script:Cfg.DbUser, 'flower_e2_restore_e25copy') -AllowExitCodes @(0, 1) -NoThrow | Out-Null
  docker rmi $badImage 2>$null | Out-Null
}

Add-EvidenceSection 'E2.5 场景结论'
foreach ($k in $results.Keys) { Add-Evidence "  $k = $($results[$k])" }
Stop-EvidenceLog
Write-Host 'ROLLBACK_DRILLS_OK'
exit 0
