# Flower WMS Sprint E2 · staging 公共函数库
#
# 由 deploy/staging/scripts/Invoke-Staging.ps1 等入口点源引用。
# 设计目标：隔离（项目/端口/库/卷/网络）、可复跑、证据可审计。
# 证据写入 docs/evidence/sprint-e2/logs/e2x-*.log；凭据只写 .runtime/，不写日志。
#
# 安全边界：
#   - 只操作 STAGING_PROJECT 对应的 compose 项目；不触碰生产 *-prod、flower-v2-pg、原生 PG。
#   - 不执行 docker system prune -a --volumes。
#   - 所有容器内命令显式 --entrypoint，避免预检触发迁移。

$ErrorActionPreference = 'Stop'

# ---------- 路径与默认值 ----------
$script:StagingDir    = Split-Path -Parent $PSScriptRoot
$script:RepoRoot      = Split-Path -Parent (Split-Path -Parent $script:StagingDir)
$script:ComposeFile   = Join-Path $script:StagingDir 'compose\docker-compose.staging.yml'
$script:RuntimeDir    = Join-Path $script:StagingDir '.runtime'
$script:BackupDir     = Join-Path $script:RuntimeDir 'backup'
$script:SecretsDir    = Join-Path $script:RuntimeDir 'secrets'
$script:EnvTemplate   = Join-Path $script:StagingDir 'env\staging.env.example'
$script:ChecksDir     = Join-Path $script:StagingDir 'db\checks'
$script:EvidenceDir   = Join-Path $script:RepoRoot 'docs\evidence\sprint-e2\logs'
$script:RunStamp      = Get-Date -Format 'yyyyMMdd-HHmmss'
$script:CurrentLog    = $null
$script:EvidenceFiles = @()
$script:Cfg           = $null

# ---------- 上下文 ----------
function Initialize-StagingContext {
  param(
    [ValidateSet('Baseline', 'Verify')][string]$Mode = 'Baseline',
    [string]$Image,
    [string]$Project,
    [int]$WebPort,
    [int]$DbPort
  )

  if ($Mode -eq 'Verify') {
    $defaultProject = 'flower-e2-verify'
    $defaultWebPort = 18082
    $defaultDbPort  = 15434
    $defaultEnvName = 'verify'
    $defaultV1Db    = 'flower_e2_verify_v1'
    $defaultV2Db    = 'flower_e2_verify_v2_test'
  } else {
    $defaultProject = 'flower-e2-staging'
    $defaultWebPort = 18081
    $defaultDbPort  = 15433
    $defaultEnvName = 'staging'
    $defaultV1Db    = 'flower_e2_v1'
    $defaultV2Db    = 'flower_e2_v2_test'
  }

  if (-not $Project) { $Project = $defaultProject }
  if (-not $WebPort) { $WebPort = $defaultWebPort }
  if (-not $DbPort) { $DbPort = $defaultDbPort }

  $dbUser = 'flower_e2_stage'
  $webUrl = "http://127.0.0.1:$WebPort"

  $script:Cfg = [pscustomobject]@{
    Mode       = $Mode
    Project    = $Project
    WebPort    = [int]$WebPort
    DbPort     = [int]$DbPort
    EnvName    = $defaultEnvName
    EnvFile    = (Join-Path $script:RuntimeDir "$defaultEnvName.env")
    DbUser     = $dbUser
    V1Db       = $defaultV1Db
    V2Db       = $defaultV2Db
    WebUrl     = $webUrl
    HealthUrl  = "$webUrl/api/health"
    Image      = $Image
  }

  # compose 插值与容器名派生
  $env:STAGING_PROJECT   = $Project
  $env:STAGING_WEB_PORT  = "$WebPort"
  $env:STAGING_DB_PORT   = "$DbPort"
  $env:STAGING_ENV_NAME  = $defaultEnvName
  if ($Image) { $env:STAGING_IMAGE = $Image }
}

function Assert-StagingContext {
  if (-not $script:Cfg) { throw '先调用 Initialize-StagingContext' }
}

