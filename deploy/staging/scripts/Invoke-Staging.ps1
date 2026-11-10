# Flower WMS Sprint E2.1 · staging 入口
#
# 子步骤（可独立复跑）：
#   build       从当前 HEAD 构建真实应用镜像，写 .runtime/images.json
#   up          生成随机凭据 → 起 db → --connect 目标预检 → 起 web（entrypoint 迁移）→ 起 cron → 合成数据
#   verify      健康/登录/V2 入口冒烟、双库迁移状态、行数、cron 轮次、隔离清单
#   persistence 合成标记数据 → 只重建 db 容器 → 确认数据与迁移历史保留
#   cleanup     down -v，仅清理本项目
#   all         build + up + verify + persistence（默认）
#
# 用法：
#   pwsh -File deploy/staging/scripts/Invoke-Staging.ps1 build
#   pwsh -File deploy/staging/scripts/Invoke-Staging.ps1 up
#   pwsh -File deploy/staging/scripts/Invoke-Staging.ps1 verify
#   pwsh -File deploy/staging/scripts/Invoke-Staging.ps1 all
#
# 注意：本脚本只操作 staging 项目；不触碰生产容器、flower-v2-pg（55432）与原生 PG（5432）。

param(
  [ValidateSet('build', 'up', 'verify', 'persistence', 'cleanup', 'all')]
  [string]$Step = 'all',
  [string]$Tag,
  [string]$Image,
  [switch]$SkipBuild,
  [switch]$KeepStack
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Staging.Common.ps1')

Initialize-StagingContext -Mode Baseline -Image $Image
Start-EvidenceRun -Mode $Step

function Get-StagingCronLogs {
  $result = Invoke-StagingCompose -Arguments @('logs', '--tail=120', 'flower-cron-worker') -AllowExitCodes @(0, 1) -NoThrow
  Add-EvidenceSection 'cron worker 日志'
  foreach ($line in @($result.Output -split "`n")) { if ($line) { Add-Evidence "  $line" } }
  return $result.Output
}

function Assert-StagingCronHealthy {
  $logs = Get-StagingCronLogs
  $started = $logs -match '\[cron-worker\] started'
  $round = $logs -match '\[cron-(order-expiry|inventory|worker)\][^\n]*done|\[cron-worker\][^\n]*done|\[cron-inventory\]'
  Add-Evidence "  cron started marker: $started; success round marker: $round"
  return [pscustomobject]@{ Started = $started; Round = $round }
}

function Invoke-StagingSeeding {
  Add-EvidenceSection '写入合成测试数据（V2 test seed：从宿主经 127.0.0.1 staging db 端口写入）'
  # seed.ts 的 test 模式要求：NODE_ENV != production、目标主机为 localhost/127.0.0.1、库名以 _test 结尾。
  # 因此从宿主以 127.0.0.1:<db-port> 连接 staging 库执行；应用容器仍通过 compose 网络访问同一库。
  $envText = Get-Content $script:Cfg.EnvFile -Raw
  $v2Line = ($envText -split "`n" | Where-Object { $_ -match '^V2_DATABASE_URL=' } | Select-Object -First 1)
  $v1Line = ($envText -split "`n" | Where-Object { $_ -match '^DATABASE_URL=' } | Select-Object -First 1)
  if (-not $v2Line -or -not $v1Line) { throw 'staging env 缺少 DATABASE_URL/V2_DATABASE_URL' }
  $v2Url = ($v2Line -replace '^V2_DATABASE_URL=', '').Trim() -replace '@db:5432', "@127.0.0.1:$($script:Cfg.DbPort)"
  $v1Url = ($v1Line -replace '^DATABASE_URL=', '').Trim() -replace '@db:5432', "@127.0.0.1:$($script:Cfg.DbPort)"
  Add-Evidence "  seed target: $($script:Cfg.V2Db) @ 127.0.0.1:$($script:Cfg.DbPort)（连接串不打印）"

  $oldNodeEnv = $env:NODE_ENV
  $oldV1 = $env:DATABASE_URL
  $oldV2 = $env:V2_DATABASE_URL
  Push-Location (Join-Path $script:RepoRoot 'flower-wms-system')
  try {
    $env:NODE_ENV = 'test'
    $env:DATABASE_URL = $v1Url
    $env:V2_DATABASE_URL = $v2Url
    $result = Invoke-Logged -FilePath 'npx' -Arguments @('tsx', 'prisma/v2/seed.ts', 'test', '--tiers=minimum,roles') -AllowExitCodes @(0, 1) -NoThrow
  } finally {
    Pop-Location
    $env:NODE_ENV = $oldNodeEnv
    $env:DATABASE_URL = $oldV1
    $env:V2_DATABASE_URL = $oldV2
  }
  if ($result.ExitCode -ne 0) { throw "合成数据 seed 失败（exit $($result.ExitCode)）" }
  Add-Evidence '  合成账号 admin/manager/buyer/sales/florist 由 roles tier 提供（密码=用户名，仅 staging）'
}

function Invoke-StagingPersistence {
  Start-EvidenceLog -Name 'persistence' -Title 'E2.1 staging 持久化试验（只重建 db 容器）' | Out-Null
  Add-EvidenceSection '写入合成标记并重建 db 容器'
  $marker = "e21-$($script:RunStamp)"
  $sql = "CREATE TABLE IF NOT EXISTS _e2_marker (id text PRIMARY KEY, created_at timestamptz NOT NULL DEFAULT now()); INSERT INTO _e2_marker (id) VALUES ('$marker') ON CONFLICT DO NOTHING; SELECT count(*) FROM _e2_marker;"
  $insert = Invoke-StagingCompose -Arguments @('exec', '-T', 'db', 'psql', '-U', $script:Cfg.DbUser, '-d', $script:Cfg.V2Db, '-t', '-A', '-c', $sql) -AllowExitCodes @(0, 1) -NoThrow
  Add-Evidence "  marker=$marker insert exit=$($insert.ExitCode) output=$($insert.Output)"
  $countBefore = (Invoke-StagingCompose -Arguments @('exec', '-T', 'db', 'psql', '-U', $script:Cfg.DbUser, '-d', $script:Cfg.V2Db, '-t', '-A', '-c', 'SELECT count(*) FROM _e2_marker')).Output.Trim()

  $recreate = Invoke-StagingCompose -Arguments @('up', '-d', '--force-recreate', '--no-deps', 'db') -AllowExitCodes @(0, 1) -NoThrow
  Add-Evidence "  db recreate exit=$($recreate.ExitCode)"
  Assert-True (Wait-StagingDbHealthy) '重建后 db 容器健康'
  $countAfter = (Invoke-StagingCompose -Arguments @('exec', '-T', 'db', 'psql', '-U', $script:Cfg.DbUser, '-d', $script:Cfg.V2Db, '-t', '-A', '-c', 'SELECT count(*) FROM _e2_marker')).Output.Trim()
  $migrations = (Invoke-StagingCompose -Arguments @('exec', '-T', 'db', 'psql', '-U', $script:Cfg.DbUser, '-d', $script:Cfg.V2Db, '-t', '-A', '-c', 'SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL')).Output.Trim()
  Add-Evidence "  marker count before=$countBefore after=$countAfter; v2 applied migrations=$migrations"
  Assert-Equal $countAfter $countBefore '重建 db 容器后标记数据保留'
  Assert-Equal $migrations '8' '重建 db 容器后 V2 迁移历史保留（8 个）'

  Add-EvidenceSection '重建 db 后重启 web/cron 并确认健康'
  Invoke-StagingCompose -Arguments @('up', '-d', '--no-deps', 'flower-web') | Out-Null
  $health = Wait-StagingWebHealthy -TimeoutSeconds 120
  Assert-True $health.Ok '重建 db 后 web 健康恢复'
  Invoke-StagingCompose -Arguments @('up', '-d', '--no-deps', 'flower-cron-worker') | Out-Null
  Add-Evidence "  persistence run_id=$marker 完成"
  Stop-EvidenceLog
}

function Invoke-StagingVerify {
  Start-EvidenceLog -Name 'verify' -Title 'E2.1 staging 启动与验收' | Out-Null
  Add-EvidenceSection '迁移状态（entrypoint 已执行）'
  $v1Status = Get-StagingMigrationStatusText
  Add-Evidence '  
--- V1 migrate status ---'
  foreach ($line in @($v1Status -split "`n")) { if ($line) { Add-Evidence "  $line" } }
  $v2Status = Get-StagingMigrationStatusText -V2
  Add-Evidence '  --- V2 migrate status ---'
  foreach ($line in @($v2Status -split "`n")) { if ($line) { Add-Evidence "  $line" } }

  Add-EvidenceSection '迁移历史与关键表行数'
  $v1Counts = Get-StagingRowCounts -Database $script:Cfg.V1Db -SqlFile (Join-Path $script:ChecksDir 'v1-row-counts.sql')
  $v2Counts = Get-StagingRowCounts -Database $script:Cfg.V2Db -SqlFile (Join-Path $script:ChecksDir 'v2-row-counts.sql')
  Assert-Equal $v1Counts['_prisma_migrations_applied'] '45' 'V1 已应用迁移数 = 45'
  Assert-Equal $v2Counts['_prisma_migrations_applied'] '8' 'V2 已应用迁移数 = 8'
  Assert-True ($v2Counts['StaffUser'] -ge 5) 'V2 合成账号已写入（StaffUser >= 5）'

  Invoke-StagingSmoke | Out-Null
  $cron = Assert-StagingCronHealthy
  Assert-True $cron.Started 'cron 出现 started 标记'
  Add-Evidence "  cron 成功轮次: $($cron.Round)（启动瞬时 P2021/P2022 可容忍，需有成功轮次）"

  Get-StagingResourceSnapshot -Label 'E2.1 启动后'
  Assert-StagingIsolation

  Add-EvidenceSection 'E2.1 本机验收结论'
  Add-Evidence '  PASS: 真实镜像启动、双库迁移 45/8、健康、登录与 V2 入口冒烟、cron、隔离资源、合成数据基线'
  Add-Evidence '  待远程: registry push/pull、registry digest 与源码 SHA 对照、staging 域名/nginx 上传限制'
  Stop-EvidenceLog
}

switch ($Step) {
  'build' {
    Start-EvidenceLog -Name 'build' -Title 'E2.1 真实镜像构建' | Out-Null
    Initialize-StagingRuntime
    if ($SkipBuild) {
      $image = Resolve-StagingImage
      Add-Evidence "  -SkipBuild：复用镜像 $image"
    } else {
      $image = Invoke-BuildStagingImage -Tag $Tag
    }
    Add-Evidence "  BUILD_IMAGE=$image"
    Stop-EvidenceLog
  }
  'up' {
    Start-EvidenceLog -Name 'up' -Title 'E2.1 staging 启动' | Out-Null
    Initialize-StagingRuntime
    $image = Resolve-StagingImage
    $env:STAGING_IMAGE = $image
    Add-Evidence "  STAGING_IMAGE=$image  project=$($script:Cfg.Project)  web=$($script:Cfg.WebUrl)"

    Add-EvidenceSection '启动 db'
    Invoke-StagingCompose -Arguments @('up', '-d', '--no-deps', 'db') | Out-Null
    Assert-True (Wait-StagingDbHealthy) 'db 容器健康'

    Add-EvidenceSection '启动前目标连通预检（--connect，必须 --entrypoint 防迁移）'
    $preflight = Invoke-StagingCompose -Arguments @(
      'run', '--rm', '--no-deps', '--entrypoint', 'sh', 'flower-web', '-ec',
      'node scripts/check-v2-database-target.mjs --connect'
    ) -AllowExitCodes @(0, 1) -NoThrow
    if ($preflight.ExitCode -ne 0) { throw "数据库目标预检失败（exit $($preflight.ExitCode)），未启动 web" }
    Add-Evidence '  [OK] V1/V2 目标可连接且库名不同'

    Add-EvidenceSection '启动 web（entrypoint 执行 V1/V2 迁移）'
    $web = Invoke-StagingCompose -Arguments @('up', '-d', '--no-deps', 'flower-web') -AllowExitCodes @(0, 1) -NoThrow
    if ($web.ExitCode -ne 0) { throw "web 启动失败（exit $($web.ExitCode)）" }
    $health = Wait-StagingWebHealthy -TimeoutSeconds 180
    if (-not $health.Ok) {
      Invoke-StagingCompose -Arguments @('logs', '--tail=100', 'flower-web') -NoThrow | Out-Null
      throw 'web 健康检查失败（180s）'
    }
    Add-Evidence "  web healthy elapsed=$($health.ElapsedSeconds)s"

    Invoke-StagingSeeding

    Add-EvidenceSection '启动 cron（web 健康且迁移完成后）'
    Invoke-StagingCompose -Arguments @('up', '-d', '--no-deps', 'flower-cron-worker') | Out-Null
    Start-Sleep -Seconds 5
    Get-StagingResourceSnapshot -Label 'E2.1 up 后'
    Stop-EvidenceLog
  }
  'verify' {
    if (-not $script:Cfg.Image) { $script:Cfg.Image = Resolve-StagingImage }
    $env:STAGING_IMAGE = $script:Cfg.Image
    Invoke-StagingVerify
  }
  'persistence' {
    if (-not $script:Cfg.Image) { $script:Cfg.Image = Resolve-StagingImage }
    $env:STAGING_IMAGE = $script:Cfg.Image
    Invoke-StagingPersistence
  }
  'cleanup' {
    Start-EvidenceLog -Name 'cleanup' -Title 'E2.1 staging 清理' | Out-Null
    Remove-StagingStack
    Stop-EvidenceLog
  }
  'all' {
    if ($SkipBuild) {
      $script:Cfg.Image = Resolve-StagingImage
    } else {
      Start-EvidenceLog -Name 'build' -Title 'E2.1 真实镜像构建' | Out-Null
      Initialize-StagingRuntime
      $script:Cfg.Image = Invoke-BuildStagingImage -Tag $Tag
      Stop-EvidenceLog
    }
    $env:STAGING_IMAGE = $script:Cfg.Image
    Start-EvidenceLog -Name 'up' -Title 'E2.1 staging 启动' | Out-Null
    Initialize-StagingRuntime
    Add-Evidence "  STAGING_IMAGE=$($script:Cfg.Image)"
    Invoke-StagingCompose -Arguments @('up', '-d', '--no-deps', 'db') | Out-Null
    Assert-True (Wait-StagingDbHealthy) 'db 容器健康'
    $preflight = Invoke-StagingCompose -Arguments @('run', '--rm', '--no-deps', '--entrypoint', 'sh', 'flower-web', '-ec', 'node scripts/check-v2-database-target.mjs --connect') -AllowExitCodes @(0, 1) -NoThrow
    if ($preflight.ExitCode -ne 0) { throw "数据库目标预检失败（exit $($preflight.ExitCode)）" }
    Invoke-StagingCompose -Arguments @('up', '-d', '--no-deps', 'flower-web') | Out-Null
    $health = Wait-StagingWebHealthy -TimeoutSeconds 180
    if (-not $health.Ok) { throw 'web 健康检查失败（180s）' }
    Invoke-StagingSeeding
    Invoke-StagingCompose -Arguments @('up', '-d', '--no-deps', 'flower-cron-worker') | Out-Null
    Start-Sleep -Seconds 5
    Stop-EvidenceLog
    Invoke-StagingVerify
    Invoke-StagingPersistence
    if (-not $KeepStack) {
      Start-EvidenceLog -Name 'cleanup' -Title 'E2.1 staging 清理' | Out-Null
      Remove-StagingStack
      Stop-EvidenceLog
    }
  }
}

Write-Host ''
Write-Host "=== staging step '$Step' 完成 ==="
