# Flower WMS Sprint E2 · staging（发布与恢复演练）

本目录是 Sprint E2 的本机 staging 入口与远程 staging 复用模板，属于 **非生产** 资源：

- E2.1 建立 staging 与真实镜像基线；
- E2.2 按 SHA 部署与失败停止；
- E2.3 自动备份与独立恢复；
- E2.4 迁移前后验证；
- E2.5 回滚与恢复演练；
- E2.6 发布记录与关闭条件。

生产发布只由项目用户批准；本目录不修改生产 Compose、生产 workflow 或生产容器/数据。

## 隔离资源（本机默认）

| 资源 | 基线项目 `flower-e2-staging` | 验证项目 `flower-e2-verify`（E2.4） |
|---|---|---|
| 容器 | `flower-e2-staging-db/web/cron` | `flower-e2-verify-db/web/cron` |
| 网络 | `flower-e2-staging_default` | `flower-e2-verify_default` |
| 卷 | `flower-e2-staging_postgres_data` / `_next_cache` | `flower-e2-verify_*` |
| 宿主端口 | web `127.0.0.1:18081`、db `127.0.0.1:15433` | web `18082`、db `15434` |
| 数据库 | V1 `flower_e2_v1`、V2 `flower_e2_v2_test` | `flower_e2_verify_v1/v2_test` |
| 凭据 | 每次运行随机生成，写入 `.runtime/`（gitignore） | 同上 |

已占用且**不得触碰**：`5432` 原生 Windows PostgreSQL 18 服务、`55432` 本地开发容器 `flower-v2-pg`（库 `flower_v2_test`）。

基础镜像：`postgres:18-alpine@sha256:10a5c69a83035ab5239f5620d708520e8b28f5aa1f2b20143e6024532edadfb5`（本地校验为 PostgreSQL 18.x；PGDATA 挂载 `/var/lib/postgresql`）。

## 前置条件

- Windows + PowerShell 7；Docker Desktop（本机基线 Docker 29.9.2 / Compose v5.6.1）。
- 宿主端口 18081/15433（以及验证项目 18082/15434）空闲。
- C: 盘与 Docker 数据盘有余量（本机 Docker 数据位于 `C:\Users\<user>\AppData\Local\Docker\wsl\disk\docker_data.vhdx`；构建前检查）。
- 目标源码提交的镜像已构建（见下）。

## 使用

```powershell
# 1) 从当前 HEAD 构建真实镜像（记录 SHA/镜像 ID/日志到 docs/evidence/sprint-e2/logs）
pwsh -File deploy/staging/scripts/Invoke-Staging.ps1 build

# 2) 启动隔离栈（随机凭据 → db → --connect 目标预检 → web 迁移 → 合成数据 → cron）
pwsh -File deploy/staging/scripts/Invoke-Staging.ps1 up

# 3) 启动与验收（健康/登录/V2 入口/双库迁移/行数/cron/隔离清单）
pwsh -File deploy/staging/scripts/Invoke-Staging.ps1 verify

# 4) 持久化试验（只重建 db 容器，确认数据与迁移历史保留）
pwsh -File deploy/staging/scripts/Invoke-Staging.ps1 persistence

# 5) 清理（仅本项目容器/卷/网络）
pwsh -File deploy/staging/scripts/Invoke-Staging.ps1 cleanup
```

说明：

- `up` 之后保持栈运行，供 E2.2–E2.5 复用；`cleanup` 前先确认证据已归档。
- 入口会从 `.runtime/images.json` 选择最新构建镜像；也可 `-Image <ref>` 指定。
- `--connect` 预检与所有容器内命令都带 `--entrypoint`，避免预检触发迁移；迁移只由 `flower-web` 的 `docker-entrypoint.sh` 执行。
- 合成数据使用 V2 `test` seed 的 `minimum,roles` tier（账号 admin/manager/buyer/sales/florist，密码=用户名，仅 staging）；seed 要求 `NODE_ENV!=production`、目标为 localhost 且库名以 `_test` 结尾，因此由宿主经 `127.0.0.1:15433` 写入 `flower_e2_v2_test`，应用容器通过 compose 网络访问同一库；不使用生产初始化账号。

## 证据

- 目录：`docs/evidence/sprint-e2/logs/`，命名 `e2<包号>-<场景>-<run_id>.log`。
- 证据只含命令、退出码、数量与相对路径；连接串、密码、`AUTH_SECRET` 不写日志。
- 镜像对照写入 `deploy/staging/.runtime/images.json`（gitignore）：源码 SHA、本地 image ID、平台、构建 run_id、本地 RepoDigest；远程推送后另记 registry digest。

## 远程 staging 接入待办（本机无资源，未验证）

| 项 | 状态 | 负责人 |
|---|---|---|
| 主机/SSH 访问、部署目录 | 待提供 | 维护者 |
| staging 域名、DNS、TLS 证书 | 待提供 | 维护者 |
| 镜像仓库（ACR）仓库路径与 push/pull 凭据、最小权限账号 | 待提供 | 维护者 |
| staging secrets（`AUTH_SECRET`/`NEXTAUTH_SECRET`、数据库密码）注入方式 | 待设计 | 维护者 + DSH |
| 外部服务测试配置（OSS bucket、微信、DeepSeek） | 待提供 | 维护者 |
| registry digest 与源码 SHA 对照、真实 push/pull 证据 | 待执行 | 维护者/DSH |
| staging 域名冒烟（含 nginx 上传限制/413） | 待执行 | 维护者/DSH |
| 远程 Linux 命令等价片段 | 本文档与脚本注释内提供 | DSH |