# ---------- 证据日志 ----------
function Start-EvidenceRun {
  param([string]$Mode)
  if (-not (Test-Path $script:EvidenceDir)) {
    New-Item -ItemType Directory -Force -Path $script:EvidenceDir | Out-Null
  }
  $script:RunMode = $Mode
  Write-Host "[evidence] 证据目录: $($script:EvidenceDir)"
}

function Start-EvidenceLog {
  param(
    [Parameter(Mandatory)][string]$Name,
    [Parameter(Mandatory)][string]$Title,
    [string]$Package = '1'
  )
  Assert-StagingContext
  $file = Join-Path $script:EvidenceDir ("e2{0}-{1}-{2}.log" -f $Package, $Name, $script:RunStamp)
  $gitHead = ''
  $gitBranch = ''
  try {
    $gitHead = (& git -C $script:RepoRoot rev-parse --short HEAD 2>$null)
    $gitBranch = (& git -C $script:RepoRoot rev-parse --abbrev-ref HEAD 2>$null)
  } catch {
    $gitBranch = 'unknown'
  }
  $header = @(
    "### Sprint E2 staging 证据 · $Title"
    "run_id: $($script:RunStamp)"
    "recorded_at: $((Get-Date).ToString('o'))"
    "mode: $($script:RunMode)"
    "host: $env:COMPUTERNAME / PowerShell $($PSVersionTable.PSVersion)"
    "repo: CMS_and_WMS (branch=$gitBranch, HEAD=$gitHead)"
    "compose_project: $($script:Cfg.Project)"
    "staging_web: $($script:Cfg.WebUrl)  staging_db_port: $($script:Cfg.DbPort)"
    "logs_redaction: 连接串密码、AUTH_SECRET 等敏感值不写入本日志。"
    "---"
  )
  Set-Content -Path $file -Value $header -Encoding utf8NoBOM
  $script:CurrentLog = $file
  $script:EvidenceFiles += $file
  Write-Host "[evidence] $file"
  return $file
}

function Add-Evidence {
  param([Parameter(ValueFromPipeline = $true)][string[]]$Text)
  process {
    foreach ($line in $Text) {
      if ($null -ne $script:CurrentLog) {
        Add-Content -Path $script:CurrentLog -Value $line -Encoding utf8NoBOM
      }
      Write-Host $line
    }
  }
}

function Add-EvidenceSection {
  param([string]$Title)
  Add-Evidence ("`n===== {0} =====" -f $Title)
}

function Stop-EvidenceLog {
  if ($null -ne $script:CurrentLog) {
    Add-Evidence ''
    Add-Evidence "=== 证据结束: $(Split-Path -Leaf $script:CurrentLog) ==="
    $script:CurrentLog = $null
  }
}

# ---------- 命令执行 ----------
function Invoke-Logged {
  param(
    [Parameter(Mandatory)][string]$FilePath,
    [string[]]$Arguments = @(),
    [int[]]$AllowExitCodes = @(0),
    [switch]$NoThrow,
    [switch]$NoEcho
  )
  $cmdLine = "$FilePath $($Arguments -join ' ')"
  if (-not $NoEcho) { Add-Evidence "`$ $cmdLine" }
  $output = & $FilePath @Arguments 2>&1 | ForEach-Object {
    $text = "$_"
    if ($text -eq 'System.Management.Automation.RemoteException') { return }
    $text
  }
  if (-not $NoEcho) {
    foreach ($line in $output) { Add-Evidence "  $line" }
    Add-Evidence "[exit code: $LASTEXITCODE]"
  }
  $code = $LASTEXITCODE
  if (($AllowExitCodes -notcontains $code) -and (-not $NoThrow)) {
    throw "命令失败（期望退出码 $($AllowExitCodes -join '/')，实际 $code）：$cmdLine"
  }
  return [pscustomobject]@{ ExitCode = $code; Output = ($output -join "`n"); CommandLine = $cmdLine }
}

function Get-StagingComposeArgs {
  Assert-StagingContext
  return @('compose', '-p', $script:Cfg.Project, '-f', $script:ComposeFile)
}

function Invoke-StagingCompose {
  param(
    [Parameter(Mandatory)][string[]]$Arguments,
    [int[]]$AllowExitCodes = @(0),
    [switch]$NoThrow
  )
  $all = @(Get-StagingComposeArgs) + $Arguments
  return Invoke-Logged -FilePath 'docker' -Arguments $all -AllowExitCodes $AllowExitCodes -NoThrow:$NoThrow
}

