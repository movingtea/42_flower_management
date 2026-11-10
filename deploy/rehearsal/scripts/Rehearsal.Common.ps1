# E1.8 非生产发布演练 · 公共函数库
#
# 由 scripts/Invoke-Rehearsal.ps1 与 scripts/Clear-Rehearsal.ps1 点源引用。
# 设计目标：可复跑、隔离、证据可审计。所有命令与退出码写入 docs/evidence/sprint-e1/logs/e18-*.log。
#
# 安全：日志中不得出现真实连接串/密码/密钥。本库生成的随机密码只写入
# deploy/rehearsal/.runtime（已 gitignore），不写入日志。

$ErrorActionPreference = 'Stop'

# ---------- 路径与常量 ----------
$script:ProjectName      = 'flower-e1-8-rehearsal'
$script:RehearsalDir     = Split-Path -Parent $PSScriptRoot
$script:RepoRoot         = Split-Path -Parent (Split-Path -Parent $script:RehearsalDir)
$script:ComposeFile      = Join-Path $script:RehearsalDir 'compose\docker-compose.rehearsal.yml'
$script:RuntimeDir       = Join-Path $script:RehearsalDir '.runtime'
$script:OverrideDir      = Join-Path $script:RuntimeDir 'overrides'
$script:BackupDir        = Join-Path $script:RuntimeDir 'backup'
$script:SecretsDir       = Join-Path $script:RuntimeDir 'secrets'
$script:EnvFile          = Join-Path $script:RuntimeDir 'rehearsal.env'
$script:EvidenceDir      = Join-Path $script:RepoRoot 'docs\evidence\sprint-e1\logs'
$script:DbUser           = 'flower_e18'
$script:V1Db             = 'flower_e18_v1'
$script:V2Db             = 'flower_e18_v2'
$script:V1RestoreDb      = 'flower_e18_v1_restore'
$script:V2RestoreDb      = 'flower_e18_v2_restore'
$script:ImageRepo        = 'flower-e18-rehearsal/flower-platform-app'
$script:BaseImage        = 'flower-e05-verification:final'
$script:DbImage          = 'postgres:18-alpine'
$script:WebContainer     = 'flower-e18-web'
$script:CronContainer    = 'flower-e18-cron'
$script:DbContainer      = 'flower-e18-db'
$script:WebPort          = 18080
$script:DbPort           = 15432
$script:WebBaseUrl       = 'http://127.0.0.1:18080'
$script:HealthUrl        = "$($script:WebBaseUrl)/api/health"
$script:SmokeUrls        = @{ login = "$($script:WebBaseUrl)/login"; v2 = "$($script:WebBaseUrl)/v2" }
# 模拟 SHA 标签（非真实提交；真实基线 HEAD 见 preflight 日志）
$script:ShaGood          = 'a11c0de'   # 上一版可用镜像（预构建镜像）
$script:ShaAdditive      = 'add1t1'    # 带第 8 个 V2 迁移的模拟新版本
$script:ShaBad           = 'badc0de'   # 演练用缺陷镜像

$script:RunStamp         = Get-Date -Format 'yyyyMMdd-HHmmss'
$script:CurrentLog       = $null
$script:EvidenceFiles    = @()
$script:RunStartedAt     = Get-Date

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
    [Parameter(Mandatory)][string]$Title
  )
  $file = Join-Path $script:EvidenceDir ("e18-{0}-{1}.log" -f $Name, $script:RunStamp)
  $gitHead = ''
  try {
    $gitHead = (& git -C $script:RepoRoot rev-parse --short HEAD 2>$null)
    $gitBranch = (& git -C $script:RepoRoot rev-parse --abbrev-ref HEAD 2>$null)
  } catch { $gitBranch = 'unknown' }
  $header = @(
    "### E1.8 非生产发布演练证据 · $Title"
    "run_id: $($script:RunStamp)"
    "recorded_at: $(Get-Date -Format o)"
    "mode: $($script:RunMode)"
    "host: $env:COMPUTERNAME / PowerShell $($PSVersionTable.PSVersion)"
    "repo: CMS_and_WMS (branch=$gitBranch, HEAD=$gitHead)"
    "compose_project: $($script:ProjectName)"
    "note: 演练使用本地预构建镜像 + 模拟 SHA 标签；真实镜像构建/ACR 推送/GitHub workflow 不在本地演练范围。"
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
    Add-Evidence ""
    Add-Evidence "=== 证据结束: $(Split-Path -Leaf $script:CurrentLog) ==="
    $script:CurrentLog = $null
  }
}

