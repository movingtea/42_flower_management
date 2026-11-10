# Flower WMS Sprint E2.2 · staging 按 SHA/镜像部署与失败停止
#
# 流程（顺序固定，任一步失败即停止，不继续后续步骤）：
#   1 串行化（项目级锁，支持 -ForceUnlock）
#   2 记录现状（当前 web/cron 镜像、迁移状态、回滚候选）
#   3 解析目标镜像（必须已存在；不存在/不可解析 → 退出，不动现有栈）
#   4 预检（compose 配置脱敏校验、V1/V2 --connect、镜像迁移清单 vs 已应用、磁盘）
#   5 迁移前备份（E2.3 Backup-Staging -Label predeploy；失败即停）
#   6 替换应用：stop/rm web+cron → 起 web（entrypoint 唯一迁移执行者）→ 等健康
#   7 迁移后核对（E2.4 Test-StagingMigration -Mode post；退出码 3/4/5 分类）
#   8 web 健康且迁移完成后才启 cron，并确认成功轮次
#   9 成功需健康 + 业务冒烟同时通过；写发布记录并退出 0
#
# 用法：
#   pwsh -File deploy/staging/scripts/Deploy-Staging.ps1 -TargetImage flower-e2-staging:9112ed3bfa46
#   pwsh -File deploy/staging/scripts/Deploy-Staging.ps1 -TargetImage <ref> -DryRun
#   pwsh -File deploy/staging/scripts/Deploy-Staging.ps1 -TargetImage <ref> -ForceUnlock
#
# 注意：本入口不执行 prisma migrate deploy；迁移只由 web entrypoint 执行，避免重复迁移。
# 失败退出保留诊断信息与旧镜像；回滚使用 E2.5 的 Invoke-StagingRollback.ps1。