# ---------- 运行时初始化 ----------
function New-StagingRandom {
  param([int]$Length, [string[]]$CharSets)
  $chars = for ($i = 0; $i -lt $Length; $i++) {
    $set = $CharSets[$i % $CharSets.Count]
    ($set.ToCharArray() | Get-Random)
  }
  return (-join $chars)
}

function Initialize-StagingRuntime {
  Assert-StagingContext
  Add-EvidenceSection '生成 staging 运行时 env 与随机本地凭据（不写入日志）'
  foreach ($dir in @($script:RuntimeDir, $script:BackupDir, $script:SecretsDir)) {
    New-Item -ItemType Directory -Force -Path $dir | Out-Null
  }

  if (Test-Path $script:Cfg.EnvFile) {
    Add-Evidence "  复用已有 env: $($script:Cfg.EnvFile)（随机凭据保持不变）"
    return
  }

  $dbPassword = 'E2' + (New-StagingRandom -Length 20 -CharSets @('ABCDEFGHJKLMNPQRSTUVWXYZ', 'abcdefghijkmnpqrstuvwxyz', '23456789'))
  $authSecret = New-StagingRandom -Length 48 -CharSets @('ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789')
  $template = Get-Content $script:EnvTemplate -Raw
  $envText = $template.
    Replace('flower_e2_v2_test', $script:Cfg.V2Db).
    Replace('flower_e2_v1', $script:Cfg.V1Db).
    Replace('__STAGING_DB_PASSWORD__', $dbPassword).
    Replace('__STAGING_AUTH_SECRET__', $authSecret).
    Replace('flower_e2_stage', $script:Cfg.DbUser).
    Replace('__STAGING_WEB_URL__', $script:Cfg.WebUrl)
  Set-Content -Path $script:Cfg.EnvFile -Value $envText -Encoding utf8NoBOM
  Add-Evidence "  env: deploy/staging/.runtime/$($script:Cfg.EnvName).env（随机密码/AUTH_SECRET 已生成，未打印）"
  Assert-True (Test-Path $script:Cfg.EnvFile) 'staging env 已生成'
}

# ---------- 镜像 ----------
function Get-StagingImageId {
  param([Parameter(Mandatory)][string]$Reference)
  $out = & docker image inspect $Reference --format '{{.Id}}' 2>$null
  if ($LASTEXITCODE -ne 0) { return $null }
  return ("$out" | Select-Object -First 1).Trim()
}

function Resolve-StagingImage {
  Assert-StagingContext
  if ($script:Cfg.Image) {
    $image = Get-StagingImageId -Reference $script:Cfg.Image
    if (-not $image) { throw "指定镜像不存在: $($script:Cfg.Image)" }
    return $script:Cfg.Image
  }
  $manifest = Join-Path $script:RuntimeDir 'images.json'
  if (Test-Path $manifest) {
    $entries = @(Get-Content $manifest -Raw | ConvertFrom-Json)
    if ($entries.Count -gt 0) {
      $latest = $entries[-1]
      $ref = $latest.image
      if (Get-StagingImageId -Reference $ref) {
        Add-Evidence "  使用 images.json 记录的最新镜像: $ref（source_sha=$($latest.sourceSha), id=$($latest.imageId)）"
        return $ref
      }
    }
  }
  $head = (& git -C $script:RepoRoot rev-parse --short=12 HEAD 2>$null).Trim()
  $ref = "flower-e2-staging:$head"
  if (Get-StagingImageId -Reference $ref) { return $ref }
  throw "找不到 staging 镜像；先运行 Invoke-Staging.ps1 build 或用 -Image 指定"
}