# ---------- 命令执行 ----------
function Invoke-Logged {
  <#
    执行命令，记录命令行、输出与退出码。返回 { ExitCode; Output }。
    默认只接受退出码 0；-AllowExitCodes 用于失败演练中预期非零的命令。
  #>
  param(
    [Parameter(Mandatory)][string]$FilePath,
    [string[]]$Arguments = @(),
    [int[]]$AllowExitCodes = @(0),
    [switch]$NoThrow
  )
  $cmdLine = "$FilePath $($Arguments -join ' ')"
  Add-Evidence "`$ $cmdLine"
  $output = & $FilePath @Arguments 2>&1 | ForEach-Object {
    $text = "$_"
    # 过滤 PowerShell 对部分 stderr 记录产生的无信息占位文本
    if ($text -eq 'System.Management.Automation.RemoteException') { return }
    $text
  }
  foreach ($line in $output) { Add-Evidence "  $line" }
  $code = $LASTEXITCODE
  Add-Evidence "[exit code: $code]"
  if (($AllowExitCodes -notcontains $code) -and (-not $NoThrow)) {
    throw "命令失败（期望退出码 $($AllowExitCodes -join '/')，实际 $code）：$cmdLine"
  }
  return [pscustomobject]@{ ExitCode = $code; Output = ($output -join "`n"); CommandLine = $cmdLine }
}

function Get-ComposeArgs {
  param([string]$Override)
  $argsList = @('compose', '-p', $script:ProjectName, '-f', $script:ComposeFile)
  if ($Override) { $argsList += @('-f', $Override) }
  return $argsList
}

function Invoke-Compose {
  param(
    [Parameter(Mandatory)][string[]]$Arguments,
    [string]$Override,
    [int[]]$AllowExitCodes = @(0),
    [switch]$NoThrow
  )
  $all = @(Get-ComposeArgs -Override $Override) + $Arguments
  return Invoke-Logged -FilePath 'docker' -Arguments $all -AllowExitCodes $AllowExitCodes -NoThrow:$NoThrow
}

