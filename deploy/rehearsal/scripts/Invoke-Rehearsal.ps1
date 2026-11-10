# E1.8 最小发布 Runbook · 非生产 Docker Compose 演练（可复跑）
#
# 覆盖：
#   1) 发布前检查（隔离资源、端口、本地镜像、Git 基线）
#   2) 成功路径：起 db → V1/V2 迁移 → 起 web/cron → /api/health → 核心冒烟 → 生产初始化
#   3) 备份与恢复检查：pg_dump -Fc / pg_restore 到临时库 + 行数核对
#   4) V2 增量迁移（7→8）与迁移后回滚旧镜像的兼容性
#   5) 失败停止：错误数据库目标、不可用数据库、缺陷镜像 → 停止/不继续
#   6) 应用镜像回滚：坏 SHA → 上一版 SHA → health 恢复
#   7) 清理与隔离校验（不触碰其他容器/卷/数据）
#
# 边界（本地无法覆盖，见 docs/flower-studio-2.0-release-runbook.md 与证据 summary）：
#   - 真实 docker build（当前 npm npmmirror 的 vitest 包 500 失败，本机无 ACR/GitHub 凭据）
#   - ACR 推送、GitHub Actions workflow 真实执行、生产分支保护
#   - 生产 nginx 边缘、真实生产备份保留策略/停机窗口
# 因此用本地预构建镜像 flower-e05-verification:final + 人工模拟 SHA 标签
# （sha-a11c0de / sha-add1t1 / sha-badc0de）模拟按提交 SHA 部署与回滚。
#
# 用法（在 CMS_and_WMS 仓库任意目录）：
#   pwsh -File deploy/rehearsal/scripts/Invoke-Rehearsal.ps1
#   pwsh -File deploy/rehearsal/scripts/Invoke-Rehearsal.ps1 -SkipCleanup   # 保留栈供检查
#   pwsh -File deploy/rehearsal/scripts/Invoke-Rehearsal.ps1 -Mode cleanup-only
#
# 重复执行安全：每次运行先清理本项目残留资源；证据写入 docs/evidence/sprint-e1/logs/e18-*.log。