function Save-StagingImageManifest {
  param(
    [Parameter(Mandatory)][string]$Image,
    [Parameter(Mandatory)][string]$SourceSha,
    [string]$BuildLog
  )
  $inspect = & docker image inspect $Image --format '{{.Id}}|{{.Os}}/{{.Architecture}}|{{.Size}}|{{index .RepoDigests 0}}' 2>$null
  $parts = "$inspect".Split('|')
  $entry = [pscustomobject]@{
    image      = $Image
    sourceSha  = $SourceSha
    imageId    = $parts[0]
    platform   = $parts[1]
    sizeBytes  = [long]$parts[2]
    repoDigest = if ($parts.Count -gt 3) { $parts[3] } else { '' }
    runId      = $script:RunStamp
    builtAtUtc = (Get-Date).ToUniversalTime().ToString('o')
    buildLog   = $BuildLog
  }
  $manifest = Join-Path $script:RuntimeDir 'images.json'
  $entries = @()
  if (Test-Path $manifest) { $entries = @(Get-Content $manifest -Raw | ConvertFrom-Json) }
  $entries += $entry
  $entries | ConvertTo-Json -Depth 5 | Set-Content -Path $manifest -Encoding utf8NoBOM
  Add-Evidence "  images.json += $Image"
  return $entry
}

function Invoke-BuildStagingImage {
  param(
    [string]$Tag,
    [string]$Dockerfile
  )
  Assert-StagingContext
  $sha = (& git -C $script:RepoRoot rev-parse HEAD 2>$null).Trim()
  $short = (& git -C $script:RepoRoot rev-parse --short=12 HEAD 2>$null).Trim()
  if (-not $Tag) { $Tag = "flower-e2-staging:$short" }
  if (-not $Dockerfile) { $Dockerfile = Join-Path $script:StagingDir 'images\Dockerfile.staging' }
  $dockerfileRelative = [System.IO.Path]::GetRelativePath($script:RepoRoot, $Dockerfile)
  Add-EvidenceSection "真实镜像构建（工作目录=$($script:RepoRoot)）"
  Add-Evidence "  source_sha: $sha"
  Add-Evidence "  image: $Tag"
  Add-Evidence "  dockerfile: $dockerfileRelative"
  if ($dockerfileRelative -match 'Dockerfile\.staging') {
    Add-Evidence '  [deviation] 使用 staging-only Dockerfile 变体：deps 阶段 registry 重写/重试参数，其余阶段与仓库根 Dockerfile 相同；生产构建未修改。'
  }
  $result = Invoke-Logged -FilePath 'docker' -Arguments @(
    'build', '--progress=plain', '--platform', 'linux/amd64',
    '-f', $Dockerfile,
    '--build-arg', "NEXT_PUBLIC_API_URL=$($script:Cfg.WebUrl)",
    '--build-arg', "NEXT_PUBLIC_ASSET_BASE_URL=$($script:Cfg.WebUrl)",
    '-t', $Tag, '.'
  ) -AllowExitCodes @(0, 1) -NoThrow
  if ($result.ExitCode -ne 0) {
    Add-Evidence '[build] 失败：保留日志并单列阻塞（归因：网络/配置/磁盘）'
    throw "镜像构建失败（exit $($result.ExitCode)），证据见 $($script:CurrentLog)"
  }
  $entry = Save-StagingImageManifest -Image $Tag -SourceSha $sha -BuildLog $script:CurrentLog
  Add-Evidence "  image_id: $($entry.imageId)  platform: $($entry.platform)  repo_digest: $($entry.repoDigest)"
  $script:Cfg.Image = $Tag
  $env:STAGING_IMAGE = $Tag
  return $Tag
}

# ---------- 健康与冒烟 ----------
function Get-StagingHttpStatus {
  param([Parameter(Mandatory)][string]$Url)
  $raw = & curl.exe -s -o NUL -w '%{http_code}|%{redirect_url}' --max-time 8 $Url 2>$null
  if ($LASTEXITCODE -ne 0) { return [pscustomobject]@{ Code = '000'; Redirect = '' } }
  $parts = ("$raw").Trim() -split '\|', 2
  return [pscustomobject]@{ Code = $parts[0]; Redirect = ($parts | Select-Object -Skip 1 | Select-Object -First 1) }
}

function Get-StagingHttpBody {
  param([Parameter(Mandatory)][string]$Url, [string]$Headers = '')
  if ($Headers) {
    $body = & curl.exe -s --max-time 8 -H $Headers $Url 2>$null
  } else {
    $body = & curl.exe -s --max-time 8 $Url 2>$null
  }
  return ("$body").Trim()
}

