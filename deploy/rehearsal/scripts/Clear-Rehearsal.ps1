# E1.8 演练清理脚本（独立于主演练，可单独执行）
#
# 仅清理本项目（flower-e1-8-rehearsal）的容器/网络/卷，以及演练镜像标签；
# 不触碰生产容器、其他项目或本地开发数据库（如 flower-v2-pg）。
#
# 用法：
#   pwsh -File deploy/rehearsal/scripts/Clear-Rehearsal.ps1
#   pwsh -File deploy/rehearsal/scripts/Clear-Rehearsal.ps1 -RemoveImages -RemoveRuntime
#
# -RemoveImages   同时删除 flower-e18-rehearsal/flower-platform-app:sha-* 演练镜像标签
# -RemoveRuntime  删除 deploy/rehearsal/.runtime（env/随机密码/备份 dump/override），不可恢复

[CmdletBinding()]
param(
  [switch]$RemoveImages,
  [switch]$RemoveRuntime
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Rehearsal.Common.ps1')

Write-Host '=== E1.8 演练资源清理 ==='
Write-Host "compose project: $($script:ProjectName)"

# 确保 compose 能解析 env_file（.runtime 可能已被手工删除）
if (-not (Test-Path $script:EnvFile)) {
  $runtimeDirs = @($script:RuntimeDir, $script:OverrideDir, $script:BackupDir, $script:SecretsDir)
  foreach ($dir in $runtimeDirs) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
  Set-Content -Path $script:EnvFile -Value '# 占位 env：仅用于 compose down 解析；如需重新演练请运行 Invoke-Rehearsal.ps1' -Encoding utf8NoBOM
  Write-Host '[info] 生成占位 env 供 compose down 使用'
}

$devPgBefore = ((& docker ps -a --filter 'name=flower-v2-pg' --format '{{.ID}}|{{.Image}}|{{.Status}}' 2>&1) -join ' ').Trim()
$down = Invoke-Compose -Arguments @('down', '-v', '--remove-orphans') -AllowExitCodes @(0, 1) -NoThrow
Write-Host "compose down -v exit=$($down.ExitCode)"

$remainingContainers = @(& docker ps -a --filter "label=com.docker.compose.project=$($script:ProjectName)" --format '{{.Names}}' 2>$null | Where-Object { $_ })
$remainingVolumes = @(& docker volume ls --filter "name=$($script:ProjectName)" --format '{{.Name}}' 2>$null | Where-Object { $_ })
$remainingNetworks = @(& docker network ls --filter "name=$($script:ProjectName)" --format '{{.Name}}' 2>$null | Where-Object { $_ })
Write-Host "剩余容器=$($remainingContainers.Count) 卷=$($remainingVolumes.Count) 网络=$($remainingNetworks.Count)"
if ($remainingContainers.Count -or $remainingVolumes.Count -or $remainingNetworks.Count) {
  Write-Host '[warn] 仍有残留资源，请检查：'
  $remainingContainers | ForEach-Object { Write-Host "  container: $_" }
  $remainingVolumes | ForEach-Object { Write-Host "  volume: $_" }
  $remainingNetworks | ForEach-Object { Write-Host "  network: $_" }
  exit 1
}

if ($RemoveImages) {
  $imageRepo = 'flower-e18-rehearsal/flower-platform-app'
  $tags = @(& docker image ls $imageRepo --format '{{.Repository}}:{{.Tag}}' 2>$null | Where-Object { $_ })
  foreach ($tag in $tags) {
    if ($tag -match ':sha-') {
      $rmi = Invoke-Logged -FilePath 'docker' -Arguments @('rmi', $tag) -AllowExitCodes @(0, 1) -NoThrow
      Write-Host "移除 $tag exit=$($rmi.ExitCode)"
    }
  }
}

if ($RemoveRuntime) {
  Remove-Item -Path $script:RuntimeDir -Recurse -Force -ErrorAction SilentlyContinue
  Write-Host "已删除 $($script:RuntimeDir)"
}

$devPgAfter = ((& docker ps -a --filter 'name=flower-v2-pg' --format '{{.ID}}|{{.Image}}|{{.Status}}' 2>&1) -join ' ').Trim()
if ($devPgBefore -and ($devPgAfter -ne $devPgBefore)) {
  Write-Host '[warn] 本地开发数据库容器状态发生变化（可能由其他任务导致），请人工确认'
  Write-Host "  before: $devPgBefore"
  Write-Host "  after : $devPgAfter"
} else {
  Write-Host "[OK] 未触碰原有本地开发数据库容器: $devPgAfter"
}

Write-Host '=== 清理完成 ==='
exit 0
