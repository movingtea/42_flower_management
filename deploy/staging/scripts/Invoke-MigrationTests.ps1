# Flower WMS Sprint E2.4 · 迁移前后验证场景驱动
#
# 场景：
#   empty       实际镜像在空库上应用 V1/V2 迁移，核对迁移历史、schema 一致性、关键表
#   incremental 从已知旧 schema（提交 1c71923，V2 7 个迁移）现场构建上一版镜像，
#               迁移到当前 HEAD（V2 8 个迁移），核对 7→8、行数不变、schema 与旧镜像兼容性
#
# 用法：
#   pwsh -File deploy/staging/scripts/Invoke-MigrationTests.ps1 -Scenario empty
#   pwsh -File deploy/staging/scripts/Invoke-MigrationTests.ps1 -Scenario incremental [-SkipPrevImageBuild]
#
# 证据：docs/evidence/sprint-e2/logs/e24-migration-<scenario>-<run_id>.log
# 说明：只在独立 verify 项目（flower-e2-verify）操作，不触碰 staging 基线库。

param(
  [ValidateSet('empty', 'incremental', 'all')]
  [string]$Scenario = 'all',
  [switch]$SkipPrevImageBuild
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Staging.Common.ps1')

Initialize-StagingContext -Mode Verify
Start-EvidenceRun -Mode "migration-$Scenario"
Start-EvidenceLog -Name "migration-$Scenario" -Title "E2.4 迁移验证（$Scenario）" -Package '4' | Out-Null
Initialize-StagingRuntime

$currentImage = Resolve-StagingImage
$prevImage = 'flower-e2-prev:1c71923'
$script:Cfg.Image = $currentImage
$env:STAGING_IMAGE = $currentImage
$worktree = Join-Path $script:RuntimeDir 'worktrees\prev-1c71923'

function Set-Image([string]$Image) {
  $script:Cfg.Image = $Image
  $env:STAGING_IMAGE = $Image
  Add-Evidence "  [image] $Image"
}

function Reset-VerifyProject {
  Add-EvidenceSection '重置 verify 项目（独立库对）'
  Invoke-StagingCompose -Arguments @('down', '-v', '--remove-orphans') -AllowExitCodes @(0, 1) -NoThrow | Out-Null
  Invoke-StagingCompose -Arguments @('up', '-d', '--no-deps', 'db') | Out-Null
  Assert-True (Wait-StagingDbHealthy) 'verify db 健康'
}

function Start-WebAndWait([int]$TimeoutSeconds = 180) {
  Invoke-StagingCompose -Arguments @('up', '-d', '--no-deps', 'flower-web') -AllowExitCodes @(0, 1) -NoThrow | Out-Null
  return (Wait-StagingWebHealthy -TimeoutSeconds $TimeoutSeconds)
}

function Assert-MigrationCount([string]$Db, [long]$Expected, [string]$Label) {
  $applied = (Invoke-StagingCompose -Arguments @('exec', '-T', 'db', 'psql', '-U', $script:Cfg.DbUser, '-d', $Db, '-t', '-A', '-c', 'SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL')).Output.Trim()
  Add-Evidence "  ${Label} applied_migrations=$applied（期望 $Expected）"
  Assert-Equal $applied "$Expected" "$Label 迁移数"
}

function Assert-MigrateCheckClean {
  Add-EvidenceSection 'V2 schema 一致性（prisma migrate diff --exit-code）'
  $r = Invoke-StagingCompose -Arguments @('run', '--rm', '--no-deps', '--entrypoint', 'sh', 'flower-web', '-ec', 'npm run db:v2:migrate:check') -AllowExitCodes @(0, 1, 2) -NoThrow
  Add-Evidence "  exit=$($r.ExitCode)"
  Add-Evidence "  output: $($r.Output)"
  Assert-True ($r.ExitCode -eq 0) '迁移与 schema 无差异'
}

function Assert-Schema0008 {
  $lines = Invoke-StagingPsqlFile -Database $script:Cfg.V2Db -SqlFile (Join-Path $script:ChecksDir 'v2-schema-0008.sql')
  $bad = @()
  foreach ($line in $lines) {
    if ($line -match '^(?<item>[^|]+)\|(?<value>\d+)$' -and [int]$Matches['value'] -lt 1) { $bad += $Matches['item'] }
  }
  Assert-True ($bad.Count -eq 0) "V2 0008 schema 核对（缺失：$($bad -join ', ')）"
}

function Get-Counts([string]$Db, [string]$Sql) {
  return (Get-StagingRowCounts -Database $Db -SqlFile (Join-Path $script:ChecksDir $Sql))
}

function Compare-Counts($Before, $After, [string]$Label, [string[]]$IgnoreKeys = @()) {
  $diff = @()
  foreach ($k in $Before.Keys) {
    if ($IgnoreKeys -contains $k) { continue }
    $a = [long]$Before[$k]; $b = if ($After.Contains($k)) { [long]$After[$k] } else { -1 }
    if ($a -ne $b) { $diff += "${k}:$a->$b" }
  }
  Add-Evidence "  ${Label} rowcount_diff=$($diff -join ',')"
  Assert-True ($diff.Count -eq 0) "$Label 迁移前后关键表行数不变"
  return $diff
}

# ---------- 上一版镜像构建 ----------
function Build-PrevImage {
  Add-EvidenceSection '构建上一版镜像（提交 1c71923，V2 7 个迁移）'
  if (-not (Test-Path $worktree)) {
    $wt = Invoke-Logged -FilePath 'git' -Arguments @('-C', $script:RepoRoot, 'worktree', 'add', $worktree, '1c71923') -AllowExitCodes @(0, 1) -NoThrow
    if ($wt.ExitCode -ne 0) { throw "git worktree add 失败（exit $($wt.ExitCode)）" }
  } else {
    Add-Evidence "  复用已有 worktree：deploy/staging/.runtime/worktrees/prev-1c71923"
  }
  $prevMigrations = (Get-ChildItem (Join-Path $worktree 'flower-wms-system\prisma\v2\migrations') -Directory | Where-Object { $_.Name -match '^\d{4}_' }).Count
  Add-Evidence "  prev_v2_migrations=$prevMigrations（期望 7）"
  Assert-Equal $prevMigrations 7 '上一版 V2 迁移数'

  $depsImage = 'flower-e2-deps:1c71923'
  $cache = (npm config get cache 2>$null).Trim()
  Add-Evidence "  host_npm_cache=$cache（仅用于本地依赖缓存挂载，不写日志内容）"

  docker rm -f e24-deps 2>$null | Out-Null
  $run = Invoke-Logged -FilePath 'docker' -Arguments @('run', '-d', '--name', 'e24-deps', '--network=host', '-w', '/app', '-v', "${cache}:/root/.npm", 'node:22-alpine', 'sleep', '1800') -AllowExitCodes @(0, 1) -NoThrow
  if ($run.ExitCode -ne 0) { throw '启动 deps 构建容器失败' }
  try {
    Invoke-Logged -FilePath 'docker' -Arguments @('cp', (Join-Path $worktree 'flower-wms-system\package.json'), 'e24-deps:/app/package.json') | Out-Null
    Invoke-Logged -FilePath 'docker' -Arguments @('cp', (Join-Path $worktree 'flower-wms-system\package-lock.json'), 'e24-deps:/app/package-lock.json') | Out-Null
    $ci = Invoke-Logged -FilePath 'docker' -Arguments @('exec', 'e24-deps', 'sh', '-c', 'npm ci --prefer-offline --no-audit --no-fund --registry=https://registry.npmjs.org --replace-registry-host=always') -AllowExitCodes @(0, 1) -NoThrow
    if ($ci.ExitCode -ne 0) { throw "上一版依赖安装失败（exit $($ci.ExitCode)）" }
    Invoke-Logged -FilePath 'docker' -Arguments @('commit', 'e24-deps', $depsImage) | Out-Null
    Add-Evidence "  deps_image=$depsImage"
  } finally {
    docker rm -f e24-deps 2>$null | Out-Null
  }

  $buildDir = Join-Path $worktree '.e2build'
  New-Item -ItemType Directory -Force -Path $buildDir | Out-Null
  Copy-Item (Join-Path $script:StagingDir 'images\Dockerfile.staging-offline') (Join-Path $buildDir 'Dockerfile') -Force
  $buildLogRel = "docs/evidence/sprint-e2/logs/e24-build-prev-1c71923-$($script:RunStamp).log"
  $buildLog = Join-Path $script:RepoRoot $buildLogRel.Replace('/', '\')
  $lines = Invoke-Logged -FilePath 'docker' -Arguments @(
    'build', '--progress=plain', '--platform', 'linux/amd64',
    '-f', (Join-Path $buildDir 'Dockerfile'),
    '--build-arg', "NEXT_PUBLIC_API_URL=$($script:Cfg.WebUrl)",
    '--build-arg', "NEXT_PUBLIC_ASSET_BASE_URL=$($script:Cfg.WebUrl)",
    '-t', $prevImage, $worktree
  ) -AllowExitCodes @(0, 1) -NoThrow
  if ($lines.ExitCode -ne 0) { throw "上一版镜像构建失败（exit $($lines.ExitCode)）" }
  Add-Evidence "  prev_image=$prevImage id=$((Get-StagingImageId -Reference $prevImage))"
}

# ---------- 空库场景 ----------
function Invoke-EmptyScenario {
  Add-EvidenceSection '场景 empty：空库迁移（实际镜像）'
  Reset-VerifyProject
  Set-Image $currentImage
  $health = Start-WebAndWait
  Assert-True $health.Ok "空库 web 健康（elapsed=$($health.ElapsedSeconds)s）"
  Assert-MigrationCount -Db $script:Cfg.V1Db -Expected 45 -Label 'V1'
  Assert-MigrationCount -Db $script:Cfg.V2Db -Expected 8 -Label 'V2'
  Assert-MigrateCheckClean
  Assert-Schema0008
  $counts = Get-Counts -Db $script:Cfg.V2Db -Sql 'v2-row-counts.sql'
  Add-Evidence "  V2 Tenant=$($counts['Tenant']) Store=$($counts['Store']) StaffUser=$($counts['StaffUser'])"
  $script:EmptyPass = $true
}

# ---------- 增量场景 ----------
function Invoke-IncrementalScenario {
  Add-EvidenceSection '场景 incremental：1c71923（7 迁移）→ HEAD（8 迁移）'
  if (-not (Test-Path $worktree) -or (Get-StagingImageId -Reference $prevImage) -eq $null) {
    if ($SkipPrevImageBuild) { throw "缺少上一版镜像 $prevImage；先不带 -SkipPrevImageBuild 运行" }
    Build-PrevImage
  }
  Reset-VerifyProject
  Set-Image $prevImage
  $oldHealth = Start-WebAndWait
  Assert-True $oldHealth.Ok "上一版镜像在 7 迁移库上健康（elapsed=$($oldHealth.ElapsedSeconds)s）"
  Assert-MigrationCount -Db $script:Cfg.V2Db -Expected 7 -Label 'V2(prev)'

  Add-EvidenceSection '写入代表性合成数据（上一版镜像的 production 初始化：minimum + 1 admin）'
  $pw = 'E24' + (New-StagingRandom -Length 16 -CharSets @('ABCDEFGHJKLMNPQRSTUVWXYZ', 'abcdefghijkmnpqrstuvwxyz', '23456789'))
  $pwFile = Join-Path $script:SecretsDir 'e24-prev-bootstrap-password.txt'
  Set-Content -Path $pwFile -Value $pw -Encoding utf8NoBOM
  $seed = Invoke-StagingCompose -Arguments @(
    'run', '--rm', '--no-deps',
    '-e', 'V2_BOOTSTRAP_ADMIN_USERNAME=e24_prev_admin',
    '-e', 'V2_BOOTSTRAP_ADMIN_PASSWORD_FILE=/run/e24pw',
    '-v', "${pwFile}:/run/e24pw:ro",
    '--entrypoint', 'sh', 'flower-web', '-ec',
    'npx tsx prisma/v2/seed.ts production'
  ) -AllowExitCodes @(0, 1) -NoThrow
  if ($seed.ExitCode -ne 0) { throw "上一版 production 初始化失败（exit $($seed.ExitCode)）" }
  $beforeV2 = Get-Counts -Db $script:Cfg.V2Db -Sql 'v2-row-counts.sql'
  $beforeV1 = Get-Counts -Db $script:Cfg.V1Db -Sql 'v1-row-counts.sql'
  Add-Evidence "  迁移前 V2 Tenant=$($beforeV2['Tenant']) Store=$($beforeV2['Store']) StaffUser=$($beforeV2['StaffUser']) Material=$($beforeV2['Material'])"

  Add-EvidenceSection '切换当前镜像（entrypoint 应用 0008）'
  Invoke-StagingCompose -Arguments @('stop', 'flower-web') -AllowExitCodes @(0, 1) -NoThrow | Out-Null
  Invoke-StagingCompose -Arguments @('rm', '-f', 'flower-web') -AllowExitCodes @(0, 1) -NoThrow | Out-Null
  Set-Image $currentImage
  $newHealth = Start-WebAndWait
  Assert-True $newHealth.Ok "新镜像在 8 迁移库上健康（elapsed=$($newHealth.ElapsedSeconds)s）"
  Assert-MigrationCount -Db $script:Cfg.V2Db -Expected 8 -Label 'V2(new)'
  Assert-MigrationCount -Db $script:Cfg.V1Db -Expected 45 -Label 'V1'
  Assert-MigrateCheckClean
  Assert-Schema0008
  $afterV2 = Get-Counts -Db $script:Cfg.V2Db -Sql 'v2-row-counts.sql'
  $afterV1 = Get-Counts -Db $script:Cfg.V1Db -Sql 'v1-row-counts.sql'
  Compare-Counts -Before $beforeV2 -After $afterV2 -Label 'V2' -IgnoreKeys @('_prisma_migrations_applied')
  Compare-Counts -Before $beforeV1 -After $afterV1 -Label 'V1'

  Add-EvidenceSection '旧镜像兼容性（新 schema 上启动上一版镜像）'
  Invoke-StagingCompose -Arguments @('stop', 'flower-web') -AllowExitCodes @(0, 1) -NoThrow | Out-Null
  Invoke-StagingCompose -Arguments @('rm', '-f', 'flower-web') -AllowExitCodes @(0, 1) -NoThrow | Out-Null
  Set-Image $prevImage
  $compat = Start-WebAndWait
  Add-Evidence "  old image on 8-migration schema health_ok=$($compat.Ok) elapsed=$($compat.ElapsedSeconds)s"
  Assert-True $compat.Ok '上一版镜像可在已前滚 schema 上启动并通过健康检查'
  Assert-MigrationCount -Db $script:Cfg.V2Db -Expected 8 -Label 'V2(after old image)'
  $script:IncrementalPass = $true
}

try {
  if ($Scenario -eq 'empty' -or $Scenario -eq 'all') { Invoke-EmptyScenario }
  if ($Scenario -eq 'incremental' -or $Scenario -eq 'all') {
    if ($Scenario -eq 'all' -and -not $SkipPrevImageBuild) { Build-PrevImage }
    Invoke-IncrementalScenario
  }
  Add-EvidenceSection 'E2.4 场景结论'
  if ($script:EmptyPass) { Add-Evidence '  empty = PASS（V1 45 / V2 8，schema 无差异，0008 核对通过）' }
  if ($script:IncrementalPass) { Add-Evidence '  incremental = PASS（7→8，行数不变，旧镜像兼容）' }
  Stop-EvidenceLog
  Write-Host 'MIGRATION_TESTS_OK'
  exit 0
}
finally {
  Add-EvidenceSection '清理 verify 项目'
  Invoke-StagingCompose -Arguments @('down', '-v', '--remove-orphans') -AllowExitCodes @(0, 1) -NoThrow | Out-Null
  if ($null -ne $script:CurrentLog) { Stop-EvidenceLog }
}