function Get-StagingImageId {
  param([Parameter(Mandatory)][string]$Reference)
  $out = & docker image inspect $Reference --format '{{.Id}}' 2>$null
  if ($LASTEXITCODE -ne 0) { return $null }
  return ("$out" | Select-Object -First 1).Trim()
}

function Wait-StagingWebHealthy {
  param([int]$TimeoutSeconds = 120, [int]$IntervalSeconds = 3)
  $started = Get-Date
  $attempt = 0
  while (((Get-Date) - $started).TotalSeconds -lt $TimeoutSeconds) {
    $attempt++
    $status = Get-StagingHttpStatus -Url $script:Cfg.HealthUrl
    $body = ''
    if ($status.Code -eq '200') { $body = Get-StagingHttpBody -Url $script:Cfg.HealthUrl }
    $elapsed = [math]::Round(((Get-Date) - $started).TotalSeconds, 1)
    Add-Evidence "  [health] attempt=$attempt elapsed=${elapsed}s code=$($status.Code) body=$body"
    if ($status.Code -eq '200' -and $body -match '"status"\s*:\s*"ok"') {
      return [pscustomobject]@{ Ok = $true; Code = $status.Code; Body = $body; ElapsedSeconds = $elapsed }
    }
    Start-Sleep -Seconds $IntervalSeconds
  }
  return [pscustomobject]@{ Ok = $false; Code = 'timeout'; Body = ''; ElapsedSeconds = $TimeoutSeconds }
}

