# E1.8 非生产发布演练（deploy/rehearsal）

本目录是 [最小发布 Runbook](../../docs/flower-studio-2.0-release-runbook.md) 的可执行演练资源：
用**与生产隔离**的 Docker Compose 栈，在非生产环境逐条验证发布前检查、迁移、健康检查、核心冒烟、
备份恢复、失败停止与镜像回滚，并把证据保存到 `docs/evidence/sprint-e1/logs/e18-*.log`。

> 发布与生产切换只由项目用户批准。本目录只用于演练，不是生产部署文件；
> 不修改生产 `Dockerfile`、`docker-compose.example.yml`、`.github/workflows/deploy.yml`、
> `package.json`/锁文件或应用源码。

## 演练边界（重要）

本机没有 ACR 与 GitHub 凭据，且当前代码重新 `docker build` 会因 npm 镜像（npmmirror）的
vitest 包返回 500 而失败。因此演练**不构建真实发布镜像**，而是：

- 以本地预构建镜像 `flower-e05-verification:final`（E0.5 验证镜像，`/app` 内含 `server.js`、
  prisma、V2 迁移、`docker-entrypoint.sh`）作为「上一版可用镜像」；
- 用人工 sha 标签模拟按提交 SHA 部署/回滚：`sha-a11c0de`、`sha-add1t1`、`sha-badc0de`
  （**均非真实提交**，真实基线 HEAD 记录在 preflight 证据中）；
- 用 `images/Dockerfile.sha-additive` 在预构建镜像上追加 V2 第 8 个迁移，模拟新版本迁移；
- 用 `images/Dockerfile.sha-bad` 删除 `server.js`，模拟一次健康检查失败的缺陷发布。

真实镜像构建、ACR 推送、GitHub Actions 远程部署、生产分支保护不在本地演练范围，
必须在维护者环境验证；Runbook 与证据 summary 中均列为「本地无法覆盖」。

## 目录结构

```text
deploy/rehearsal/
├── README.md                          # 本文件
├── .gitignore                         # 忽略 .runtime/
├── compose/
│   └── docker-compose.rehearsal.yml   # 隔离演练栈（db + flower-web + flower-cron-worker）
├── env/
│   └── rehearsal.env.example          # env 模板（占位符，禁止写入真实密钥）
├── db/
│   ├── init/10-create-v2-database.sql # 首次启动时创建 V2 独立库
│   └── checks/                        # 行数/迁移/schema 核对 SQL
├── images/
│   ├── Dockerfile.sha-additive        # 模拟“带第 8 个 V2 迁移”的新版本镜像
│   └── Dockerfile.sha-bad             # 模拟有缺陷的发布镜像
├── scripts/
│   ├── Rehearsal.Common.ps1           # 公共函数（证据日志、compose 包装、健康/冒烟/行数）
│   ├── Invoke-Rehearsal.ps1           # 主演练脚本（可复跑）
│   └── Clear-Rehearsal.ps1            # 单独清理脚本
└── .runtime/                          # 运行生成物（gitignore）：env、随机密码、override、备份
```

## 前置条件

- Windows + PowerShell 7（`pwsh`）、Docker Desktop（演练时 Docker 29.9.2 / Compose v5.6.1）。
- 本地已存在镜像：`flower-e05-verification:final`、`postgres:18-alpine`。
  （`docker pull` 由执行者按网络情况处理；本目录不自动拉取。）
- 宿主端口 `18080`（web）与 `15432`（db）空闲；二者都只绑定 `127.0.0.1`。
- 不会触碰生产容器/卷/数据，也不影响本地开发容器（如 `flower-v2-pg`）。

## 使用方法

```powershell
# 完整演练（成功路径 + 备份恢复 + 增量迁移 + 失败停止 + 镜像回滚 + 清理）
pwsh -File deploy/rehearsal/scripts/Invoke-Rehearsal.ps1

# 保留演练栈用于人工检查（随后手动清理）
pwsh -File deploy/rehearsal/scripts/Invoke-Rehearsal.ps1 -SkipCleanup
pwsh -File deploy/rehearsal/scripts/Clear-Rehearsal.ps1 -RemoveImages

# 仅清理（例如上次异常中断）
pwsh -File deploy/rehearsal/scripts/Invoke-Rehearsal.ps1 -Mode cleanup-only
# 或
pwsh -File deploy/rehearsal/scripts/Clear-Rehearsal.ps1
```