远程复用同一 compose 拓扑时，通过环境变量切换：`STAGING_PROJECT`、`STAGING_IMAGE`、`STAGING_WEB_PORT`、`STAGING_DB_PORT`、`STAGING_ENV_NAME`；远程不依赖 Windows 路径（`.runtime/` 相对路径由 compose 文件位置解析）。

## Linux/远程等价命令（供远程 staging 参考）

```bash
# 构建（仓库根执行）
docker build --platform linux/amd64 \
  --build-arg NEXT_PUBLIC_API_URL="https://<staging-domain>" \
  --build-arg NEXT_PUBLIC_ASSET_BASE_URL="https://<staging-domain>" \
  -t "<registry>/<namespace>/flower-platform-app:<sha>" .

# 启动前目标预检（不得触发迁移）
docker compose -p "$STAGING_PROJECT" -f deploy/staging/compose/docker-compose.staging.yml \
  run --rm --no-deps --entrypoint sh flower-web -ec \
  'node scripts/check-v2-database-target.mjs --connect'

# 迁移状态
docker compose -p "$STAGING_PROJECT" -f deploy/staging/compose/docker-compose.staging.yml \
  exec -T flower-web npx prisma migrate status
docker compose -p "$STAGING_PROJECT" -f deploy/staging/compose/docker-compose.staging.yml \
  exec -T flower-web npm run db:v2:migrate:status

# 备份（容器内 pg_dump 写宿主挂载的 /backup）
docker compose -p "$STAGING_PROJECT" -f deploy/staging/compose/docker-compose.staging.yml \
  exec -T db sh -c 'pg_dump -U "$POSTGRES_USER" -Fc -d "$POSTGRES_DB"' > "<host-backup>/v1-<ts>.dump"
```

## 备份与恢复（E2.3）

```powershell
# 备份（分库 pg_dump -Fc → 校验 → 候选登记；失败隔离到 failed/）
pwsh -File deploy/staging/scripts/Backup-Staging.ps1 -Label manual -Retention 5

# 定时入口（非生产；默认不注册系统任务）
pwsh -File deploy/staging/scripts/Start-StagingBackupLoop.ps1 -Once
pwsh -File deploy/staging/scripts/Start-StagingBackupLoop.ps1 -IntervalMinutes 1 -MaxRuns 2

# 恢复到本次新建的隔离库（必须确认；默认恢复后删除目标库）
pwsh -File deploy/staging/scripts/Restore-Staging.ps1 `
  -Archive deploy/staging/.runtime/backup/<set>/v2-<ts>.dump `
  -TargetDatabase flower_e2_restore_<run> -ConfirmNewTarget

# 场景自测（定时两轮、坏归档、目标冲突、保留、有效恢复）
pwsh -File deploy/staging/scripts/Invoke-BackupRestoreTests.ps1 -Retention 2
```

备份集写入 `deploy/staging/.runtime/backup/<UTC>-<label>/`（manifest.json 含 sha256/行数基线/源版本）；恢复目标必须以 `flower_e2_restore_` 开头且不存在，恢复后核对迁移历史与行数基线。

## 部署与失败停止（E2.2）

```powershell
# 预检（不替换应用）
pwsh -File deploy/staging/scripts/Deploy-Staging.ps1 -TargetImage <ref> -DryRun

# 部署（迁移只由 web entrypoint 执行；web 健康+迁移后核对通过后才启动 cron）
pwsh -File deploy/staging/scripts/Deploy-Staging.ps1 -TargetImage <ref> [-PreviousImage <ref>]

# 迁移前后检查（E2.2 集成；E2.4 批次扩展空库/增量）
pwsh -File deploy/staging/scripts/Test-StagingMigration.ps1 -Mode preflight
pwsh -File deploy/staging/scripts/Test-StagingMigration.ps1 -Mode post
```

退出码：`2` 目标/连通性、`3` 非预期历史、`4` 迁移失败/未完成、`5` 迁移后核对失败、`6` web 健康失败、`7` 部署锁冲突、`8` cron/镜像不一致。失败时保留日志与旧镜像，不自动回滚数据库。

## 受控测试镜像（仅本机）

`deploy/staging/images/Dockerfile.bad-health`（删除 `server.js`）与 `Dockerfile.bad-migration`（注入必然失败的 V2 迁移）用于失败停止演练；不进入生产构建，不修改仓库迁移历史。

## staging workflow 提案

见 [workflow-proposal.md](workflow-proposal.md)：本 Sprint 只交付提案，不修改 `.github/workflows/`。
## 与生产的已知差异

1. 本机 staging 不含 nginx 边缘：上传限制/413、域名与 TLS 只在远程 staging 验证。
2. 本机 staging 使用合成数据与测试 seed；生产初始化路径（`db:v2:init:production`）不在 staging 基线执行。
3. 本机结果标注“本机验证”；registry digest、SSH 远程部署、GitHub Actions 执行在远程或维护者环境验证。
4. 生产 Compose 的 PG 卷路径/版本问题（Runbook §12.1）不在本目录修复，由维护者确认。


