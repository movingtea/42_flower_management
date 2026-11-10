# Flower WMS Sprint E2.5 · staging 半自动回滚（应用镜像）
#
# 前提：执行者提供上一版镜像与**兼容性证据**（JSON 含 safe=true/false 与依据）。
# 不满足兼容前提时拒绝回滚（exit 9），只输出可选项；数据库保持前滚，迁移历史不修改。
#
# 用法：
#   pwsh -File deploy/staging/scripts/Invoke-StagingRollback.ps1 `
#     -PreviousImage flower-e2-staging:9112ed3bfa46 `
#     -CompatibilityEvidence deploy/staging/.runtime/compat-safe.json
#
# 兼容性证据示例（safe）：
#   { "safe": true, "migrationTypes": ["additive"], "evidence": "0008 仅加列/加表/加枚举值；E2.4 已验证旧镜像在 8 迁移 schema 上健康" }
#
# 退出码：0 成功；4 迁移未完成（pending>0，拒绝回滚）；6 回滚后 web 不健康；9 兼容性证据不足/存在破坏性迁移。

param(
  [Parameter(Mandatory)][string]$PreviousImage,
  [Parameter(Mandatory)][string]$CompatibilityEvidence,
  [switch]$SkipSmoke,
  [string]$Image
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Staging.Common.ps1')

Initialize-StagingContext -Mode Baseline -Image $Image
Start-EvidenceRun -Mode 'rollback'
Start-EvidenceLog -Name 'rollback' -Title 'E2.5 staging 半自动回滚' -Package '5' | Out-Null
Initialize-StagingRuntime

function Exit-Rollback([int]$Code, [string]$Message) {
  Add-Evidence "[rollback] exit=$Code：$Message"
  Stop-EvidenceLog
  if ($Code -eq 0) { Write-Host "ROLLBACK_OK $Message"; exit 0 }
  Write-Host "[exit $Code] $Message"
  exit $Code
}

Add-EvidenceSection '回滚前检查'
$currentWeb = (& docker inspect "$($script:Cfg.Project)-web" --format '{{.Config.Image}}|{{.Image}}|{{.State.Status}}' 2>$null)
Add-Evidence "  current_web: $currentWeb"
if (-not (Get-StagingImageId -Reference $PreviousImage)) { Exit-Rollback 9 "上一版镜像不存在：$PreviousImage" }
$prevId = Get-StagingImageId -Reference $PreviousImage
Add-Evidence "  previous_image: $PreviousImage id=$prevId"

if (-not (Test-Path $CompatibilityEvidence)) { Exit-Rollback 9 "缺少兼容性证据文件：$CompatibilityEvidence" }
$evidenceText = Get-Content $CompatibilityEvidence -Raw
Add-Evidence "  compatibility_evidence: $CompatibilityEvidence"
Add-Evidence "  evidence_content: $($evidenceText.Trim())"
try { $evidence = $evidenceText | ConvertFrom-Json } catch { Exit-Rollback 9 '兼容性证据不是有效 JSON' }
if ($evidence.safe -ne $true) { Exit-Rollback 9 "兼容性证据判定为不安全：$($evidence.reason)" }
if ($evidence.migrationTypes -and ($evidence.migrationTypes -contains 'destructive' -or $evidence.migrationTypes -contains 'constraint-tightening')) {
  Exit-Rollback 9 '兼容性证据包含破坏性/收紧约束迁移，拒绝自动回滚镜像'
}
Add-Evidence '  [OK] 兼容性证据允许镜像回滚（数据库保持前滚）'

Add-EvidenceSection '迁移状态检查（断言 pending=0）'
$unfinished = (Invoke-StagingCompose -Arguments @('exec', '-T', 'db', 'psql', '-U', $script:Cfg.DbUser, '-d', $script:Cfg.V2Db, '-t', '-A', '-c', 'SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NULL')).Output.Trim()
Add-Evidence "  v2 unfinished_migrations=$unfinished"
if ($unfinished -ne '0') { Exit-Rollback 4 "存在未完成迁移（unfinished=$unfinished），拒绝回滚" }
Add-Evidence '  [OK] 无未完成迁移；数据库已前滚，兼容性由执行者证据判定'

$started = Get-Date
Add-EvidenceSection '执行回滚（web/cron 使用同一上一版镜像；db 不动）'
$env:STAGING_IMAGE = $PreviousImage
Invoke-StagingCompose -Arguments @('stop', 'flower-cron-worker', 'flower-web') -AllowExitCodes @(0, 1) -NoThrow | Out-Null
Invoke-StagingCompose -Arguments @('rm', '-f', 'flower-cron-worker', 'flower-web') -AllowExitCodes @(0, 1) -NoThrow | Out-Null
$up = Invoke-StagingCompose -Arguments @('up', '-d', '--no-deps', 'flower-web') -AllowExitCodes @(0, 1) -NoThrow
if ($up.ExitCode -ne 0) { Exit-Rollback 6 "回滚 web 启动失败（exit $($up.ExitCode)）" }
$health = Wait-StagingWebHealthy -TimeoutSeconds 180
if (-not $health.Ok) {
  Invoke-StagingCompose -Arguments @('logs', '--tail=100', 'flower-web') -NoThrow | Out-Null
  Exit-Rollback 6 '回滚后 web 健康检查失败；保留现场与旧镜像'
}
$upCron = Invoke-StagingCompose -Arguments @('up', '-d', '--no-deps', 'flower-cron-worker') -AllowExitCodes @(0, 1) -NoThrow
Add-Evidence "  cron up exit=$($upCron.ExitCode)"

if (-not $SkipSmoke) {
  Add-EvidenceSection '回滚后冒烟'
  Invoke-StagingSmoke | Out-Null
}

$elapsed = [math]::Round(((Get-Date) - $started).TotalSeconds, 1)
$webImage = (& docker inspect "$($script:Cfg.Project)-web" --format '{{.Config.Image}}' 2>$null)
$cronImage = (& docker inspect "$($script:Cfg.Project)-cron" --format '{{.Config.Image}}' 2>$null)
$migrations = (Invoke-StagingCompose -Arguments @('exec', '-T', 'db', 'psql', '-U', $script:Cfg.DbUser, '-d', $script:Cfg.V2Db, '-t', '-A', '-c', 'SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL')).Output.Trim()

Add-EvidenceSection '回滚结果'
Add-Evidence "  before_web_image: $(($currentWeb -split '\|')[0])"
Add-Evidence "  after_web_image: $webImage"
Add-Evidence "  after_cron_image: $cronImage"
Add-Evidence "  db_v2_applied_migrations: $migrations（保持前滚，不回退）"
Add-Evidence "  rollback_seconds: $elapsed"
Add-Evidence "  health: ok elapsed=$($health.ElapsedSeconds)s"
Add-Evidence "  compatibility: $(($evidence.migrationTypes -join ','))"
if ("$webImage".Trim() -ne $PreviousImage) { Exit-Rollback 6 "回滚后 web 镜像不是上一版：$webImage" }

$utc = (Get-Date).ToUniversalTime()
$releaseDir = Join-Path $script:RepoRoot 'docs\evidence\sprint-e2\releases'
New-Item -ItemType Directory -Force -Path $releaseDir | Out-Null
$releaseName = "rollback-$($utc.ToString('yyyyMMdd-HHmmss'))-local.md"
$record = @(
  '# E2.5 回滚记录（本机 staging）',
  '',
  "- 回滚时间（UTC）：$($utc.ToString('o'))",
  "- 回滚前镜像：$(($currentWeb -split '\|')[0])",
  "- 回滚后镜像：$webImage（cron：$cronImage）",
  "- 数据库：保持前滚，V2 applied_migrations=$migrations",
  "- 兼容性证据：$(($evidence.migrationTypes -join ','))；$($evidence.evidence)",
  '- 健康：/api/health 200 status=ok',
  "- 冒烟：$([bool](-not $SkipSmoke))",
  "- 回滚耗时：${elapsed}s",
  '- 故障单：无；审批：本机 staging 演练，不涉及生产'
) -join "`n"
Set-Content -Path (Join-Path $releaseDir $releaseName) -Value $record -Encoding utf8NoBOM
Add-Evidence "  release_record: docs/evidence/sprint-e2/releases/$releaseName"

Exit-Rollback 0 "previous=$PreviousImage seconds=$elapsed"