脚本可重复执行：每次运行开始时先清理本项目残留资源，再生成新的随机本地凭据。
证据文件写入 `CMS_and_WMS/docs/evidence/sprint-e1/logs/e18-<阶段>-<run_id>.log`。

## 隔离资源

| 资源 | 演练值 | 与生产/本地开发隔离 |
|---|---|---|
| Compose 项目名 | `flower-e1-8-rehearsal` | 所有容器/网络/卷带前缀 |
| 容器名 | `flower-e18-web` / `flower-e18-cron` / `flower-e18-db` | 不冲突于 `flower-web-prod` 等 |
| 网络 | `flower-e1-8-rehearsal_default` | 独立 bridge |
| 卷 | `flower-e1-8-rehearsal_postgres_data` / `_next_cache` | `down -v` 只删本项目的卷 |
| 宿主端口 | web `127.0.0.1:18080`；db `127.0.0.1:15432` | 避开 3000/5432 |
| 数据库 | V1 `flower_e18_v1`、V2 `flower_e18_v2` | 独立库名，脚本校验两者不同 |
| 凭据 | 每次运行随机生成，写入 `.runtime/`（gitignore） | 不含真实密钥，不写日志 |

## 演练场景

| 场景 | 内容 | 对应证据文件 |
|---|---|---|
| 发布前检查 | Docker/Compose/PostgreSQL 版本、Git 基线、本地镜像 ID、端口占用、隔离基线 | `e18-preflight-*.log` |
| 成功路径 | 起 db → V1(45)/V2(7) 迁移 → 起 web+cron → `/api/health` → `/login` `/v2` 冒烟 → V2 生产初始化 → 行数核对 | `e18-success-deploy-*.log` |
| 备份与恢复 | `pg_dump -Fc` V1/V2 → `pg_restore` 到临时库 → 行数与迁移历史一致 | `e18-backup-restore-*.log` |
| 增量迁移 | 模拟新版本（第 8 个 V2 迁移）→ 迁移前后行数不变 → 迁移后回滚旧镜像仍健康（加列/加枚举值向后兼容） | `e18-incremental-migration-*.log` |
| 失败停止 | V1/V2 同名目标、不可达数据库（`--connect` 预检与 entrypoint 迁移失败）、缺陷镜像健康失败 → 停止且不继续 | `e18-failure-stop-*.log` |
| 应用镜像回滚 | 缺陷 SHA → 上一版 SHA，`/api/health` 恢复、冒烟通过 | `e18-image-rollback-*.log` |
| 清理与隔离 | `down -v` 后无残留；确认未触碰原有本地开发容器 | `e18-cleanup-*.log` |
| 总结 | 已演练/未覆盖/残留风险、镜像 ID 与模拟 SHA、证据清单 | `e18-summary-*.log` |

## 与生产 compose 的已知差异（演练不复制、发布前必须处理）

1. 生产 `docker-compose.example.yml` / `docker-compose.yml` 的 db 卷挂载为
   `/var/lib/postgresql/data`，但 `postgres:alpine` 目前解析为 PostgreSQL 18.6，其
   `PGDATA=/var/lib/postgresql/18/docker`。PG18 建议把卷挂载到 `/var/lib/postgresql`；
   沿用旧挂载路径时重建容器可能丢数据。演练栈使用正确的 `/var/lib/postgresql` 挂载，
   Runbook「已知风险」记录了该生产待决项。
2. 演练栈不包含生产 `flower-nginx` 边缘（本地无 nginx 镜像，且不属应用发布核心逻辑）；
   nginx 配置/reload 步骤只在 Runbook 中以生产命令给出，未在本地演练。
3. 演练使用预构建镜像的 7 个 V2 迁移；当前工作区源码已包含第 8 个迁移，
   真实新版本镜像必须由维护者用当前 HEAD 重新构建。
