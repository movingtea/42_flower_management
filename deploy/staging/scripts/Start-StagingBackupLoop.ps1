# Flower WMS Sprint E2.3 · staging 非生产定时备份入口
#
# 用途：按间隔重复调用 Backup-Staging.ps1（仅本机 staging）。默认不注册系统任务；
# Windows 任务计划的注册/注销见 deploy/staging/README.md（需用户明确同意后执行）。
#
# 用法：
#   pwsh -File deploy/staging/scripts/Start-StagingBackupLoop.ps1 -Once
#   pwsh -File deploy/staging/scripts/Start-StagingBackupLoop.ps1 -IntervalMinutes 1 -MaxRuns 2
#
# 证据：每次触发由 Backup-Staging.ps1 写 e23-backup-*.log；本入口写 e23-backup-loop-*.log。

param(
  [switch]$Once,
  [int]$IntervalMinutes = 60,
  [int]$MaxRuns = 0,
  [int]$Retention = 5
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Staging.Common.ps1')

Initialize-StagingContext -Mode Baseline
Start-EvidenceRun -Mode 'backup-loop'
Start-EvidenceLog -Name 'backup-loop' -Title 'E2.3 staging 定时备份入口' -Package '3' | Out-Null
Add-Evidence "  once=$([bool]$Once) interval_minutes=$IntervalMinutes max_runs=$MaxRuns retention=$Retention"
Add-Evidence '  说明：本入口只做非生产定时；未注册 Windows 计划任务（需用户同意，见 README）。'

$scriptPath = Join-Path $PSScriptRoot 'Backup-Staging.ps1'
$run = 0
$failures = 0
while ($true) {
  $run++
  Add-EvidenceSection "第 $run 轮备份 $(Get-Date -Format o)"
  $result = Invoke-Logged -FilePath 'pwsh' -Arguments @('-NoProfile', '-File', $scriptPath, '-Label', 'scheduled', '-Retention', "$Retention") -AllowExitCodes @(0, 1) -NoThrow
  Add-Evidence "  exit=$($result.ExitCode)"
  if ($result.ExitCode -ne 0) { $failures++ }
  if ($Once) { break }
  if ($MaxRuns -gt 0 -and $run -ge $MaxRuns) { break }
  Start-Sleep -Seconds ($IntervalMinutes * 60)
}

Add-EvidenceSection '定时备份入口完成'
Add-Evidence "  runs=$run failures=$failures"
Stop-EvidenceLog
if ($failures -gt 0) { exit 1 }
exit 0