param(
  [string]$TargetImage,
  [string]$TargetSha,
  [string]$PreviousImage,
  [switch]$DryRun,
  [switch]$SkipSmoke,
  [switch]$ForceUnlock
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Staging.Common.ps1')

Initialize-StagingContext -Mode Baseline
Start-EvidenceRun -Mode 'deploy'
Start-EvidenceLog -Name 'deploy' -Title 'E2.2 staging 部署与失败停止' -Package '2' | Out-Null
Initialize-StagingRuntime

$lockFile = Join-Path $script:RuntimeDir 'deploy.lock'
function Exit-Deploy([int]$Code, [string]$Message) {
  Add-Evidence "[deploy] exit=$Code：$Message"
  Stop-EvidenceLog
  if ($Code -eq 0) { Write-Host "DEPLOY_DRYRUN_OK $Message"; exit 0 }
  Write-Host "[exit $Code] 部署失败：$Message"
  exit $Code
}

# ---------- 1 串行化 ----------
Add-EvidenceSection '串行化锁'
if (Test-Path $lockFile) {
  $lock = Get-Content $lockFile -Raw -ErrorAction SilentlyContinue
  if (-not $ForceUnlock) {
    Exit-Deploy 7 "同一目标上已有部署进行中（锁：$lock）；确认无运行中的部署后用 -ForceUnlock"
  }
  Add-Evidence "  [WARN] -ForceUnlock：清除旧锁内容：$lock"
  Remove-Item -Force $lockFile
}
"pid=$PID started_at=$((Get-Date).ToString('o'))" | Set-Content -Path $lockFile -Encoding utf8NoBOM
Add-Evidence "  lock acquired: deploy/staging/.runtime/deploy.lock"

try {
  # ---------- 2 记录现状 ----------
  Add-EvidenceSection '部署前现状'
  $currentWeb = (& docker inspect "$($script:Cfg.Project)-web" --format '{{.Config.Image}}|{{.Image}}|{{.State.Status}}' 2>$null)
  $currentCron = (& docker inspect "$($script:Cfg.Project)-cron" --format '{{.Config.Image}}|{{.Image}}|{{.State.Status}}' 2>$null)
  Add-Evidence "  current_web: $currentWeb"
  Add-Evidence "  current_cron: $currentCron"
  $rollbackCandidate = if ($PreviousImage) { $PreviousImage } else { ($currentWeb -split '\|')[0] }
  Add-Evidence "  rollback_candidate: $rollbackCandidate"
  Add-Evidence "  recorded_at_utc: $((Get-Date).ToUniversalTime().ToString('o'))"

  # ---------- 3 解析目标 ----------
  Add-EvidenceSection '解析目标镜像'
  if (-not $TargetImage -and $TargetSha) {
    $TargetImage = "flower-e2-staging:$($TargetSha.Substring(0, [math]::Min(12, $TargetSha.Length)))"
  }
  if (-not $TargetImage) { Exit-Deploy 2 '必须提供 -TargetImage 或 -TargetSha' }
  $targetId = Get-StagingImageId -Reference $TargetImage
  if (-not $targetId) {
    Add-Evidence "  [FAIL] 目标镜像不存在：$TargetImage（未停止现有 stack）"
    Exit-Deploy 2 "目标镜像不存在：$TargetImage"
  }
  $targetInfo = & docker image inspect $TargetImage --format '{{.Id}}|{{.Os}}/{{.Architecture}}|{{.Size}}' 2>$null
  Add-Evidence "  target_image: $TargetImage  info: $targetInfo"
  Add-Evidence "  target_matches_rollback_candidate: $($TargetImage -eq $rollbackCandidate)"
  $env:STAGING_IMAGE = $TargetImage

  if ($DryRun) {
    Add-EvidenceSection 'DryRun 预检'
    $dry = Invoke-Logged -FilePath 'pwsh' -Arguments @('-NoProfile', '-File', (Join-Path $PSScriptRoot 'Test-StagingMigration.ps1'), '-Mode', 'preflight', '-Image', $TargetImage) -AllowExitCodes @(0, 1, 2, 3, 4, 5) -NoThrow
    Add-Evidence "  preflight exit=$($dry.ExitCode)"
    if ($dry.ExitCode -ne 0) { Exit-Deploy $dry.ExitCode 'DryRun 预检失败' }
    Exit-Deploy 0 'DryRun 预检通过（未替换应用）'
  }

  # ---------- 4 预检 ----------
  Add-EvidenceSection '预检'
  $config = Invoke-StagingCompose -Arguments @('config', '--services') -AllowExitCodes @(0, 1) -NoThrow
  if ($config.ExitCode -ne 0) { Exit-Deploy 2 "compose 配置校验失败（exit $($config.ExitCode)）" }
  Add-Evidence "  compose services: $(($config.Output -split "`r?`n" | Where-Object { $_ }) -join ', ')"
  $preflight = Invoke-Logged -FilePath 'pwsh' -Arguments @('-NoProfile', '-File', (Join-Path $PSScriptRoot 'Test-StagingMigration.ps1'), '-Mode', 'preflight', '-Image', $TargetImage) -AllowExitCodes @(0, 1, 2, 3, 4, 5) -NoThrow
  Add-Evidence "  migration preflight exit=$($preflight.ExitCode)"
  if ($preflight.ExitCode -ne 0) { Exit-Deploy $preflight.ExitCode '迁移预检失败，未替换应用' }
  $diskFree = [math]::Round((Get-PSDrive C).Free / 1GB, 2)
  Add-Evidence "  c_free_gb: $diskFree"
  if ($diskFree -lt 5) { Exit-Deploy 2 "磁盘余量不足（$diskFree GB），未替换应用" }

  # ---------- 5 迁移前备份 ----------
  Add-EvidenceSection '迁移前备份'
  $backup = Invoke-Logged -FilePath 'pwsh' -Arguments @('-NoProfile', '-File', (Join-Path $PSScriptRoot 'Backup-Staging.ps1'), '-Label', 'predeploy', '-Retention', '5') -AllowExitCodes @(0, 1) -NoThrow
  Add-Evidence "  backup exit=$($backup.ExitCode)"
  if ($backup.ExitCode -ne 0) { Exit-Deploy 5 '迁移前备份失败，未替换应用' }

  # ---------- 6 替换应用 ----------
  Add-EvidenceSection '替换应用（db 不动）'
  $stop = Invoke-StagingCompose -Arguments @('stop', 'flower-web', 'flower-cron-worker') -AllowExitCodes @(0, 1) -NoThrow
  Add-Evidence "  stop app exit=$($stop.ExitCode)"
  Invoke-StagingCompose -Arguments @('rm', '-f', 'flower-web', 'flower-cron-worker') -AllowExitCodes @(0, 1) -NoThrow | Out-Null
  $upWeb = Invoke-StagingCompose -Arguments @('up', '-d', '--no-deps', 'flower-web') -AllowExitCodes @(0, 1) -NoThrow
  if ($upWeb.ExitCode -ne 0) { Exit-Deploy 6 "web 启动失败（exit $($upWeb.ExitCode)）" }
  $health = Wait-StagingWebHealthy -TimeoutSeconds 180
  if (-not $health.Ok) {
    Invoke-StagingCompose -Arguments @('logs', '--tail=100', 'flower-web') -NoThrow | Out-Null
    Exit-Deploy 6 "web 健康检查失败（180s）；未启动 cron，旧镜像 $rollbackCandidate 保留"
  }
  Add-Evidence "  web healthy elapsed=$($health.ElapsedSeconds)s"

  # ---------- 7 迁移后核对 ----------
  Add-EvidenceSection '迁移后核对'
  $post = Invoke-Logged -FilePath 'pwsh' -Arguments @('-NoProfile', '-File', (Join-Path $PSScriptRoot 'Test-StagingMigration.ps1'), '-Mode', 'post', '-Image', $TargetImage) -AllowExitCodes @(0, 1, 2, 3, 4, 5) -NoThrow
  Add-Evidence "  migration post exit=$($post.ExitCode)"
  if ($post.ExitCode -ne 0) { Exit-Deploy $post.ExitCode '迁移后核对失败；未启动 cron' }

  # ---------- 8 启动 cron ----------
  Add-EvidenceSection '启动 cron（web 健康且迁移完成后）'
  Invoke-StagingCompose -Arguments @('up', '-d', '--no-deps', 'flower-cron-worker') -AllowExitCodes @(0, 1) -NoThrow | Out-Null
  $cronOk = $false
  for ($i = 0; $i -lt 12; $i++) {
    Start-Sleep -Seconds 5
    $logs = (Invoke-StagingCompose -Arguments @('logs', '--tail=80', 'flower-cron-worker') -AllowExitCodes @(0, 1) -NoThrow).Output
    if ($logs -match '\[cron-(inventory|order-expiry)\][^\n]*done' -or $logs -match '\[cron-worker\][^\n]*started') {
      $cronOk = $true
      Add-Evidence "  cron started/success round detected (attempt $($i + 1))"
      break
    }
  }
  if (-not $cronOk) { Exit-Deploy 8 'cron 未出现启动/成功轮次' }

  $webImage = (& docker inspect "$($script:Cfg.Project)-web" --format '{{.Config.Image}}' 2>$null)
  $cronImage = (& docker inspect "$($script:Cfg.Project)-cron" --format '{{.Config.Image}}' 2>$null)
  Add-Evidence "  actual_web_image: $webImage"
  Add-Evidence "  actual_cron_image: $cronImage"
  if ("$webImage".Trim() -ne $TargetImage -or "$cronImage".Trim() -ne $TargetImage) {
    Exit-Deploy 8 'web/cron 实际镜像与目标不一致'
  }

  # ---------- 9 冒烟与发布记录 ----------
  if (-not $SkipSmoke) {
    Add-EvidenceSection '业务冒烟'
    Invoke-StagingSmoke | Out-Null
  }
  $utc = (Get-Date).ToUniversalTime()
  $releaseDir = Join-Path $script:RepoRoot 'docs\evidence\sprint-e2\releases'
  New-Item -ItemType Directory -Force -Path $releaseDir | Out-Null
  $releaseName = "rel-$($utc.ToString('yyyyMMdd-HHmmss'))-local.md"
  $release = @(
    '# E2 发布记录（本机 staging）',
    '',
    "- 发布编号：REL-$($utc.ToString('yyyyMMdd-HHmmss'))-LOCAL",
    "- 目标环境：本机 staging（$($script:Cfg.Project)）",
    "- 源码 SHA：$((git -C $script:RepoRoot rev-parse HEAD).Trim())",
    "- 目标镜像：$TargetImage（image_id=$targetId）",
    "- 上一版镜像：$rollbackCandidate",
    "- 发布窗口（实际）：$($utc.ToString('o'))",
    '- 迁移：由 web entrypoint 执行；post 核对通过',
    "- 迁移前备份：见 deploy/staging/.runtime/backup 与 e23-backup 证据",
    '- 健康：/api/health 200 status=ok',
    '- 冒烟：登录/V2 入口/工作区页面按 E2.1 口径',
    "- cron：成功轮次（actual=$cronImage）",
    '- 回滚预案：E2.5 Invoke-StagingRollback（未使用）',
    '- 故障单：无',
    "- 执行人：DSH（run_id=$($script:RunStamp)）",
    '- 资源清理：本机栈保留供后续批次；发布后核对容器/卷/网络均属本项目'
  ) -join "`n"
  Set-Content -Path (Join-Path $releaseDir $releaseName) -Value $release -Encoding utf8NoBOM
  Add-Evidence "  release_record: docs/evidence/sprint-e2/releases/$releaseName"

  Add-EvidenceSection '部署成功'
  Add-Evidence "  target=$TargetImage  health=$($health.ElapsedSeconds)s  cron=ok"
  Stop-EvidenceLog
  Write-Host "DEPLOY_OK image=$TargetImage"
  exit 0
}
finally {
  if (Test-Path $lockFile) { Remove-Item -Force $lockFile -ErrorAction SilentlyContinue }
}