function Get-ImageId {
  param([Parameter(Mandatory)][string]$Reference)
  $out = & docker image inspect $Reference --format '{{.Id}}' 2>$null
  if ($LASTEXITCODE -ne 0) { return $null }
  return ($out | Select-Object -First 1).Trim()
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

# ---------- 隔离运行时初始化 ----------
function New-RehearsalRandom {
  param([int]$Length, [string[]]$CharSets)
  $chars = for ($i = 0; $i -lt $Length; $i++) {
    $set = $CharSets[$i % $CharSets.Count]
    ($set.ToCharArray() | Get-Random)
  }
  return (-join $chars)
}

function Initialize-RehearsalRuntime {
  Add-EvidenceSection '生成演练运行时 env 与随机凭据（不写入日志）'
  foreach ($dir in @($script:RuntimeDir, $script:OverrideDir, $script:BackupDir, $script:SecretsDir)) {
    New-Item -ItemType Directory -Force -Path $dir | Out-Null
  }

  $dbPassword = 'E18' + (New-RehearsalRandom -Length 20 -CharSets @('ABCDEFGHJKLMNPQRSTUVWXYZ', 'abcdefghijkmnpqrstuvwxyz', '23456789'))
  $authSecret = New-RehearsalRandom -Length 40 -CharSets @('ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789')
  $bootstrapPassword = $dbPassword + 'Admin9'

  $templatePath = Join-Path $script:RehearsalDir 'env\rehearsal.env.example'
  $template = Get-Content $templatePath -Raw
  $envText = $template.Replace('__REHEARSAL_DB_PASSWORD__', $dbPassword).Replace('__REHEARSAL_AUTH_SECRET__', $authSecret)
  Set-Content -Path $script:EnvFile -Value $envText -Encoding utf8NoBOM
  Set-Content -Path (Join-Path $script:SecretsDir 'bootstrap-admin-password.txt') -Value $bootstrapPassword -Encoding utf8NoBOM

  Add-Evidence "  env: deploy/rehearsal/.runtime/rehearsal.env（随机密码/AUTH_SECRET 已生成，未打印）"
  Add-Evidence "  bootstrap 管理员密码文件: deploy/rehearsal/.runtime/secrets/bootstrap-admin-password.txt（未打印）"
  Assert-True (Test-Path $script:EnvFile) '演练 env 已生成'
}

function Get-ShaOverridePath {
  param([Parameter(Mandatory)][string]$Sha)
  $path = Join-Path $script:OverrideDir ("compose.image-sha-{0}.yml" -f $Sha)
  $yaml = @(
    'services:'
    '  flower-web:'
    ('    image: "{0}:sha-{1}"' -f $script:ImageRepo, $Sha)
    '  flower-cron-worker:'
    ('    image: "{0}:sha-{1}"' -f $script:ImageRepo, $Sha)
  )
  Set-Content -Path $path -Value $yaml -Encoding ascii
  Add-Evidence "  生成镜像 override: deploy/rehearsal/.runtime/overrides/$(Split-Path -Leaf $path)（image=$($script:ImageRepo):sha-$Sha）"
  return $path
}

# ---------- 健康与冒烟 ----------
function Invoke-CurlText {
  param([string]$Arguments)
  # 固定使用 curl.exe 以稳定获取 HTTP 状态码/重定向；-s 静默，-o NUL 丢弃 body。
  $out = & curl.exe -s -o NUL -w '%{http_code}|%{redirect_url}' --max-time 8 $Arguments 2>$null
  if ($LASTEXITCODE -ne 0) { return '000|' }
  return ("$out").Trim()
}

function Get-HttpStatus {
  param([Parameter(Mandatory)][string]$Url)
  $raw = & curl.exe -s -o NUL -w '%{http_code}|%{redirect_url}' --max-time 8 $Url 2>$null
  if ($LASTEXITCODE -ne 0) { return [pscustomobject]@{ Code = '000'; Redirect = ''; Raw = 'curl failed' } }
  $parts = ("$raw").Trim() -split '\|', 2
  return [pscustomobject]@{ Code = $parts[0]; Redirect = ($parts | Select-Object -Skip 1 | Select-Object -First 1); Raw = ("$raw").Trim() }
}

function Get-HttpBody {
  param([Parameter(Mandatory)][string]$Url)
  $body = & curl.exe -s --max-time 8 $Url 2>$null
  return ("$body").Trim()
}

function Get-WebHealthStatus {
  return (& docker inspect $script:WebContainer --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' 2>$null).Trim()
}

function Wait-WebHealthy {
  param([int]$TimeoutSeconds = 120, [int]$IntervalSeconds = 3)
  $started = Get-Date
  $attempt = 0
  while (((Get-Date) - $started).TotalSeconds -lt $TimeoutSeconds) {
    $attempt++
    $status = Get-HttpStatus -Url $script:HealthUrl
    $body = ''
    if ($status.Code -eq '200') { $body = Get-HttpBody -Url $script:HealthUrl }
    $elapsed = [math]::Round(((Get-Date) - $started).TotalSeconds, 1)
    Add-Evidence "  [health] attempt=$attempt elapsed=${elapsed}s code=$($status.Code) body=$body"
    if ($status.Code -eq '200' -and $body -match '"status"\s*:\s*"ok"') {
      return [pscustomobject]@{ Ok = $true; Code = $status.Code; Body = $body; ElapsedSeconds = $elapsed; Attempts = $attempt }
    }
    Start-Sleep -Seconds $IntervalSeconds
  }
  return [pscustomobject]@{ Ok = $false; Code = (Get-HttpStatus -Url $script:HealthUrl).Code; Body = ''; ElapsedSeconds = $TimeoutSeconds; Attempts = $attempt }
}

function Invoke-CoreSmoke {
  <#
    核心冒烟（与 Runbook 第 8 节一致）：
      /api/health  200 + {"status":"ok"}
      /login       200
      /v2          307 且跳转 /login?callbackUrl=/v2（未登录应跳转，不应 5xx）
  #>
  $results = [ordered]@{}
  $health = Get-HttpStatus -Url $script:HealthUrl
  $healthBody = if ($health.Code -eq '200') { Get-HttpBody -Url $script:HealthUrl } else { '' }
  $results['health'] = [pscustomobject]@{ Url = $script:HealthUrl; Code = $health.Code; Body = $healthBody }
  Add-Evidence "  [smoke] GET /api/health -> $($health.Code) body=$healthBody"

  $login = Get-HttpStatus -Url $script:SmokeUrls.login
  $results['login'] = [pscustomobject]@{ Url = $script:SmokeUrls.login; Code = $login.Code; Redirect = $login.Redirect }
  Add-Evidence "  [smoke] GET /login -> $($login.Code)"

  $v2 = Get-HttpStatus -Url $script:SmokeUrls.v2
  $results['v2'] = [pscustomobject]@{ Url = $script:SmokeUrls.v2; Code = $v2.Code; Redirect = $v2.Redirect }
  Add-Evidence "  [smoke] GET /v2 -> $($v2.Code) redirect=$($v2.Redirect)"

  Assert-True ($health.Code -eq '200' -and $healthBody -match '"status"\s*:\s*"ok"') '健康检查 /api/health 返回 200 且 status=ok'
  Assert-True ($login.Code -eq '200') '登录页 /login 返回 200'
  Assert-True ($v2.Code -eq '307' -and $v2.Redirect -match '/login') '未登录访问 /v2 返回 307 并跳转登录页'
  return $results
}

# ---------- 数据库检查 ----------
function Invoke-PsqlFile {
  param(
    [Parameter(Mandatory)][string]$Database,
    [Parameter(Mandatory)][string]$SqlFile
  )
  $relative = Resolve-Path -Relative $SqlFile -ErrorAction SilentlyContinue
  if (-not $relative) { $relative = $SqlFile }
  Add-Evidence "`$ psql -U $($script:DbUser) -d $Database -f <$relative>"
  $raw = Get-Content $SqlFile -Raw | & docker @(Get-ComposeArgs) exec -T db psql -U $script:DbUser -d $Database -t -A -F '|' -f - 2>&1
  $code = $LASTEXITCODE
  $lines = @($raw | ForEach-Object { "$_" })
  foreach ($line in $lines) { Add-Evidence "  $line" }
  Add-Evidence "[exit code: $code]"
  if ($code -ne 0) { throw "psql 检查失败：$Database <$relative>（exit $code）" }
  return $lines
}

function Get-RowCounts {
  param([Parameter(Mandatory)][string]$Database, [Parameter(Mandatory)][string]$SqlFile)
  $lines = Invoke-PsqlFile -Database $Database -SqlFile $SqlFile
  $table = [ordered]@{}
  foreach ($line in $lines) {
    if ($line -match '^(?<key>[^|]+)\|(?<value>-?\d+)$') {
      $table[$Matches['key'].Trim()] = [long]$Matches['value']
    }
  }
  return $table
}

function Compare-RowCountTables {
  param(
    [Parameter(Mandatory)]$Before,
    [Parameter(Mandatory)]$After,
    [string[]]$IgnoreKeys = @()
  )
  $diffs = @()
  foreach ($key in $Before.Keys) {
    if ($IgnoreKeys -contains $key) { continue }
    if (-not $After.Contains($key)) { $diffs += "$key 在对比结果中缺失"; continue }
    if ([long]$Before[$key] -ne [long]$After[$key]) { $diffs += "${key}: $($Before[$key]) -> $($After[$key])" }
  }
  return $diffs
}

function Get-MigrationStatusText {
  param([Parameter(Mandatory)][string]$Override, [switch]$V2)
  # prisma migrate status 在“有未应用迁移”时退出码为 1，属于空库初始化前的正常状态，
  # 因此这里允许 0/1，并由调用方对输出内容做断言。
  $cliArgs = @('run', '--rm', '--no-deps', '--entrypoint', 'npx', 'flower-web', 'prisma', 'migrate', 'status')
  if ($V2) { $cliArgs += @('--config', 'prisma.v2.config.ts') }
  $result = Invoke-Compose -Arguments $cliArgs -Override $Override -AllowExitCodes @(0, 1) -NoThrow
  return $result.Output
}

# ---------- 栈管理 ----------
function Get-RehearsalResourceSnapshot {
  param([string]$Label)
  Add-EvidenceSection "资源快照：$Label"
  $containers = & docker ps -a --filter "label=com.docker.compose.project=$($script:ProjectName)" --format '{{.Names}}|{{.Image}}|{{.Status}}' 2>&1
  Add-Evidence "  project containers:"
  foreach ($line in @($containers)) { Add-Evidence "    $line" }
  $volumes = & docker volume ls --filter "name=$($script:ProjectName)" --format '{{.Name}}' 2>&1
  Add-Evidence "  project volumes:"
  foreach ($line in @($volumes)) { Add-Evidence "    $line" }
  $networks = & docker network ls --filter "name=$($script:ProjectName)" --format '{{.Name}}' 2>&1
  Add-Evidence "  project networks:"
  foreach ($line in @($networks)) { Add-Evidence "    $line" }
}

function Remove-RehearsalStack {
  param([switch]$RemoveImages)
  Add-EvidenceSection '清理演练栈（仅本项目资源，不触碰其他容器/卷/数据）'
  $down = Invoke-Compose -Arguments @('down', '-v', '--remove-orphans') -AllowExitCodes @(0, 1) -NoThrow
  Add-Evidence "  compose down -v exit=$($down.ExitCode)"
  if ($RemoveImages) {
    foreach ($sha in @($script:ShaGood, $script:ShaAdditive, $script:ShaBad)) {
      $ref = "$($script:ImageRepo):sha-$sha"
      $rmi = Invoke-Logged -FilePath 'docker' -Arguments @('rmi', $ref) -AllowExitCodes @(0, 1) -NoThrow
      Add-Evidence "  移除演练镜像标签 $ref exit=$($rmi.ExitCode)"
    }
  }
  $remainingContainers = @(& docker ps -a --filter "label=com.docker.compose.project=$($script:ProjectName)" --format '{{.Names}}' 2>$null | Where-Object { $_ })
  $remainingVolumes = @(& docker volume ls --filter "name=$($script:ProjectName)" --format '{{.Name}}' 2>$null | Where-Object { $_ })
  $remainingNetworks = @(& docker network ls --filter "name=$($script:ProjectName)" --format '{{.Name}}' 2>$null | Where-Object { $_ })
  Add-Evidence "  清理后剩余容器: $($remainingContainers.Count) 卷: $($remainingVolumes.Count) 网络: $($remainingNetworks.Count)"
  Assert-True ($remainingContainers.Count -eq 0) '演练项目容器已清理'
  Assert-True ($remainingVolumes.Count -eq 0) '演练项目卷已清理'
  Assert-True ($remainingNetworks.Count -eq 0) '演练项目网络已清理'
}