function Wait-StagingDbHealthy {
  param([int]$TimeoutSeconds = 90)
  $container = "$($script:Cfg.Project)-db"
  $started = Get-Date
  while (((Get-Date) - $started).TotalSeconds -lt $TimeoutSeconds) {
    $state = (& docker inspect $container --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' 2>$null)
    if ("$state".Trim() -eq 'healthy') { return $true }
    Start-Sleep -Seconds 2
  }
  return $false
}

function Invoke-StagingLoginSmoke {
  Assert-StagingContext
  Add-EvidenceSection '登录冒烟（V2 合成账号完整凭据登录）'
  $jar = Join-Path $script:SecretsDir 'cookies.txt'
  if (Test-Path $jar) { Remove-Item -Force $jar }
  $base = $script:Cfg.WebUrl
  $csrfRaw = & curl.exe -s -c $jar -b $jar --max-time 8 "$base/api/auth/csrf" 2>$null
  if ($LASTEXITCODE -ne 0) { throw "获取 csrf 失败（exit $LASTEXITCODE）" }
  $csrf = $null
  try { $csrf = ("$csrfRaw" | ConvertFrom-Json).csrfToken } catch { throw "csrf 响应不是 JSON：$csrfRaw" }
  if (-not $csrf) { throw 'csrfToken 缺失' }
  $post = & curl.exe -s -b $jar -c $jar --max-time 15 -o (Join-Path $script:SecretsDir 'login-response.json') -w '%{http_code}' -X POST "$base/api/auth/callback/v2-credentials" --data-urlencode "csrfToken=$csrf" --data-urlencode 'username=admin' --data-urlencode 'password=admin' --data-urlencode "callbackUrl=$base/v2" 2>$null
  Add-Evidence "  POST /api/auth/callback/v2-credentials -> $post"
  $v2 = & curl.exe -s -b $jar -c $jar --max-time 10 -o (Join-Path $script:SecretsDir 'v2-page.html') -w '%{http_code}|%{redirect_url}' "$base/v2" 2>$null
  Add-Evidence "  GET /v2 (已登录) -> $v2"
  return [pscustomobject]@{ Csrf = ([bool]$csrf); CallbackStatus = "$post".Trim(); V2 = "$v2".Trim() }
}

function Invoke-StagingSmoke {
  Assert-StagingContext
  Add-EvidenceSection '核心冒烟（Runbook §7.2 本机可覆盖部分）'
  $health = Get-StagingHttpStatus -Url $script:Cfg.HealthUrl
  $healthBody = if ($health.Code -eq '200') { Get-StagingHttpBody -Url $script:Cfg.HealthUrl } else { '' }
  Add-Evidence "  /api/health -> $($health.Code) body=$healthBody"
  Assert-True ($health.Code -eq '200' -and $healthBody -match '"status"\s*:\s*"ok"') '健康检查 200 且 status=ok'

  $login = Get-StagingHttpStatus -Url "$($script:Cfg.WebUrl)/login"
  Add-Evidence "  /login -> $($login.Code)"
  Assert-True ($login.Code -eq '200') '登录页 200'

  $v2 = Get-StagingHttpStatus -Url "$($script:Cfg.WebUrl)/v2"
  Add-Evidence "  /v2 (未登录) -> $($v2.Code) redirect=$($v2.Redirect)"
  Assert-True ($v2.Code -eq '307' -and $v2.Redirect -match '/login') '未登录访问 /v2 返回 307 并跳转登录'

  foreach ($path in @('/v2/inventory', '/v2/orders', '/v2/catalog')) {
    $r = Get-StagingHttpStatus -Url "$($script:Cfg.WebUrl)$path"
    Add-Evidence "  $path (未登录) -> $($r.Code)"
    Assert-True ($r.Code -eq '307' -and $r.Redirect -match '/login') "$path 未登录跳转登录"
  }

  $loginSmoke = Invoke-StagingLoginSmoke
  Assert-True ($loginSmoke.CallbackStatus -in @('200', '302')) 'V2 凭据登录回调成功'
  Assert-True ($loginSmoke.V2 -match '^200') '登录后 /v2 返回 200（工作台可访问）'
  return $true
}

# ---------- 迁移与数据 ----------
function Get-StagingMigrationStatusText {
  param([switch]$V2)
  $args = @('run', '--rm', '--no-deps', '--entrypoint', 'npx', 'flower-web', 'prisma', 'migrate', 'status')
  if ($V2) { $args += @('--config', 'prisma.v2.config.ts') }
  $result = Invoke-StagingCompose -Arguments $args -AllowExitCodes @(0, 1) -NoThrow
  return $result.Output
}

function Invoke-StagingPsqlFile {
  param(
    [Parameter(Mandatory)][string]$Database,
    [Parameter(Mandatory)][string]$SqlFile
  )
  $relative = Resolve-Path -Relative $SqlFile -ErrorAction SilentlyContinue
  if (-not $relative) { $relative = $SqlFile }
  Add-EvidenceSection "psql 核对 $Database <$(Split-Path -Leaf $SqlFile)>"
  $composeArgs = Get-StagingComposeArgs
  $raw = Get-Content $SqlFile -Raw | & docker @composeArgs exec -T db psql -U $script:Cfg.DbUser -d $Database -t -A -F '|' -f - 2>&1
  $code = $LASTEXITCODE
  $lines = @($raw | ForEach-Object { "$_" })
  foreach ($line in $lines) { Add-Evidence "  $line" }
  Add-Evidence "[exit code: $code]"
  if ($code -ne 0) { throw "psql 核对失败：$Database（exit $code）" }
  return $lines
}

function Get-StagingRowCounts {
  param([Parameter(Mandatory)][string]$Database, [Parameter(Mandatory)][string]$SqlFile)
  $lines = Invoke-StagingPsqlFile -Database $Database -SqlFile $SqlFile
  $table = [ordered]@{}
  foreach ($line in $lines) {
    if ($line -match '^(?<key>[^|]+)\|(?<value>-?\d+)$') {
      $table[$Matches['key'].Trim()] = [long]$Matches['value']
    }
  }
  return $table
}

# ---------- 资源快照与隔离 ----------
function Get-StagingResourceSnapshot {
  param([string]$Label)
  Assert-StagingContext
  Add-EvidenceSection "资源快照：$Label"
  $project = $script:Cfg.Project
  $containers = & docker ps -a --filter "label=com.docker.compose.project=$project" --format '{{.Names}}|{{.Image}}|{{.Status}}|{{.Ports}}' 2>&1
  Add-Evidence '  project containers:'
  foreach ($line in @($containers)) { Add-Evidence "    $line" }
  $volumes = & docker volume ls --filter "name=$project" --format '{{.Name}}' 2>&1
  Add-Evidence '  project volumes:'
  foreach ($line in @($volumes)) { Add-Evidence "    $line" }
  $networks = & docker network ls --filter "name=$project" --format '{{.Name}}' 2>&1
  Add-Evidence '  project networks:'
  foreach ($line in @($networks)) { Add-Evidence "    $line" }
  $all = & docker ps --format '{{.Names}}|{{.Image}}|{{.Ports}}' 2>&1
  Add-Evidence '  all running containers（用于确认未触碰其他环境）:'
  foreach ($line in @($all)) { Add-Evidence "    $line" }
}

function Assert-StagingIsolation {
  Assert-StagingContext
  $project = $script:Cfg.Project
  Add-EvidenceSection '隔离断言'
  $foreign = @(& docker ps -a --filter "label=com.docker.compose.project=$project" --format '{{.Names}}' | Where-Object { $_ -and $_ -notmatch "^$([regex]::Escape($project))-" })
  Assert-True ($foreign.Count -eq 0) "项目 $project 内无命名异常容器"
  $web = (& docker inspect "$project-web" --format '{{.State.Status}}|{{index .Config.Env 0}}' 2>$null)
  Add-Evidence "  web container status: $web"
  $port = (& docker port "$project-web" 2>$null)
  Add-Evidence "  web published: $port"
  Assert-True ("$port" -match "127\.0\.0\.1:$($script:Cfg.WebPort)\b") 'web 端口仅绑定 127.0.0.1 且与配置一致'
  Assert-True ("$port" -notmatch '0\.0\.0\.0:') 'web 端口未绑定 0.0.0.0'
  $pg = (& docker inspect "$project-db" --format '{{.State.Health.Status}}' 2>$null)
  Add-Evidence "  db health: $pg"
  Assert-True ("$pg".Trim() -eq 'healthy') 'db 容器健康'
  Assert-True ($null -ne (Get-StagingImageId -Reference 'flower-e05-verification:final')) '既有本地 E0.5 镜像仍存在（未删除其他镜像）'
}

# ---------- 栈管理 ----------
function Remove-StagingStack {
  param([switch]$RemoveImages)
  Assert-StagingContext
  Add-EvidenceSection '清理 staging 栈（仅本项目资源）'
  $down = Invoke-StagingCompose -Arguments @('down', '-v', '--remove-orphans') -AllowExitCodes @(0, 1) -NoThrow
  Add-Evidence "  compose down -v exit=$($down.ExitCode)"
  if ($RemoveImages -and $script:Cfg.Image) {
    $rmi = Invoke-Logged -FilePath 'docker' -Arguments @('rmi', $script:Cfg.Image) -AllowExitCodes @(0, 1) -NoThrow
    Add-Evidence "  移除本次镜像 $($script:Cfg.Image) exit=$($rmi.ExitCode)"
  }
  $project = $script:Cfg.Project
  $remainingContainers = @(& docker ps -a --filter "label=com.docker.compose.project=$project" --format '{{.Names}}' 2>$null | Where-Object { $_ })
  $remainingVolumes = @(& docker volume ls --filter "name=$project" --format '{{.Name}}' 2>$null | Where-Object { $_ })
  $remainingNetworks = @(& docker network ls --filter "name=$project" --format '{{.Name}}' 2>$null | Where-Object { $_ })
  Add-Evidence "  清理后剩余容器: $($remainingContainers.Count) 卷: $($remainingVolumes.Count) 网络: $($remainingNetworks.Count)"
  Assert-True ($remainingContainers.Count -eq 0) 'staging 容器已清理'
  Assert-True ($remainingVolumes.Count -eq 0) 'staging 卷已清理'
  Assert-True ($remainingNetworks.Count -eq 0) 'staging 网络已清理'
}

function Assert-True {
  param([bool]$Condition, [string]$Message)
  if (-not $Condition) { throw "断言失败：$Message" }
  Add-Evidence "  [OK] $Message"
}

function Assert-Equal {
  param($Actual, $Expected, [string]$Message)
  if ("$Actual" -ne "$Expected") { throw "断言失败：$Message（期望 '$Expected'，实际 '$Actual'）" }
  Add-Evidence "  [OK] $Message = $Actual"
}