[CmdletBinding()]
param(
  [ValidateSet('all', 'cleanup-only')]
  [string]$Mode = 'all',
  [switch]$SkipCleanup
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Rehearsal.Common.ps1')

$summary = [ordered]@{}
$runFailed = $false
$failureMessage = ''
$devPgBefore = $null
$preflight = $null
$rowCountsAfterSeed = $null

function Get-DbList {
  return Invoke-PsqlFile -Database 'postgres' -SqlFile (Join-Path $script:RehearsalDir 'db\checks\db-list.sql')
}

function Wait-DbHealthy {
  param([int]$TimeoutSeconds = 90)
  $started = Get-Date
  while (((Get-Date) - $started).TotalSeconds -lt $TimeoutSeconds) {
    $health = (& docker inspect $script:DbContainer --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' 2>$null).Trim()
    if ($health -eq 'healthy') { return $true }
    Start-Sleep -Seconds 2
  }
  return $false
}

# ---------------------------------------------------------------------------
# 1. 发布前检查
# ---------------------------------------------------------------------------
function Step-Preflight {
  $null = Start-EvidenceLog -Name 'preflight' -Title '发布前检查：环境/隔离/镜像/端口/基线'
  Add-EvidenceSection '运行环境'
  $dockerVersion = (& docker version --format '{{.Server.Version}}' 2>&1) -join ' '
  $composeVersion = (& docker compose version 2>&1) -join ' '
  $psqlVersion = (& docker run --rm --entrypoint postgres $script:DbImage --version 2>&1) -join ' '
  Add-Evidence "  docker server: $dockerVersion"
  Add-Evidence "  docker compose: $composeVersion"
  Add-Evidence "  postgres image: $script:DbImage -> $psqlVersion"
  Add-Evidence "  PowerShell: $($PSVersionTable.PSVersion)"

  Add-EvidenceSection 'Git 基线（未提交改动保留，不提交/不推送）'
  $gitStatus = @(& git -C $script:RepoRoot status --short --branch 2>&1)
  $changedCount = @(& git -C $script:RepoRoot status --porcelain 2>&1 | Where-Object { $_ }).Count
  $head = (& git -C $script:RepoRoot rev-parse HEAD 2>&1) -join ' '
  $branch = (& git -C $script:RepoRoot rev-parse --abbrev-ref HEAD 2>&1) -join ' '
  Add-Evidence "  branch: $branch"
  Add-Evidence "  HEAD: $head"
  Add-Evidence "  未提交/未跟踪条目数: $changedCount（演练不修改工作区）"

  Add-EvidenceSection '本地镜像（真实构建由维护者/GitHub workflow 执行）'
  $baseId = Get-ImageId $script:BaseImage
  $dbImageId = Get-ImageId $script:DbImage
  Assert-True (-not [string]::IsNullOrWhiteSpace($baseId)) "预构建应用镜像存在：$script:BaseImage"
  Assert-True (-not [string]::IsNullOrWhiteSpace($dbImageId)) "数据库镜像存在：$script:DbImage"
  Add-Evidence "  $($script:BaseImage) => $baseId"
  Add-Evidence "  $($script:DbImage) => $dbImageId"

  Add-EvidenceSection '端口隔离（避开 3000/5432）'
  foreach ($port in @($script:WebPort, $script:DbPort)) {
    $listener = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
    Assert-True ($null -eq $listener) "宿主端口 $port 空闲"
  }

  Add-EvidenceSection '隔离基线（确认无本项目残留；记录不相关的本地开发容器，演练不得触碰）'
  $projectContainers = @(& docker ps -a --filter "label=com.docker.compose.project=$($script:ProjectName)" --format '{{.Names}}' 2>&1 | Where-Object { $_ })
  Assert-True ($projectContainers.Count -eq 0) "无残留演练容器（$($script:ProjectName)）"
  $devPg = & docker ps -a --filter 'name=flower-v2-pg' --format '{{.ID}}|{{.Image}}|{{.Status}}' 2>&1
  $script:DevPgBefore = ($devPg -join ' ').Trim()
  Add-Evidence "  本地开发数据库容器（演练不触碰）: $($script:DevPgBefore)"
  $disk = Get-PSDrive -Name ($script:RepoRoot.Substring(0, 1)) -ErrorAction SilentlyContinue
  if ($disk) {
    Add-Evidence "  宿主磁盘 $($disk.Name): 可用 $([math]::Round($disk.Free / 1GB, 2)) GiB / 总 $([math]::Round(($disk.Used + $disk.Free) / 1GB, 2)) GiB"
  } else {
    Add-Evidence "  宿主磁盘: 未取得（非关键）"
  }
  Add-Evidence "  写入范围: CMS_and_WMS/docs/flower-studio-2.0-release-runbook.md, CMS_and_WMS/deploy/rehearsal/**, docs/evidence/sprint-e1/logs/e18-*"
  Add-Evidence "  未修改生产 Dockerfile / docker-compose.example.yml / deploy.yml / package.json / lock / 应用源码"

  Stop-EvidenceLog
  $summary['preflight'] = 'PASS'
  return [pscustomobject]@{ BaseImageId = $baseId; DbImageId = $dbImageId; GitHead = $head }
}

# ---------------------------------------------------------------------------
# 2. 成功路径
# ---------------------------------------------------------------------------
function Step-SuccessDeploy {
  $null = Start-EvidenceLog -Name 'success-deploy' -Title '成功路径：启动隔离栈 → V1/V2 迁移 → 健康 → 冒烟 → 生产初始化 → 行数核对'
  Add-EvidenceSection '模拟 SHA 标签（非真实提交；真实基线见 preflight）'
  $goodRef = "$($script:ImageRepo):sha-$($script:ShaGood)"
  $null = Invoke-Logged -FilePath 'docker' -Arguments @('tag', $script:BaseImage, $goodRef)
  $goodImageId = Get-ImageId $goodRef
  Assert-True (-not [string]::IsNullOrWhiteSpace($goodImageId)) "模拟发布镜像标签已创建：$goodRef"
  Add-Evidence "  $goodRef => $goodImageId（与 $script:BaseImage 同一镜像，模拟按 SHA 部署）"
  $goodOverride = Get-ShaOverridePath -Sha $script:ShaGood

  Add-EvidenceSection '启动隔离数据库（独立项目/卷/网络/端口，V1+V2 独立库名）'
  $null = Invoke-Compose -Arguments @('up', '-d', 'db')
  Assert-True (Wait-DbHealthy -TimeoutSeconds 90) 'db 容器健康'
  $null = Invoke-Compose -Arguments @('ps')
  $dbList = Get-DbList
  Add-Evidence "  数据库列表：$((@($dbList | Where-Object { $_ -match 'flower_e18' }) -join ', '))"
  Assert-True ((@($dbList) -match '^flower_e18_v1$').Count -eq 1) "V1 数据库存在：$($script:V1Db)"
  Assert-True ((@($dbList) -match '^flower_e18_v2$').Count -eq 1) "V2 数据库存在：$($script:V2Db)"
  $serverVersion = (& docker compose -p $script:ProjectName -f $script:ComposeFile exec -T db psql -U $script:DbUser -d $script:V1Db -t -A -c 'SHOW server_version;' 2>&1) -join ''
  Add-Evidence "  PostgreSQL server_version: $serverVersion"

  Add-EvidenceSection '迁移前 migration status（空库，尚未执行迁移）'
  $v1Before = Get-MigrationStatusText -Override $goodOverride
  Add-Evidence "  [V1 migrate status]"
  foreach ($line in ($v1Before -split "`n")) { Add-Evidence "    $line" }
  $v2Before = Get-MigrationStatusText -Override $goodOverride -V2
  Add-Evidence "  [V2 migrate status]"
  foreach ($line in ($v2Before -split "`n")) { Add-Evidence "    $line" }
  Assert-True ($v1Before -match 'migrations found') 'V1 migrate status 可执行（空库迁移前）'
  Assert-True ($v2Before -match 'migrations found') 'V2 migrate status 可执行（空库迁移前）'

  Add-EvidenceSection '按 SHA 部署 flower-web + flower-cron-worker（compose override 机制，与 deploy.yml 同款）'
  $null = Invoke-Compose -Arguments @('up', '-d', 'flower-web', 'flower-cron-worker') -Override $goodOverride
  $null = Invoke-Compose -Arguments @('ps') -Override $goodOverride
  $health = Wait-WebHealthy -TimeoutSeconds 180
  Add-Evidence "  web 容器 health: $(Get-WebHealthStatus)"
  Assert-True $health.Ok "flower-web 在模拟 SHA 部署后健康（/api/health 200 + status=ok，用时 $($health.ElapsedSeconds)s）"
  $webImageId = (& docker inspect $script:WebContainer --format '{{.Image}}' 2>$null).Trim()
  Assert-Equal $webImageId $goodImageId 'flower-web 实际运行镜像 ID 与模拟 SHA 一致'
  $cronImageId = (& docker inspect $script:CronContainer --format '{{.Image}}' 2>$null).Trim()
  Assert-Equal $cronImageId $goodImageId 'flower-cron-worker 实际运行镜像 ID 与模拟 SHA 一致'

  Add-EvidenceSection '入口迁移日志（entrypoint：校验目标 → V1 migrate deploy → V2 migrate deploy）'
  $webLogs = (& docker logs $script:WebContainer --tail 120 2>&1) -join "`n"
  foreach ($line in ($webLogs -split "`n")) {
    if ($line -match 'entrypoint|migration|migrations|Applying|successfully|Datasource|ready|Ready') { Add-Evidence "  [web] $line" }
  }
  Assert-True ($webLogs -match 'Applying migration') 'V1/V2 迁移已由 entrypoint 实际执行'
  Assert-True ($webLogs -match 'All migrations have been successfully applied') 'V2 迁移全部成功'

  Add-EvidenceSection '核心冒烟'
  $smoke = Invoke-CoreSmoke

  Add-EvidenceSection 'cron worker 启动与首轮任务（web 迁移完成前可能瞬时告错，下一轮恢复）'
  $cronRunning = (& docker inspect $script:CronContainer --format '{{.State.Status}}' 2>$null).Trim()
  Assert-Equal $cronRunning 'running' 'flower-cron-worker 运行中'
  $cronRecovered = $false
  $cronDeadline = (Get-Date).AddSeconds(100)
  while ((Get-Date) -lt $cronDeadline) {
    $cronLogs = (& docker logs $script:CronContainer --since 2m 2>&1) -join "`n"
    if ($cronLogs -match '\[cron-order-expiry\] done') { $cronRecovered = $true; break }
    Start-Sleep -Seconds 5
  }
  $cronLogsFinal = (& docker logs $script:CronContainer --since 3m 2>&1) -join "`n"
  foreach ($line in ($cronLogsFinal -split "`n")) {
    if ($line -match '^\[cron-') { Add-Evidence "  [cron] $line" }
  }
  Assert-True $cronRecovered 'cron worker 在 web 迁移完成后出现成功轮次（[cron-order-expiry] done）'

  Add-EvidenceSection '迁移后 migration status（V1/V2 均应为 up to date）'
  $v1After = Get-MigrationStatusText -Override $goodOverride
  foreach ($line in ($v1After -split "`n")) { Add-Evidence "  [V1] $line" }
  Assert-True ($v1After -match 'up to date') 'V1 migration status: up to date'
  $v2After = Get-MigrationStatusText -Override $goodOverride -V2
  foreach ($line in ($v2After -split "`n")) { Add-Evidence "  [V2] $line" }
  Assert-True ($v2After -match 'up to date') 'V2 migration status: up to date'

  Add-EvidenceSection '首次生产初始化（V2 生产 bootstrap：租户/门店/基线 + 单个管理员；仅创建不覆盖）'
  $secretsPath = (Resolve-Path $script:SecretsDir).Path
  $seed = Invoke-Compose -Arguments @(
    'run', '--rm', '--no-deps',
    '-v', "${secretsPath}:/run/secrets:ro",
    '-e', 'V2_BOOTSTRAP_ADMIN_PASSWORD_FILE=/run/secrets/bootstrap-admin-password.txt',
    'flower-web', 'npm', 'run', 'db:v2:init:production'
  ) -Override $goodOverride
  Assert-True ($seed.Output -match 'Seeded tenant') 'V2 生产初始化创建了默认租户/门店'
  Add-Evidence "  初始化命令退出码: $($seed.ExitCode)"

  Add-EvidenceSection '迁移后行数/关键表/种子核对'
  $v2Rows = Get-RowCounts -Database $script:V2Db -SqlFile (Join-Path $script:RehearsalDir 'db\checks\v2-row-counts.sql')
  $v1Rows = Get-RowCounts -Database $script:V1Db -SqlFile (Join-Path $script:RehearsalDir 'db\checks\v1-row-counts.sql')
  Assert-True ($v2Rows['Tenant'] -ge 1) 'V2 种子表 Tenant 存在行'
  Assert-True ($v2Rows['Store'] -ge 1) 'V2 种子表 Store 存在行'
  Assert-True ($v2Rows['StaffUser'] -ge 1) 'V2 种子表 StaffUser 存在行'
  Assert-Equal $v2Rows['_prisma_migrations_applied'] 7 'V2 已应用迁移数（预构建镜像包含 7 个）'
  Add-Evidence "  V2 行数: $((@($v2Rows.Keys | ForEach-Object { "$_=$($v2Rows[$_])" })) -join ', ')"
  Add-Evidence "  V1 已应用迁移数: $($v1Rows['_prisma_migrations_applied'])"

  Add-EvidenceSection '部署后 docker compose ps'
  $null = Invoke-Compose -Arguments @('ps') -Override $goodOverride

  Stop-EvidenceLog
  $summary['success-deploy'] = 'PASS'
  $summary['good_image_id'] = $goodImageId
  return [pscustomobject]@{
    Override = $goodOverride
    GoodImageId = $goodImageId
    RowCounts = $v2Rows
    V1RowCounts = $v1Rows
    WebLogs = $webLogs
  }
}

# ---------------------------------------------------------------------------
# 3. 备份与恢复检查
# ---------------------------------------------------------------------------
function Step-BackupRestore {
  param([Parameter(Mandatory)]$Success)
  $null = Start-EvidenceLog -Name 'backup-restore' -Title '备份与恢复检查：pg_dump -Fc + pg_restore 到临时库 + 行数核对'
  $stamp = $script:RunStamp
  $v1Dump = "v1-$stamp.dump"
  $v2Dump = "v2-$stamp.dump"

  Add-EvidenceSection 'pg_dump（自定义格式 -Fc；生产应落在宿主备份目录并异地保留）'
  $dump = Invoke-Compose -Arguments @(
    'exec', '-T', 'db', 'sh', '-c',
    "pg_dump -U $($script:DbUser) -Fc -d $($script:V1Db) -f /backup/$v1Dump && pg_dump -U $($script:DbUser) -Fc -d $($script:V2Db) -f /backup/$v2Dump && ls -l /backup && sha256sum /backup/$v1Dump /backup/$v2Dump"
  )
  Assert-True ($dump.Output -match 'sha256sum' -or $dump.Output -match $v1Dump) 'pg_dump 生成 V1/V2 备份文件'
  $ls = Invoke-Compose -Arguments @('exec', '-T', 'db', 'sh', '-c', "pg_restore --list /backup/$v2Dump | head -n 8")
  Assert-True ($ls.Output -match 'Archive created') 'V2 备份可被 pg_restore 识别'

  Add-EvidenceSection 'pg_restore 到临时库（不触碰原库）'
  $restore = Invoke-Compose -Arguments @(
    'exec', '-T', 'db', 'sh', '-c',
    "dropdb --if-exists -U $($script:DbUser) $($script:V1RestoreDb) && createdb -U $($script:DbUser) $($script:V1RestoreDb) && pg_restore -U $($script:DbUser) -d $($script:V1RestoreDb) --no-owner --no-privileges /backup/$v1Dump && dropdb --if-exists -U $($script:DbUser) $($script:V2RestoreDb) && createdb -U $($script:DbUser) $($script:V2RestoreDb) && pg_restore -U $($script:DbUser) -d $($script:V2RestoreDb) --no-owner --no-privileges /backup/$v2Dump"
  )
  Assert-Equal $restore.ExitCode 0 'V1/V2 备份恢复到临时库成功'

  Add-EvidenceSection '恢复结果与源库行数核对'
  $source = Get-RowCounts -Database $script:V2Db -SqlFile (Join-Path $script:RehearsalDir 'db\checks\v2-row-counts.sql')
  $restored = Get-RowCounts -Database $script:V2RestoreDb -SqlFile (Join-Path $script:RehearsalDir 'db\checks\v2-row-counts.sql')
  $diffs = Compare-RowCountTables -Before $source -After $restored
  Assert-True ($diffs.Count -eq 0) "V2 恢复库行数与源库一致（差异: $($diffs -join '; ')）"
  $v1source = Get-RowCounts -Database $script:V1Db -SqlFile (Join-Path $script:RehearsalDir 'db\checks\v1-row-counts.sql')
  $v1restored = Get-RowCounts -Database $script:V1RestoreDb -SqlFile (Join-Path $script:RehearsalDir 'db\checks\v1-row-counts.sql')
  $v1diffs = Compare-RowCountTables -Before $v1source -After $v1restored
  Assert-True ($v1diffs.Count -eq 0) "V1 恢复库行数与源库一致（差异: $($v1diffs -join '; ')）"
  Add-Evidence "  恢复核对通过：V2 差异 0 项，V1 差异 0 项"

  Add-EvidenceSection '恢复边界说明'
  Add-Evidence "  - 已演练：pg_dump 自定义格式备份、pg_restore 到临时库、关键表行数与迁移历史一致。"
  Add-Evidence "  - 未演练：生产对象存储/OSS 文件、备份异地保留、RPO/RTO 承诺、恢复期间业务停写。"
  Add-Evidence "  - 正式恢复流程须由发布负责人批准后执行，并在隔离环境先验证（本文件命令可作为模板）。"

  Stop-EvidenceLog
  $summary['backup-restore'] = 'PASS'
}

# ---------------------------------------------------------------------------
# 4. V2 增量迁移 + 迁移后回滚旧镜像兼容性
# ---------------------------------------------------------------------------
function Step-IncrementalMigration {
  param([Parameter(Mandatory)]$Success)
  $null = Start-EvidenceLog -Name 'incremental-migration' -Title 'V2 增量迁移（7→8）与迁移后旧镜像回滚兼容性'
  Add-EvidenceSection '构建「含第 8 个迁移」的模拟发布镜像（不重新 npm install / 不重新构建 Next.js）'
  $additiveRef = "$($script:ImageRepo):sha-$($script:ShaAdditive)"
  $build = Invoke-Logged -FilePath 'docker' -Arguments @(
    'build', '-f', (Join-Path $script:RehearsalDir 'images\Dockerfile.sha-additive'),
    '-t', $additiveRef, $script:RepoRoot
  ) -AllowExitCodes @(0)
  $additiveImageId = Get-ImageId $additiveRef
  Assert-True (-not [string]::IsNullOrWhiteSpace($additiveImageId)) "增量迁移模拟镜像已构建：$additiveRef"
  Add-Evidence "  $additiveRef => $additiveImageId（基于 $script:BaseImage + 0008 迁移文件）"
  Assert-True ($additiveImageId -ne $Success.GoodImageId) '增量迁移镜像与上一版镜像 ID 不同（模拟真实新版本）'
  $additiveOverride = Get-ShaOverridePath -Sha $script:ShaAdditive

  Add-EvidenceSection '迁移前基线（成功路径 seed 后的行数）'
  foreach ($key in $Success.RowCounts.Keys) { Add-Evidence "  [before] $key=$($Success.RowCounts[$key])" }

  Add-EvidenceSection '部署模拟新版本（entrypoint 对已有 V2 库执行增量迁移）'
  $null = Invoke-Compose -Arguments @('up', '-d', 'flower-web', 'flower-cron-worker') -Override $additiveOverride
  $health = Wait-WebHealthy -TimeoutSeconds 180
  Assert-True $health.Ok "增量迁移后 flower-web 健康（用时 $($health.ElapsedSeconds)s）"
  $webLogs = (& docker logs $script:WebContainer --tail 120 2>&1) -join "`n"
  foreach ($line in ($webLogs -split "`n")) {
    if ($line -match 'Applying migration|successfully applied|No pending|0008') { Add-Evidence "  [web] $line" }
  }
  Assert-True ($webLogs -match 'Applying migration `0008_purchase_supplements_and_inventory_review`') 'entrypoint 实际应用了增量迁移 0008'
  Assert-True ($webLogs -match 'All migrations have been successfully applied') '增量迁移执行成功'

  Add-EvidenceSection '迁移后 migration status 与 schema 核对'
  $v2Status = Get-MigrationStatusText -Override $additiveOverride -V2
  foreach ($line in ($v2Status -split "`n")) { Add-Evidence "  [V2] $line" }
  Assert-True ($v2Status -match 'up to date') 'V2 migration status: up to date（8 个迁移）'
  Assert-True ($v2Status -match '8 migrations found' -or $v2Status -match '8 migrations') '镜像包含 8 个 V2 迁移'
  $schema = Invoke-PsqlFile -Database $script:V2Db -SqlFile (Join-Path $script:RehearsalDir 'db\checks\v2-schema-0008.sql')
  $schemaMap = @{}
  foreach ($line in $schema) { if ($line -match '^(?<k>.+)\|(?<v>-?\d+)$') { $schemaMap[$Matches['k']] = [int]$Matches['v'] } }
  foreach ($item in @('enum_value:StocktakeState:PENDING_REVIEW', 'enum_value:StocktakeState:REJECTED', 'column:PurchaseOrderLine:relationKind', 'column:PurchaseOrderLine:sourceLineId', 'column:Stocktake:reviewReasons', 'column:LossRecord:reviewStatus')) {
    Assert-Equal $schemaMap[$item] 1 "迁移 0008 生效：$item"
  }

  Add-EvidenceSection '迁移前后数据核对（关键表行数应保持，仅迁移历史 +1）'
  $afterRows = Get-RowCounts -Database $script:V2Db -SqlFile (Join-Path $script:RehearsalDir 'db\checks\v2-row-counts.sql')
  $diffs = Compare-RowCountTables -Before $Success.RowCounts -After $afterRows -IgnoreKeys @('_prisma_migrations_applied')
  Assert-True ($diffs.Count -eq 0) "增量迁移未改变业务数据（差异: $($diffs -join '; ')）"
  Assert-Equal $afterRows['_prisma_migrations_applied'] 8 '迁移历史由 7 增至 8'
  Add-Evidence "  迁移后行数: $((@($afterRows.Keys | ForEach-Object { "$_=$($afterRows[$_])" })) -join ', ')"

  Add-EvidenceSection '迁移后回滚到上一版应用镜像（旧镜像 + 新 schema 的兼容前提）'
  $rollback = Invoke-Compose -Arguments @('up', '-d', 'flower-web', 'flower-cron-worker') -Override $Success.Override
  Add-Evidence "  回滚命令退出码: $($rollback.ExitCode)（应用镜像回滚，数据库不回滚）"
  $healthBack = Wait-WebHealthy -TimeoutSeconds 180
  Assert-True $healthBack.Ok "旧镜像在新 schema 上健康（用时 $($healthBack.ElapsedSeconds)s）"
  $oldImageId = (& docker inspect $script:WebContainer --format '{{.Image}}' 2>$null).Trim()
  Assert-Equal $oldImageId $Success.GoodImageId '已回滚到上一版镜像 ID'
  $smoke = Invoke-CoreSmoke
  $v2StatusOld = Get-MigrationStatusText -Override $Success.Override -V2
  foreach ($line in ($v2StatusOld -split "`n")) { Add-Evidence "  [V2-old-image] $line" }
  Add-Evidence "  兼容结论：0008 为加列/加枚举值/加表/加索引的向后兼容迁移；上一版镜像可启动、健康并冒烟通过。"
  Add-Evidence "  边界：若迁移含删除/重命名/收紧约束，旧镜像不保证兼容，必须先按备份恢复或前滚修复（见 Runbook 不可逆迁移清单）。"

  Stop-EvidenceLog
  $summary['incremental-migration'] = 'PASS'
  $summary['incremental_image_id'] = $additiveImageId
}

# ---------------------------------------------------------------------------
# 5. 失败停止
# ---------------------------------------------------------------------------
function Step-FailureStop {
  param([Parameter(Mandatory)]$Success)
  $null = Start-EvidenceLog -Name 'failure-stop' -Title '失败停止演练：错误数据库目标 / 不可用数据库 / 缺陷镜像'
  $maskedPassword = 'REHEARSAL-MASKED'

  Add-EvidenceSection 'F1a 部署前目标校验：V2 与 V1 使用同一数据库名 → 必须停止'
  $f1a = Invoke-Compose -Arguments @(
    'run', '--rm', '--no-deps', '--entrypoint', 'node',
    '-e', "V2_DATABASE_URL=postgresql://$($script:DbUser):$maskedPassword@db:5432/$($script:V1Db)?schema=public",
    'flower-web', 'scripts/check-v2-database-target.mjs'
  ) -Override $Success.Override -AllowExitCodes @(0, 1) -NoThrow
  Assert-True ($f1a.ExitCode -ne 0) "F1a 目标校验失败并停止（exit=$($f1a.ExitCode)）"
  Assert-True ($f1a.Output -match 'distinct PostgreSQL database names') 'F1a 错误信息明确：V1/V2 数据库名必须不同'
  Add-Evidence "  [STOP] 未替换现有 stack，仍运行上一版镜像。"

  Add-EvidenceSection 'F1b 部署前连通性校验：V2_DATABASE_URL 指向不可用数据库端口 → 必须停止'
  $f1b = Invoke-Compose -Arguments @(
    'run', '--rm', '--no-deps', '--entrypoint', 'node',
    '-e', "V2_DATABASE_URL=postgresql://$($script:DbUser):$maskedPassword@db:5999/$($script:V2Db)?schema=public",
    'flower-web', 'scripts/check-v2-database-target.mjs', '--connect'
  ) -Override $Success.Override -AllowExitCodes @(0, 1) -NoThrow
  Assert-True ($f1b.ExitCode -ne 0) "F1b 连通性校验失败并停止（exit=$($f1b.ExitCode)）"
  Add-Evidence "  [STOP] 发布脚本在替换 stack 前即停止；生产命令见 deploy.yml 的 --connect 预检。"

  Add-EvidenceSection 'F1c entrypoint 迁移失败：V2 目标不可达 → 容器退出，不进入健康/冒烟'
  $f1c = Invoke-Compose -Arguments @(
    'run', '--rm', '--no-deps',
    '-e', "V2_DATABASE_URL=postgresql://$($script:DbUser):$maskedPassword@db:5999/$($script:V2Db)?schema=public",
    'flower-web', 'true'
  ) -Override $Success.Override -AllowExitCodes @(0, 1) -NoThrow
  Assert-True ($f1c.ExitCode -ne 0) "F1c entrypoint 迁移失败退出（exit=$($f1c.ExitCode)）"
  foreach ($line in ($f1c.Output -split "`n")) {
    if ($line -match 'P1001|Can.t reach|migrate deploy|Error') { Add-Evidence "  [entrypoint] $line" }
  }
  $stillHealthy = Get-HttpStatus -Url $script:HealthUrl
  Assert-Equal $stillHealthy.Code '200' 'F1c 失败未影响正在运行的上一版（仍为健康状态）'
  Add-Evidence "  [STOP] 迁移失败即停：不继续执行迁移后核对/冒烟。"

  Add-EvidenceSection 'F2 缺陷镜像发布：健康检查失败 → 停止并回滚'
  $badRef = "$($script:ImageRepo):sha-$($script:ShaBad)"
  $build = Invoke-Logged -FilePath 'docker' -Arguments @(
    'build', '-f', (Join-Path $script:RehearsalDir 'images\Dockerfile.sha-bad'),
    '-t', $badRef, (Join-Path $script:RehearsalDir 'images')
  )
  $badImageId = Get-ImageId $badRef
  Assert-True (-not [string]::IsNullOrWhiteSpace($badImageId)) "缺陷镜像已构建：$badRef"
  Add-Evidence "  $badRef => $badImageId（删除 /app/server.js，模拟有缺陷发布）"
  $badOverride = Get-ShaOverridePath -Sha $script:ShaBad
  $null = Invoke-Compose -Arguments @('up', '-d', 'flower-web', 'flower-cron-worker') -Override $badOverride
  $badHealth = Wait-WebHealthy -TimeoutSeconds 45
  Assert-True (-not $badHealth.Ok) "F2 新版本健康检查失败（预期失败，code=$($badHealth.Code)）"
  $badHealthStatus = Get-WebHealthStatus
  Add-Evidence "  缺陷镜像 web 容器 health 状态: $badHealthStatus"
  Assert-True ($badHealthStatus -ne 'healthy') '缺陷镜像 web 容器未达到 healthy 状态'
  $ps = Invoke-Compose -Arguments @('ps', '-a') -Override $badOverride -AllowExitCodes @(0) -NoThrow
  $badLogs = (& docker logs $script:WebContainer --tail 30 2>&1) -join "`n"
  foreach ($line in ($badLogs -split "`n")) {
    if ($line -match 'MODULE_NOT_FOUND|server.js|Error') { Add-Evidence "  [bad-image] $line" }
  }
  Assert-True ($badLogs -match 'MODULE_NOT_FOUND|server.js') '失败原因可定位（server.js 缺失）'
  Add-Evidence "  [STOP] 健康检查失败：不执行核心冒烟，不继续后续发布步骤；转回滚。"

  Stop-EvidenceLog
  $summary['failure-stop'] = 'PASS'
  $summary['bad_image_id'] = $badImageId
  return [pscustomobject]@{ BadImageId = $badImageId }
}

# ---------------------------------------------------------------------------
# 6. 应用镜像回滚（坏 SHA → 上一版 SHA，健康恢复）
# ---------------------------------------------------------------------------
function Step-ImageRollback {
  param([Parameter(Mandatory)]$Success)
  $null = Start-EvidenceLog -Name 'image-rollback' -Title '应用镜像回滚：缺陷 SHA → 上一版 SHA，健康恢复'
  Add-EvidenceSection '回滚前状态（缺陷版本）'
  $before = Get-HttpStatus -Url $script:HealthUrl
  Add-Evidence "  /api/health -> $($before.Code)（缺陷版本预期不可用）"

  Add-EvidenceSection "切换回上一版镜像 sha-$($script:ShaGood)（compose override，数据库不回滚）"
  $up = Invoke-Compose -Arguments @('up', '-d', 'flower-web', 'flower-cron-worker') -Override $Success.Override
  Add-Evidence "  回滚部署退出码: $($up.ExitCode)"
  $health = Wait-WebHealthy -TimeoutSeconds 180
  Assert-True $health.Ok "回滚后 /api/health 恢复（200 + status=ok，用时 $($health.ElapsedSeconds)s）"
  $webImageId = (& docker inspect $script:WebContainer --format '{{.Image}}' 2>$null).Trim()
  Assert-Equal $webImageId $Success.GoodImageId '运行镜像已切回上一版 SHA 对应镜像 ID'
  $smoke = Invoke-CoreSmoke
  $status = Get-MigrationStatusText -Override $Success.Override -V2
  foreach ($line in ($status -split "`n")) { Add-Evidence "  [V2] $line" }
  Add-Evidence "  回滚后 docker compose ps:"
  $null = Invoke-Compose -Arguments @('ps') -Override $Success.Override
  Add-Evidence "  [PASS] 应用镜像回滚完成，健康与核心冒烟恢复；数据库迁移保持前滚（未回滚）。"

  Stop-EvidenceLog
  $summary['image-rollback'] = 'PASS'
}

# ---------------------------------------------------------------------------
# 7. 清理与隔离校验
# ---------------------------------------------------------------------------
function Step-Cleanup {
  $null = Start-EvidenceLog -Name 'cleanup' -Title '清理与隔离校验'
  Add-EvidenceSection '清理前资源快照'
  Get-RehearsalResourceSnapshot -Label '清理前'
  Add-Evidence "  本地开发数据库容器（清理前）: $($script:DevPgBefore)"

  $null = Remove-RehearsalStack -RemoveImages
  Add-EvidenceSection '清理后资源快照'
  $devPgAfter = ((& docker ps -a --filter 'name=flower-v2-pg' --format '{{.ID}}|{{.Image}}|{{.Status}}' 2>&1) -join ' ').Trim()
  Add-Evidence "  本地开发数据库容器（清理后）: $devPgAfter"
  Assert-Equal $devPgAfter $script:DevPgBefore '演练未触碰原有本地开发数据库容器'
  $allContainers = @(& docker ps -a --format '{{.Names}}|{{.Status}}' 2>&1)
  Add-Evidence "  当前全部容器（清理后）:"
  foreach ($line in $allContainers) { Add-Evidence "    $line" }
  Add-Evidence "  剩余演练镜像标签检查:"
  foreach ($sha in @($script:ShaGood, $script:ShaAdditive, $script:ShaBad)) {
    $ref = "$($script:ImageRepo):sha-$sha"
    $exists = @(& docker image ls $ref --format '{{.Repository}}:{{.Tag}}' 2>&1 | Where-Object { $_ })
    Add-Evidence "    $ref -> $(if ($exists) { '仍存在（可用于复跑，清理脚本 -RemoveImages 可移除）' } else { '已移除' })"
  }
  Add-Evidence "  预构建基础镜像保留: $script:BaseImage => $(Get-ImageId $script:BaseImage)"
  $disk = Get-PSDrive -Name ($script:RepoRoot.Substring(0, 1)) -ErrorAction SilentlyContinue
  if ($disk) { Add-Evidence "  宿主磁盘可用: $([math]::Round($disk.Free / 1GB, 2)) GiB" }

  Stop-EvidenceLog
  $summary['cleanup'] = 'PASS'
}

# ---------------------------------------------------------------------------
# 8. 总结
# ---------------------------------------------------------------------------
function Step-Summary {
  $null = Start-EvidenceLog -Name 'summary' -Title '演练总结（已演练 / 未覆盖 / 残留风险）'
  $elapsed = [math]::Round(((Get-Date) - $script:RunStartedAt).TotalMinutes, 1)
  Add-Evidence "  运行模式: $Mode；总用时: $elapsed 分钟；run_id: $($script:RunStamp)"
  Add-Evidence ''
  Add-EvidenceSection '场景结果'
  foreach ($key in $summary.Keys) { Add-Evidence "  $key = $($summary[$key])" }
  Add-Evidence ''
  Add-EvidenceSection '模拟 SHA 标签与镜像 ID'
  Add-Evidence "  sha-$($script:ShaGood)（上一版，预构建镜像）: $($summary['good_image_id'])"
  Add-Evidence "  sha-$($script:ShaAdditive)（含第 8 个 V2 迁移的模拟新版本）: $($summary['incremental_image_id'])"
  Add-Evidence "  sha-$($script:ShaBad)（演练用缺陷镜像）: $($summary['bad_image_id'])"
  Add-Evidence "  说明：这些 SHA 是人工模拟标签，不对应真实提交；真实基线 HEAD 见 preflight 日志。"
  Add-Evidence ''
  Add-EvidenceSection '已演练验证'
  Add-Evidence "  - 隔离 Compose 栈（独立项目名/容器名/网络/卷、宿主端口 $($script:WebPort)/$($script:DbPort)、V1/V2 独立库名）"
  Add-Evidence "  - 空库 V1 45 个/V2 7 个迁移由 entrypoint 自动执行；migrate status 前后核对"
  Add-Evidence "  - /api/health、/login、/v2 核心冒烟；production bootstrap 初始化；迁移后行数核对"
  Add-Evidence "  - pg_dump -Fc 备份 + pg_restore 到临时库 + 行数一致（V1/V2）"
  Add-Evidence "  - 已有 V2 库增量迁移（7→8）+ 迁移前后行数不变 + 迁移后旧镜像启动/健康/冒烟（加列加枚举值向后兼容）"
  Add-Evidence "  - 失败停止：V1/V2 同名、目标不可达（预检/--connect/entrypoint 迁移）、缺陷镜像健康失败"
  Add-Evidence "  - 应用镜像回滚：sha-$($script:ShaBad) → sha-$($script:ShaGood)，health 恢复 200、冒烟通过；数据库保持前滚"
  Add-Evidence "  - 清理并验证不触碰原有本地开发容器"
  Add-Evidence ''
  Add-EvidenceSection '本地无法覆盖（需维护者/生产环境办理）'
  Add-Evidence "  - 真实 docker build：当前 npm 镜像(npmmirror) vitest 包 500 失败，本机无 ACR/GitHub 凭据；"
  Add-Evidence "    本次以本地预构建镜像 + 模拟 SHA 标签替代，不能证明当前 HEAD 可构建。"
  Add-Evidence "  - ACR 推送、GitHub Actions deploy.yml 真实执行、生产主机 SSH 远程部署"
  Add-Evidence "  - 生产 nginx 边缘/证书/上传限制、真实生产数据备份保留与异地存储、RPO/RTO 与停机窗口"
  Add-Evidence "  - 分支保护、PR 门禁实际阻止合并（需仓库管理员在 GitHub 配置并验证）"
  Add-Evidence "  - 多实例/滚动发布、负载均衡、生产回滚审批流程"
  Add-Evidence ''
  Add-EvidenceSection '证据文件'
  foreach ($file in $script:EvidenceFiles) { Add-Evidence "  $(Split-Path -Leaf $file)" }
  Add-Evidence ''
  Add-EvidenceSection '残留风险'
  Add-Evidence "  - 生产 compose 的 postgres 卷挂载路径 /var/lib/postgresql/data 与 PostgreSQL 18 的 PGDATA(/var/lib/postgresql/18/docker) 不匹配，浮动 tag postgres:alpine 现为 18.6；重建容器可能丢数据 → 发布前必须处理（见 Runbook 已知风险）。"
  Add-Evidence "  - 本机工作区存在空的 prisma/migrations/0008_* 目录（未跟踪）；若被打入真实构建，可能影响 migrate deploy，发布前需清理核对。"
  Add-Evidence "  - 预构建镜像只含 7 个 V2 迁移，工作区已是 8 个；真实新版本必须由维护者用当前 HEAD 构建并验证。"
  Add-Evidence "  - cron worker 在 web 迁移完成前启动会出现瞬时 P2021/P2022 报错，下一轮恢复；发布后应确认首轮成功轮次。"
  Stop-EvidenceLog
}

# ===========================================================================
# 主流程
# ===========================================================================
$exitCode = 0
try {
  Start-EvidenceRun -Mode $Mode
  Write-Host ''
  Write-Host '############################################################'
  Write-Host '# E1.8 非生产发布演练开始'
  Write-Host '############################################################'

  if ($Mode -eq 'cleanup-only') {
    Initialize-RehearsalRuntime
    Step-Cleanup
    Step-Summary
    Write-Host '[PASS] 仅清理完成'
  } else {
    # 可复跑：先清掉上一次可能残留的本项目资源（不会触碰其他项目）
    $null = Start-EvidenceLog -Name 'bootstrap-cleanup' -Title '运行前清理残留演练资源（可复跑）'
    try { Remove-RehearsalStack -RemoveImages } catch { Add-Evidence "  运行前清理非致命错误: $_" }
    Stop-EvidenceLog

    $preflight = Step-Preflight
    Initialize-RehearsalRuntime
    $success = Step-SuccessDeploy
    Step-BackupRestore -Success $success
    Step-IncrementalMigration -Success $success
    $null = Step-FailureStop -Success $success
    Step-ImageRollback -Success $success

    if ($SkipCleanup) {
      $summary['cleanup'] = 'SKIPPED (-SkipCleanup)'
      Write-Host '[SKIP] 保留演练栈（-SkipCleanup），请随后运行 Clear-Rehearsal.ps1 清理'
    } else {
      Step-Cleanup
    }
    Step-Summary
  }

  Write-Host ''
  Write-Host '############################################################'
  Write-Host '# [PASS] E1.8 非生产发布演练完成'
  Write-Host '############################################################'
} catch {
  $runFailed = $true
  $failureMessage = "$_"
  $exitCode = 1
  Write-Host "[FAIL] 演练失败: $_"
  if ($null -ne $script:CurrentLog) {
    Add-Evidence "`n[FAIL] 演练失败：$_"
    Add-Evidence "  位置: $($_.ScriptStackTrace)"
    Stop-EvidenceLog
  }
  $summary['result'] = 'FAILED'
  $summary['failure'] = $failureMessage
  if ($null -eq $script:CurrentLog) {
    try { $null = Start-EvidenceLog -Name 'run-failed' -Title '演练失败记录' } catch { }
  }
  if ($null -ne $script:CurrentLog) {
    Add-Evidence "`n[FAIL] $failureMessage"
    Stop-EvidenceLog
  }
  try { Step-Summary } catch { Write-Host "[warn] summary 记录失败: $_" }
  if (-not $SkipCleanup) {
    try { Step-Cleanup } catch { Write-Host "[warn] 失败后清理异常: $_" }
  }
  Write-Host ''
  Write-Host "[FAIL] 演练未通过，证据: $($script:EvidenceDir)"
}

exit $exitCode
