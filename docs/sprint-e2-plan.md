# Flower WMS Sprint E2 执行计划（DSH）

2026-11-10。依据 [Sprint E2 发布与恢复交接](sprint-e2-dsh-handoff.md)、[E1 发布手册](flower-studio-2.0-release-runbook.md) 第 12～14 节、[隔离演练入口](../deploy/rehearsal/README.md)、[ADR-001](../knowledge/05-ADR/ADR-001-v1-v2-transition.md)、[ADR-002](../knowledge/05-ADR/ADR-002-v2-database-migration.md)、[ADR-005](../knowledge/05-ADR/ADR-005-codex-dsh-responsibilities.md)，并参考 [E1.8 演练汇总](evidence/sprint-e1/logs/e18-summary-20261110-105256.log)、[E1 PR workflow](../.github/workflows/pr.yml) 与 [V1/V2 归属](../knowledge/03-Architecture/E0-v1-v2-ownership.md)。

**执行状态（2026-11-10）：E2.1–E2.6 本机范围内完成，见 [Sprint E2 交付简报](sprint-e2-evidence.md)；远程 staging、生产发布与 Codex 独立验收未完成。** 执行前需用户确认第 9 节的默认项；执行期间每个工作包按第 8 节产出证据与自测结论，最终交 Codex 独立验收、项目用户批准生产发布。

---

## 1. 目标与验收口径

E2 的工程验收（交接 §E2.6）：真实 SHA 镜像在 staging 部署、自动备份可恢复、迁移前后验证可重复、坏版本失败时能停止并按兼容条件回滚、发布记录可复查。六个工作包沿用交接定义：

| 包 | 范围 |
|---|---|
| E2.1 | 建立 `deploy/staging/` 与本机真实镜像基线 |
| E2.2 | SHA 部署与失败停止 |
| E2.3 | 自动备份及独立恢复 |
| E2.4 | 迁移前后验证 |
| E2.5 | 回滚与恢复演练 |
| E2.6 | 发布记录与关闭条件 |

口径约定：

- **本机验证与远程 staging 验证分开记录。** 交接时未提供远程 staging 主机、域名、registry 凭据或外部服务测试配置；本计划先在本机隔离 Compose 完成实现与演练，远程项逐条列入第 9 节待办，不宣称已通过。
- **证据优先于结论。** 每个场景记录命令、UTC 时间、退出码与日志位置；失败场景必须真实触发，不用注释或模拟输出代替。
- **生产权限不变。** DSH 的写入范围限于工作区和经授权的非生产目标；生产 workflow、生产 Compose、生产容器/卷、凭据、云端设置不在写入范围。

---

## 2. 实际基线（2026-11-10 16:49 盘点，已验证）

### 2.1 仓库

接手核对已完成：根目录、`CMS_and_WMS/` 与应用 `flower-wms-system/AGENTS.md` 已读；按 `CMS_and_WMS/AGENTS.md` 的发布类路由核对了技术设计来源、[已知缺口](../knowledge/06-Lessons/E0-known-gaps.md)、ADR、Runbook、迁移与回滚计划；`git status`/`log` 与实际基线如下。

- 仓库 `CMS_and_WMS`，分支 `dev`，HEAD `9112ed3`（Sprint E1 Done），`dev...main/dev [ahead 4]`。
- 工作区已有差异：`M .obsidian/workspace.json`（保留不动）、`?? docs/sprint-e2-dsh-handoff.md`（本次交接输入，保留为未跟踪文件）、`?? docs/sprint-e2-plan.md`（本文件）。
- E1 交付已提交在 `9112ed3`；`deploy/rehearsal/`、发布手册、PR 门禁、知识门禁与 E1 证据均存在。
- 无 git tag；无 `deploy/staging/` 目录。

### 2.2 环境

- Docker 29.9.2，Compose v5.6.1；本机镜像：`flower-e05-verification:final`、`postgres:18-alpine`、`postgres:alpine`、`node:22-alpine`。
- 本地开发容器 `flower-v2-pg`（postgres:18-alpine，Up）发布在 `127.0.0.1:55432 -> 5432`。**全程不停止、不重建、不写该容器与其数据。**
- 原生 Windows 服务 `postgresql-x64-18` 正在运行并监听 5432（`Test-NetConnection 127.0.0.1:5432` 为 True）。这是**另一个不得触碰的实例**；任何未显式指定端口/容器的 `psql`/`createdb` 都可能落到它。
- 宿主端口 `18080/18081/15432/15433/18082/15434/8080/3000` 空闲；`5432`（原生 PG）与 `55432`（`flower-v2-pg`）已占用。
- Node v24.14.0、npm 11.11.1。
- 磁盘：Docker 数据位于 `C:\Users\Lorem\AppData\Local\Docker\wsl\disk\docker_data.vhdx`（约 15.5 GiB）；**C: 仅剩约 19.4 GiB**，`docker system df` 显示 Build Cache 10.13 GiB（其中 4.09 GiB 可回收）；D: 剩余 144 GiB 与 Docker 构建无关。真实构建（多阶段 + Next build）可能写满 C:，预检必须记录 C:/vhdx 余量，构建前只做定向 `docker builder prune`，并把 ENOSPC 与 npm/构建失败分开归因。

### 2.3 迁移与镜像可复现性

- V1 迁移 45 个；V2 迁移 8 个（`0001`～`0008`）。
- HEAD `9112ed3` 与父提交 `99daac6` 都含 8 个 V2 迁移；更早的 `1c71923` 含 7 个 V2 迁移，且该提交的 `Dockerfile`/`.dockerignore`/`docker-entrypoint.sh` 与 HEAD 逐字节相同、`package.json`/锁文件自洽。因此**没有现成的“上一版真实镜像”**；E2.4 的增量升级基线有两个候选：用 `1c71923` 现场构建上一版镜像（首选，来源真实），或使用预构建 `flower-e05-verification:final`（E0.5 镜像，7 个迁移，构建于 2026-11-09、源提交未记录，来源边界需注明）。
- `npm ci` 使用的锁文件中 627 个 `resolved` 指向 `registry.npmmirror.com`，112 个指向 `registry.npmjs.org`；容器内构建没有 `replace-registry-host` 配置。当前探测 npmmirror 的 vitest 元数据与 tarball 均返回 200（E1 曾返回 500），**真实构建是否成功必须在 E2.1 首步实测**。
- Dockerfile 的构建上下文是 **`CMS_and_WMS` 仓库根目录**（见 [Dockerfile](../Dockerfile)；文件头注释仍写“monorepo 根目录（42_flower_management/）”，与当前布局不一致，记录为文档偏差）。构建命令必须在 `CMS_and_WMS` 下执行，否则 `COPY flower-wms-system/...` 失败。依赖阶段 `npm ci`、构建阶段 `npx prisma generate && npm run db:v2:generate && npm run build`，运行镜像含 `docker-entrypoint.sh`、prisma、V1/V2 迁移与 cron 脚本。
- 本机构建产生的镜像只有 image ID 与本地 `RepoDigests`（无 registry manifest digest）；**image ID/config digest 与推送后的 registry digest 是不同标识**，证据中分别记录，远程 staging 使用并记录 registry digest 与源码 SHA 的对照。

### 2.4 现状事实

- 生产 `master` push 触发的 [deploy.yml](../.github/workflows/deploy.yml) 与生产 [Compose 示例](../docker-compose.example.yml) 保持原样，本计划不修改。
- 生产 Compose 的 db 卷 `/var/lib/postgresql/data` 与 `postgres:alpine`（PG18.6，`PGDATA=/var/lib/postgresql/18/docker`）不匹配，是交接与 Runbook 的已知高优待决项，由维护者处理。
- E1.8 演练使用模拟 SHA + 预构建镜像；E2 必须补齐真实构建、真实 SHA 部署与可复查发布记录。

---

## 3. 范围、边界与写入所有权

### 3.1 本 Sprint 新建（主要写入范围）

```text
CMS_and_WMS/
├── deploy/staging/                     # 新目录，E2.1–E2.5 的主要交付物
│   ├── README.md                       # staging 操作说明（含远程接入待办与 Linux 命令等价片段）
│   ├── .gitignore                      # 忽略 .runtime/
│   ├── compose/docker-compose.staging.yml  # 一份 compose，按 -p/环境文件切换项目
│   ├── env/staging.env.example
│   ├── db/init/10-create-v2-database.sh    # 按环境变量创建 V2 库（空数据卷首次启动）
│   ├── db/checks/*.sql                 # 只读核对 SQL（迁移历史、行数、不变量）
│   ├── images/                         # 受控测试镜像模板（坏镜像/坏迁移），仅在证据需要时使用
│   └── scripts/*.ps1                   # 见各包；命名遵循 PowerShell 批准动词
├── docs/
│   ├── sprint-e2-plan.md               # 本文件
│   ├── sprint-e2-open-decisions.md     # 待决清单（E2.3/E2.6 汇总，模板化）
│   ├── sprint-e2-release-record.md     # 发布记录模板 + 本机演练记录（E2.6）
│   ├── sprint-e2-evidence.md           # 交付简报（文件名对齐 E1 的 sprint-e1-*-evidence.md）
│   └── evidence/sprint-e2/
│       ├── logs/                       # e2x-<场景>-<run_id>.log
│       └── releases/                   # 每次发布记录（脱敏）
```

### 3.2 可能修改的既有文件（须逐项说明理由）

| 文件 | 允许的修改 | 条件 |
|---|---|---|
| [发布手册](flower-studio-2.0-release-runbook.md) | 在文末**新增** E2 本机验证小节并标注 §12/13 相关项状态；**不改写 §13 的 E1.8 历史结论** | E2.6，改动需在简报中列为知识更新提案 |
| [deploy/rehearsal/README.md](../deploy/rehearsal/README.md) | 仅当 staging 复用方式需要交叉引用时加一行指针 | 可选，最小改动 |

其余既有文件（`Dockerfile`、`docker-compose.yml`、`docker-compose.example.yml`、`.github/workflows/*`、应用源码、`package.json`/锁文件、`knowledge/**`、迁移历史）**默认不修改**。若证据指向构建或部署配置缺陷（例如容器内 npm registry 不可用），先记录失败证据，再按第 11 节提交“范围变更提案”，经用户确认后实施。

### 3.3 不触碰清单

- 生产容器（`flower-web-prod`、`flower-cron-worker-prod`、`flower-postgres-prod`、`flower-nginx-edge`）及其卷/网络/数据；生产 `/root/flower-platform/`。
- 本地开发容器 `flower-v2-pg`（`127.0.0.1:55432`，库 `flower_v2_test`）及其数据；其库名以容器实际 env 核对（已核对）。
- 原生 Windows PostgreSQL 18 服务 `postgresql-x64-18`（`127.0.0.1:5432`）及其数据库。
- E1 证据日志原文（只新增 E2 证据；如引用 E1 日志只用链接）。
- `.obsidian/workspace.json` 与交接文档的既有未跟踪状态。
- Windows 系统级调度/服务配置默认不改写（见 §4.3 定时入口边界）。

### 3.4 提交策略

默认**不提交、不推送**，与 E1 执行期一致；E2 结束时由用户决定是否按工作包提交到 `dev`。各包简报记录文件清单，便于拆分提交。

---

## 4. 工作包分解

每个包固定输出：实现 + 自测证据 + 简报段落。验收项按“本机可验证 / 需远程或维护者”分开标注。

### 4.1 E2.1 · 建立 staging 与真实镜像基线

**目标**：用当前提交构建真实镜像，在本机隔离 Compose 证明可启动、可验证，并固化 staging 资源与配置。

**交付物**

- `deploy/staging/compose/docker-compose.staging.yml`：一份 compose，用 `-p <project>` 与环境文件切换基线/验证项目；服务 `db`、`flower-web`、`flower-cron-worker`；容器名、网络、卷均由 `COMPOSE_PROJECT_NAME`/变量派生（默认 `flower-e2-staging`）；db 镜像 `postgres:18-alpine` 固定 digest（注释记录 digest 与解析出的 PG 版本），卷挂载 `/var/lib/postgresql`（PG18 正确路径），另挂载 `../.runtime/backup:/backup` 供备份写宿主；web/cron 使用本地镜像变量 `STAGING_IMAGE`（默认 `flower-e2-staging:<sha>`）并设 `pull_policy: never`；**cron 必须覆盖 entrypoint**（`npx tsx ... cron-inventory-daemon.ts`），不执行迁移，保持“web entrypoint 是唯一迁移执行者”。
- `deploy/staging/env/staging.env.example`：占位符模板（沿用 E1.8 演练 env 结构）；V1 `flower_e2_v1`、V2 `flower_e2_v2_test`（`_test` 后缀用于 V2 test seed）；`POSTGRES_DB`/`V2_DB_NAME` 与项目对应；外部服务（OSS/微信/DeepSeek）留空或测试配置；凭据只进 `.runtime/`（gitignore），不写日志。
- `deploy/staging/db/init/10-create-v2-database.sh`：按 `V2_DB_NAME` 在空数据卷首次启动时创建 V2 库（脚本 `set -e`、库名白名单校验），避免把库名写死进 SQL。
- `deploy/staging/scripts/Staging.Common.ps1`：证据日志、compose 包装（强制 `-f <staging compose 绝对路径> -p <project>`）、健康/冒烟/行数、镜像清单等公共函数（参照 `deploy/rehearsal/scripts/Rehearsal.Common.ps1`，不修改原文件）。
- `deploy/staging/scripts/Invoke-Staging.ps1`：`build`、`up`、`verify`、`persistence`、`cleanup` 子步骤，可分段复跑；构建成功后写 `.runtime/images.json`（源码 SHA → 本地 image ID/RepoDigest/构建 run_id/架构/时间），供后续包与部署入口校验。
- `deploy/staging/README.md`：前置条件、隔离资源表、用法、本机与远程边界、Linux 命令等价片段（远程 staging 复用）。

**实施要点**

1. 预检并记录：git 基线、Docker/Compose、C: 与 docker_data.vhdx 余量、构建缓存占用、端口占用（含 5432 原生 PG 与 55432 开发容器）、已有容器/镜像快照、`deploy/staging` 不存在；构建前只做定向 `docker builder prune`（如需），不做全局清理。
2. 真实构建（工作目录必须是 `CMS_and_WMS` 仓库根）：
   ```text
   cd CMS_and_WMS
   docker build --progress=plain --platform linux/amd64 \
     --build-arg NEXT_PUBLIC_API_URL=http://127.0.0.1:18081 \
     --build-arg NEXT_PUBLIC_ASSET_BASE_URL=http://127.0.0.1:18081 \
     -t flower-e2-staging:<12位sha> .
   ```
   记录源码 SHA、完整命令、`docker image inspect`（ID、架构、大小）、本地 RepoDigest；日志归档 `e21-build-<sha>-<run_id>.log` 并写入 `images.json`。失败时保留完整日志、定位失败阶段（deps/npm registry/generate/build/ENOSPC），单列阻塞。**降级路径**：(a) 先区分网络与配置归因，必要时重试一次；(b) 若证据指向构建配置，按第 11 节提案（例如构建期 registry 重写）后重试；(c) 若仍失败，用预构建镜像完成 staging 机制演练并把“真实镜像构建”标为阻塞，E2 不得宣称真实 SHA 镜像通过。
3. 启动隔离栈（基线项目 `flower-e2-staging`；web `127.0.0.1:18081`、db `127.0.0.1:15433`；与 E1 演练、原生 5432、开发 55432 区分）。启动前先校验部署目标：compose 文件绝对路径、项目名、环境文件路径、端口、V1/V2 库名均在 staging 白名单内，拒绝指向生产 compose/容器、`flower-v2-pg` 或原生 PG。
4. 起 db 后、起 web 前做目标连通预检：用 `docker compose run --rm --no-deps --entrypoint sh flower-web -ec 'node scripts/check-v2-database-target.mjs --connect'`（**必须带 `--entrypoint sh`**，否则会先执行 entrypoint 迁移）。
5. 验证并记录：
   - entrypoint 应用 V1 45 / V2 8 个迁移；`prisma migrate status` 与 `db:v2:migrate:status` 均为 up to date（注意 `migrate status` 在有 pending 时退出码为 1，需与“失败”区分）；
   - `/api/health` 200 `{"status":"ok"}`；
   - 冒烟口径对齐 Runbook §7.2（本机可覆盖部分）：`/login` 200；`/v2` 307 且跳转 `/login?callbackUrl=/v2`；用合成测试账号登录后 `/v2` 工作台渲染 200；`/v2/inventory`、`/v2/orders`、`/v2/catalog` 只读页面 200；上传限制/413 依赖 nginx，staging 不含 nginx，列入远程待办；
   - 用**合成数据**填充 staging 基线：V2 test seed（`minimum,roles` tier）在宿主以 `NODE_ENV=test`、经 `127.0.0.1:15433` 写入 `flower_e2_v2_test`（seed 要求非 production、localhost 与 `_test` 后缀）；登录与 V2 入口冒烟使用合成测试账号（admin 等，密码按测试约定），不使用生产初始化账号，不写真实业务数据；关键表行数作为后续迁移/备份/恢复的基线；
   - 若需验证生产初始化路径（`db:v2:init:production`），在**单独的隔离库**执行并单列结果，不混入 staging 基线；
   - cron 出现 `started` 与至少一轮成功日志（容忍启动瞬时 P2021/P2022）；
   - 隔离资源清单（容器/网络/卷/端口/库名）与“未触碰 `flower-v2-pg`/原生 PG”核对。
6. 持久化试验：写入合成标记数据后**只重建 db 容器**（`docker compose -p ... up -d --force-recreate db`，卷保留），确认数据与迁移历史保留；重建会换容器 IP，需重启 web/cron 后再断言健康。
7. 清理：`docker compose -p flower-e2-staging down -v` 只作用于本项目；删除本次构建镜像前先确认 `images.json` 与证据已归档；清理后资源残留为 0。
8. 远程 staging 待办：主机/SSH、域名/TLS、registry 仓库与凭据、ACR 登录、secrets 注入、外部服务测试配置、staging 域名冒烟、上传限制/413、真实 registry push/pull、registry digest 与源码 SHA 对照（记录在 `deploy/staging/README.md` 的对照表 + `images.json`）。

**验收**

- 本机：真实镜像 image ID/架构/SHA 可复查（区分 ID 与 digest）；双库迁移、健康、登录与 V2 入口/工作台冒烟、cron 状态、隔离清单、持久化证据齐全。
- 远程：真实 registry push/pull 与 staging 执行证据（未提供资源前标为待办）。

**依赖/风险**：依赖 Docker 与网络；主要风险是容器内 `npm ci` 因 npmmirror 失败与 C: 磁盘不足（见第 10 节）。

---

### 4.2 E2.2 · SHA 部署与失败停止

**目标**：在 `deploy/staging/` 提供显式接收目标 SHA/digest 的部署入口，串行化发布，失败在替换/继续前停止。

**交付物**

- `deploy/staging/scripts/Deploy-Staging.ps1`：参数 `-TargetSha`（或 `-TargetImage`/digest）、`-PreviousImage`（回滚候选，可选记录）、`-SkipSmoke`（仅诊断用）、`-DryRun`（只做预检）。**迁移执行者决策**：保留 web entrypoint 作为唯一迁移执行者（与生产路径一致），部署入口只做迁移前待应用清单核对、迁移后状态/数据核对，不再额外执行 `prisma migrate deploy`，从机制上避免“独立迁移 + entrypoint”重复执行。固定流程：
  1. **串行化**：项目级锁文件 + 运行中标记；并发调用直接拒绝（非零退出并提示持锁信息）；提供 `-ForceUnlock`（记录解锁原因与旧锁内容）处理崩溃残留。
  2. **记录现状**：web/cron 实际镜像 ID/digest、`docker compose ps`、V1/V2 迁移状态、当前服务器 UTC 时间、回滚候选。
  3. **解析目标**：本地 inspect 或 `docker pull`；校验镜像存在、`linux/amd64`、含 entrypoint 与迁移目录；不存在/架构不符即退出，**不停止现有 stack**。
  4. **预检**（全部通过才进入替换；所有容器内命令必须 `--entrypoint sh`，避免 entrypoint 提前迁移）：
     - compose 文件绝对路径 + `-p` 项目校验，确认不是生产 compose；
     - V1/V2 库名不同（`check-v2-database-target.mjs --connect` 真实连库）；
     - **预期待应用清单定义**：从目标镜像的 `prisma/v2/migrations` 与实际 `_prisma_migrations` 已应用集合求差，得到 pending 集合；与操作者用 `-ExpectedPending` 声明的清单（默认取该差值）比对，不一致按“非预期历史”停止（退出码 3）；V1 同理；
     - `prisma migrate status` 在存在计划内 pending 时退出码为 1，预检必须允许 0/1 并按“计划内 pending=本次发布待应用迁移”判定，其他输出判为异常；
     - `docker compose config` 的输出可能含密码，**不得写入证据日志**（如需保存只保留服务名/镜像/端口等脱敏字段）；
     - 磁盘与 C:/docker_data.vhdx 余量。
  5. **迁移前备份**：调用 E2.3 `Backup-Staging.ps1 -Label predeploy`，备份失败即停止（S5）。
  6. **替换应用**：只 stop/rm web+cron，db 容器不动；启动 web（entrypoint 是唯一迁移执行者；部署入口不再单独跑 migrate，避免重复迁移）；90 秒内等待 health（E1.8 空库 52 迁移实测约 25.6 秒，90 秒为下限，必要时可放宽到 180 秒并记录）；**迁移完成判定由 E2.4 的 `Test-StagingMigration.ps1 -Mode post` 执行**：退出码 `2`=连通/目标错误、`3`=非预期历史、`4`=迁移失败、`5`=迁移后核对失败，任一非零都停止并映射到失败类型；web 不健康时先分类“迁移失败 / 启动失败 / 健康失败”。
  7. **启动 cron 并确认轮次**：只有 web 健康且迁移完成后才启动 cron；记录 web/cron 实际镜像与预期一致；等待至少一轮成功 cron 日志（容忍启动瞬时错误，连续失败按停止条件处理）。
  8. **成功判定**：健康 + 业务冒烟（`/login`、`/v2` 重定向、核心页面只读冒烟）+ cron 成功轮次同时满足；写发布记录字段（E2.6 模板）并退出 0。
  9. **失败判定**：任一步失败 → 不启动后续步骤、不反复 `up` 覆盖现场；保留新容器日志、旧镜像仍可拉取/本地存在；退出非零并在简报中给出诊断路径。迁移失败按 S6：不回滚数据库，等待前滚修复或审批后的备份恢复（E2.5）。
- `deploy/staging/scripts/Invoke-DeployFailureTests.ps1`：覆盖
  - **镜像目标错误**：不存在的 SHA/tag、不可拉取镜像 → 解析阶段退出，未停止现有 stack；
  - **数据库目标错误**：临时 env 使 V1/V2 指向同名库、不可达地址或原生 PG（5432）→ `--connect` 预检失败，未停止现有 stack；证据须区分“镜像目标失败”与“数据库目标失败”；
  - 迁移失败：受控失败镜像（从真实镜像派生，注入一个注定失败的 V2 迁移；仅作本地测试 fixture，不改仓库迁移历史）→ 部署停止、web 未继续、状态可定位；失败会在 `_prisma_migrations` 留 failed 行，清理方式为在一次性测试库执行 `prisma migrate resolve --rolled-back <migration>` 或丢弃整库，**不得在 staging 基线库上操作**；
  - 坏镜像健康失败：删除 `server.js` 的受控镜像 → health 超时停止、不启动 cron、旧镜像保留；
  - 同一版本重试安全：连续两次部署同一 SHA → 迁移不重复、数据与健康不变；
  - cron 早于迁移完成的风险：用容器启动时间与日志顺序证明 web 健康后才启动 cron（与生产 deploy.yml 的并行启动差异单列）。
- `deploy/staging/workflow-proposal.md`：独立的 staging workflow **提案**（`workflow_dispatch` 手动触发、输入 SHA、ACR 仓库、目标主机、最小权限 `contents: read` + 环境 secrets、禁止 push 自动部署、失败停止与记录要求）。**本 Sprint 只交付提案，不写 `.github/workflows/`，需用户批准后另立工作包。**

**验收**：显式 SHA/镜像→部署成功且 web/cron 实际镜像与预期一致；预检失败不替换应用（镜像目标与数据库目标失败分别有证据）；迁移失败/坏镜像健康失败均停止且保留诊断；同版本重试安全；发布记录字段完整；远程工作流仅提案。

**依赖**：E2.1 的真实镜像与 staging 栈；E2.3 备份入口（接口先约定 `-Label predeploy` 与退出码语义，可并行实现）；E2.4 的 `Test-StagingMigration.ps1 -Mode preflight|post` 接口与退出码 2–5（E2.2 依赖其判定，E2.4 依赖 E2.2 的部署控制，二者按接口契约并行、集成时联调）。

---

### 4.3 E2.3 · 自动备份及独立恢复

**目标**：显式目标的分库备份、校验、保留、非生产定时入口，以及只允许新建隔离目标的恢复入口。

**交付物**

- `deploy/staging/scripts/Backup-Staging.ps1`
  - 参数显式指定本项目 compose/项目名与数据库（V1 `flower_e2_v1`、V2 `flower_e2_v2_test`，未来可扩展其他发布依赖库），分库归档，不合并；不接受任意连接串，只通过项目内 db 容器执行。
  - 用 db 容器内 `pg_dump -Fc`（版本与数据源一致），输出到容器 `/backup`（compose 绑定到宿主 `.runtime/backup/<UTC>-<label>/`）；记录：源 `server_version`、UTC 时间、库标识（`current_database()`）、归档大小、sha256、退出码、成功状态（JSON manifest）。
  - **候选门槛**：导出成功 + `pg_restore --list` 结构可读 + sha256 匹配 + 非空，才登记为恢复候选；失败产物移入 `failed/` 隔离并保留脱敏诊断，返回非零；完整恢复验证作为独立演练定期执行（不在每次备份中做，避免把恢复耗时混入备份耗时）。
  - 保留策略：默认保留最近 N 组（N 可参数化，默认 5）成功备份；只在新备份通过校验后清理超期备份，失败不删除上一份有效备份。
- `deploy/staging/scripts/Restore-Staging.ps1`
  - 只允许本次新建的隔离目标：目标名必须匹配 `flower_e2_restore_<run_id>` 形式，先查 `pg_database` 确认不存在，再由本脚本**新建空库**（明确“建库责任人=恢复入口”）后再 `pg_restore -d`；显式 `-ConfirmNewTarget`；校验连接身份（当前角色/`current_database()`）；脚本只通过项目 compose 的 db 容器执行，拒绝任意连接串与任意端口。
  - denylist：生产库（`flower_hub_prod`、`flower_v2_prod` 等）、staging 基线/验证库（`flower_e2_*` 非 restore 前缀）、开发实例 `flower-v2-pg`（`127.0.0.1:55432`，库 `flower_v2_test`）、原生 PG 实例（`127.0.0.1:5432`）的库；恢复目标不得与任何既有库同名。
  - 恢复到新库后核对：迁移历史（`_prisma_migrations`）、关键表行数、代表性业务不变量（如订单-预留-库存关系、订单金额）、备份与恢复耗时、实际恢复点（备份时间戳）。
  - 清理只限本次创建的库/资源；失败时保留现场但确保上一份有效备份未被破坏。
- `deploy/staging/scripts/Start-StagingBackupLoop.ps1`：非生产定时入口，`-Once` 与 `-IntervalMinutes` 模式；证据用 `-Once`/短间隔手动运行采集。**默认不注册系统级任务**；`deploy/staging/README.md` 给出 Windows 任务计划的注册/注销说明（须“仅用户登录时运行”，因为 Docker Desktop 引擎在用户会话；注册系统任务属于工作区外变更，需用户明确同意后执行）。
- `deploy/staging/scripts/Invoke-BackupRestoreTests.ps1`：场景
  - 定时触发：用 1 分钟间隔跑 2 个周期，期间写入合成数据，验证两份备份与候选登记；
  - 迁移前备份：配合 E2.2 的 `-Label predeploy`；
  - 保留：超过 N 组后只清理最旧的成功备份；
  - 恢复：恢复到新库并核对迁移历史/行数/不变量、记录备份与恢复耗时与实际恢复点；
  - 失败：坏归档（截断副本）、目标冲突（已存在库）、恢复中途失败 → 非零退出、隔离/保留有效备份、上一份有效备份仍可恢复；
  - 创建的资源在测试结束删除，并核对无残留库。
- `docs/sprint-e2-open-decisions.md`：生产备份周期、异地目标、加密、保留期限、恢复责任人、RPO/RTO、OSS 与数据库一致性、停写窗口等（ADR-002 仍待定），附本机演练耗时；另列 Runbook 13.3 未验证项（生产规模数据量下的备份/恢复耗时、恢复后业务对账、OSS 一致性）供批准参考。

**验收**：备份可校验、分库、带源信息与校验值；坏备份被隔离且不顶替有效备份；恢复只进新建隔离目标并完成历史/行数/不变量核对；定时入口有真实两轮证据；报告对凭据脱敏。

**依赖**：E2.1 的 staging 栈与库；E2.2 部署入口在迁移前调用（接口约定）。

---

### 4.4 E2.4 · 迁移前后验证

**目标**：在实际镜像上验证空库迁移与已知旧 schema 增量升级，迁移前后核对可重复，失败可分类并阻止后续上线。

**交付物**

- `deploy/staging/db/checks/`：只读 SQL（迁移历史 applied/unfinished、V1/V2 状态、V2 关键表行数、代表性不变量；参照 `deploy/rehearsal/db/checks/`）。
- `deploy/staging/scripts/Test-StagingMigration.ps1`：`-Mode preflight|empty|incremental|post`，输出可机器判定的退出码：
  - `2`：连通性/目标错误（不是“计划内 pending”）；
  - `3`：非预期迁移历史（数据库超前/落后、`_prisma_migrations` 异常）；
  - `4`：迁移执行失败；
  - `5`：迁移后核对失败（schema/行数/不变量不符）。
  每次记录：V1/V2 已应用与待应用清单、代表性数据基线、可恢复备份标识（E2.3）与时间点；明确区分计划内 pending 与异常。**“预期待应用清单”定义**：目标镜像 `prisma/v2/migrations`（V1 对应目录）文件集合减去数据库 `_prisma_migrations` 已成功应用的集合；与 `-ExpectedPending` 声明比对，不一致即退出码 3。
- **场景隔离**：空库与增量场景使用独立验证项目 `flower-e2-verify`（web `127.0.0.1:18082`、db `15434`），数据库对 `flower_e2_empty_v1/v2` 与 `flower_e2_incr_v1/v2` 分别使用；**不得在 E2.1/E2.2 的 staging 基线库上做增量起点**，因为基线库首启即到 8 个迁移，旧镜像在其上不会执行 7→8（Prisma 容忍未知的已应用迁移，E1.8 已实测）。
- **空库场景**：在 `flower-e2-verify` 项目中新建孤立 V1/V2 库，用真实镜像启动 web → V1 45 / V2 8 迁移全部应用；`db:v2:migrate:check` 输出 `No difference detected.`；一致性约束与关键表存在；生产初始化后行数/默认数据核对。
- **增量场景**（上一版镜像来源优先级）：
  1. 首选：在仓库外或 `deploy/staging/.runtime/worktrees/`（gitignore）建临时 git worktree 检出 `1c71923`（7 个 V2 迁移），用该提交源码构建 `flower-e2-prev:1c71923`（记录 SHA/镜像 ID/构建日志）；worktree 不进入构建上下文、不污染 `git status`；
  2. 回退：使用预构建 `flower-e05-verification:final`（7 个迁移，构建于 2026-11-09、源提交未记录），在证据中注明该证据边界。
  流程：在 `flower_e2_incr_*` 空库上用**上一版镜像**启动 → 确认 V2 迁移数为 7 → 记录迁移历史与行数 → 用合成数据构造代表性业务数据（订单/预留/库存/采购）→ 迁移前备份 → 新镜像部署（复用 E2.2 入口）→ 核对 V2 7→8、历史/行数不变、约束与不变量、旧镜像兼容性证据；记录迁移前后耗时。
- **失败注入**：
  - 迁移失败（受控失败迁移镜像）→ 退出码 4，部署停止，数据库保留现场；失败会在 `_prisma_migrations` 留 failed 行，测试后在一次性库用 `prisma migrate resolve --rolled-back` 或整库销毁；
  - 非预期历史（在一次性隔离库人为制造超前/落后状态，如删除一条历史记录或伪造已完成记录）→ 退出码 3，部署停止；
    - 该类改动**只在一次性隔离库**执行并在测试后销毁，绝不在 staging 基线库或任何承载真实迁移历史的库上修改 `_prisma_migrations`；`migrate reset`/`db push`/手工改历史继续禁用；
  - 迁移后核对失败（隔离库临时改坏一条核对不变量或制造 schema 差异）→ 退出码 5，禁止继续冒烟/上线；
  - 重跑分类：重跑前辨认“迁移未执行 / 迁移执行失败 / 已应用但验证失败”，并在日志中给出结论。

**验收**：空库与增量升级均有真实镜像证据；迁移前后状态与行数可复查；三类失败被区分并阻止后续步骤；证据边界（上一版镜像来源）明确。

**依赖**：E2.1 镜像与栈、E2.2 部署迁移控制、E2.3 备份标识。

---

### 4.5 E2.5 · 回滚与恢复演练

**目标**：半自动回滚入口 + 兼容性前提；演练坏版本停止与不兼容时的停止条件。

**交付物**

- `deploy/staging/scripts/Invoke-StagingRollback.ps1`
  - 输入：`-PreviousImage`（必填）、`-CompatibilityEvidence`（迁移类型判定与依据，必填）；不满足兼容前提时**拒绝自动回滚**，只输出选项。
  - 流程：记录当前镜像 digest 与迁移状态（**断言 pending=0**，否则旧镜像启动时可能真的执行迁移）→ stop web/cron → 用同一上一版镜像启动 web 与 cron → 等健康 → 核心冒烟 → 记录回滚前后镜像 digest、schema 兼容证据、健康结果、冒烟结果、耗时；**数据库保持前滚**，迁移历史不得修改。schema 已前进且旧镜像不应再次执行迁移时，按 Runbook 5.2 评估 `SKIP_DB_MIGRATE=true`，并在发布记录中写明取值与依据。
- `deploy/staging/scripts/Invoke-StagingRollbackDrills.ps1`：场景
  1. 坏镜像/健康失败 → 回滚上一版镜像，web/cron 镜像一致、health 200、冒烟通过、恢复耗时记录；E1.8 已测得 10.9 秒内健康恢复，可作对照值；
  2. 不兼容演练：受控 schema 变更**只作用于从 E2.3 备份恢复出的副本库**（主 staging V2 库保持完好，演练后删除副本/核对恢复库）；例如重命名/删除旧镜像读取的列或收紧约束 → 旧镜像启动或冒烟失败 → 触发停止条件：保留现场与写入记录，不回滚数据库，给出“前滚修复”与“经批准的备份恢复”两个选项及判断依据；
  3. 隔离恢复验证：从 E2.3 备份恢复到新库，验证受影响数据与停写边界，**数据库恢复与镜像回滚分别记录**（恢复后切换连接属于独立审批步骤）；
  4. 回滚后迁移历史与数据一致性核对；记录回滚耗时。
- `deploy/staging/README.md` 增加回滚章节（兼容前提、停止条件、审批要求）。
- **自动回滚提案（本期不实现）**：仅当迁移类型可证明向后兼容（加列/加表/加索引/加枚举值）且健康失败可稳定判定时，才考虑在健康失败后自动回滚上一版镜像；必须先有半自动演练证据，并在 `workflow-proposal.md` 中单列条件与审批开关。

**验收**：上一版镜像恢复 web+cron、数据库前滚、健康/冒烟/耗时齐全；不兼容场景能停止并保留现场；DB 恢复与镜像回滚分开记录；不宣称未验证的自动回滚。

**依赖**：E2.2–E2.4 的部署入口、迁移控制与证据。

---

### 4.6 E2.6 · 发布记录与关闭条件

**目标**：模板化发布记录、脱敏证据、staging 操作说明、E1 门禁复跑与 Codex 移交。

**交付物**

- `docs/sprint-e2-release-record.md`：沿用手册第 14 节模板，补 E2 字段：目标环境、源码 SHA、实际镜像 digest、上一版镜像、审批/执行人/复核人、发布窗口（计划/实际）、迁移与备份标识、备份异地副本、校验结果、故障单编号与故障决策、恢复时间、资源清理结果；先放模板，再按本机演练逐次填写（`docs/evidence/sprint-e2/releases/rel-<utc>.md`）。
- `deploy/staging/README.md` 补 staging 操作说明（本机/远程差异、按 SHA 部署、备份恢复、回滚、清理；远程 Linux 命令等价片段）。
- 发布手册更新提案：在文末新增 E2 小节，并标注 §12/13 相关待决项状态（例如本机验证结论、镜像构建可复现性、回滚兼容证据）；**不改写 §13 的 E1.8 历史结论**，以“提案”标注交 Codex 复核。
- `docs/sprint-e2-evidence.md`：逐包简报（开始基线、文件与变更摘要、执行命令与退出码、通过/失败/跳过、证据位置、残留风险、知识修订建议、待决项、**实现与已批准知识/规格/ADR 的偏差及对应 ID**），结构对齐 E1 证据文档。
- **持续维护**：E2.6 不是只在批 6 做——每个工作包完成时即回填发布记录模板与简报段落（延续交接“E2.6 随前面工作维护”的要求），批 6 只做汇总、门禁复跑与移交。
- **E1 门禁复跑**（改动后必跑，证据到 `docs/evidence/sprint-e2/logs/e26-*`）：
  - `node scripts/check-knowledge-structure.mjs` 与 `node --test scripts/check-knowledge-structure.test.mjs`；
  - `npx next typegen` + `npx tsc --noEmit`；
  - `npm run lint`；
  - `npm run test:unit`；
  - `npm run build`（占位 env，与 CI 一致）；
  - 条件复跑：`npm run test:ci`、`npm run test:e2e`（E2 预期不改应用源码；若因证据需要或改动触及应用，则必须复跑）。
- 关闭核对表：交接 §E2.6 工程验收五项逐项对应证据；本机通过项注明“本机验证”，远程项单列负责人与待办；DSH 自测通过后交 Codex 按 ADR-005 独立复跑，生产放行由项目用户另行审批。
- **证据归档说明**：默认不提交/推送时，证据只存在于本机工作区；E2 结束时给出按包拆分提交的建议清单（代码/脚本、文档、证据日志），由用户决定是否提交，确保“可复查入口”在仓库中可用。

**验收**：发布记录可复查；证据脱敏；E1 门禁结果可复现；关闭条件与待决项一一对应。

---

## 5. 执行顺序、依赖与批次

```text
批次 0 预检（基线复核、环境/镜像/端口、构建可行性探测）
   │
批次 1 E2.1 真实镜像 + staging 骨架 + 启动/冒烟/持久化
   │
   ├──────────────┬─────────────────────┐
批次 2 E2.3 备份/恢复核心   批次 3 E2.2 部署入口（用 E2.3 备份钩子）
   │              │                     │
   └──────────────┴──────────┬──────────┘
                             │
批次 4 E2.4 迁移前后验证（空库/增量/失败注入）
                             │
批次 5 E2.5 回滚与恢复演练
                             │
批次 6 E2.6 记录 + E1 门禁复跑 + Codex 移交
```

- E2.2 与 E2.3 可按上述接口并行准备，但批 2 的备份入口需先稳定（部署在迁移前调用）。
- E2.4 依赖 E2.2 的迁移控制（含 `Test-StagingMigration.ps1` 退出码契约）与 E2.3 的备份标识；E2.5 依赖 E2.2～E2.4 的证据。
- E2.4 的空库/增量场景在独立验证项目 `flower-e2-verify` 中进行，不污染 staging 基线与 E2.2/E2.5 依赖的库。
- **E2.6 从批次 1 起持续维护**（模板、发布记录、简报随每包回填），批 6 只做汇总、门禁复跑与 Codex 移交。
- 每批次结束先跑该批自测并归档证据，再进入下一批；批次内失败不阻塞其他可独立推进项。
- 每批次结束先跑该批自测并归档证据，再进入下一批；批次内失败不阻塞其他可独立推进项（按交接“继续不受影响的工作”）。
- 预计规模：E2.1 与 E2.2 各约 4 个脚本/配置 + 1 次完整演练；E2.3/E2.4/E2.5 各约 2–3 个脚本 + 场景证据；E2.6 以文档与门禁复跑为主。每个批次作为独立 DSH 会话执行，避免上下文过长。

---

## 6. 资源与隔离规范

| 资源 | staging 本机值 | 隔离保证 |
|---|---|---|
| Compose 项目（基线） | `flower-e2-staging` | 所有容器/网络/卷带前缀；脚本强制 `-f deploy/staging/compose/docker-compose.staging.yml -p <project>` |
| 容器（基线） | `flower-e2-staging-db` / `-web` / `-cron`（名由项目派生） | 不与 `*-prod`、`flower-v2-pg` 冲突 |
| Compose 项目（验证） | `flower-e2-verify`（E2.4 空库/增量） | 与基线项目互斥，端口/卷独立 |
| 容器（验证） | `flower-e2-verify-db` / `-web` / `-cron` | 同上 |
| 网络 | `<project>_default` | 独立 bridge |
| 卷 | `<project>_postgres_data` / `<project>_next_cache` | `down -v` 只删本项目卷 |
| 宿主端口（基线） | web `127.0.0.1:18081`、db `127.0.0.1:15433` | 避开已占用端口（见下行） |
| 宿主端口（验证） | web `127.0.0.1:18082`、db `127.0.0.1:15434` | 同上 |
| 已占用端口 | `5432`=原生 Windows PG 18；`55432`=`flower-v2-pg`；3000/8080/18080/15432 见预检 | 任何脚本不得默认连接这些端口 |
| 数据库（基线） | V1 `flower_e2_v1`、V2 `flower_e2_v2_test`；恢复目标 `flower_e2_restore_<run_id>` | 库名固定且与所有既有库不同，脚本校验 |
| 数据库（验证） | `flower_e2_verify_v1`、`flower_e2_verify_v2_test`（空库/增量场景分别重建） | 只用于 E2.4 空库/增量，场景后重建 |
| 凭据 | 每次运行随机生成，写入 `deploy/staging/.runtime/`（gitignore） | 不含真实密钥、不写日志 |
| 镜像 | 本地 `flower-e2-staging:<sha>`（image ID + 本地 RepoDigest）；上一版 `flower-e2-prev:1c71923`（或预构建镜像）；推送后另记 registry digest | 显式 tag，记录 ID/digest 与来源 SHA；`images.json` 对照 |
| nginx 边缘 | 不包含 | 记录为 staging 与生产的已知差异；上传限制/413 列远程待办 |

**安全开关**：所有 staging 脚本启动前校验 compose 文件绝对路径、`-p` 项目名、环境文件路径与端口均在白名单；恢复与删除类命令只通过 `docker compose -p <project> exec/run` 执行，**不接受任意连接串/主机/端口**；恢复目标必须匹配 `flower_e2_restore_` 前缀且先确认不存在；denylist 覆盖生产库、staging 基线/验证库、`flower-v2-pg`（`127.0.0.1:55432`，库名以容器 env 核对）与原生 PG（`127.0.0.1:5432`）；删除类命令（`down -v`、`dropdb`、备份清理）执行前打印解析后的绝对目标并要求匹配白名单；不执行 `docker system prune -a --volumes`。

---

## 7. 证据与记录规范

- 目录：`docs/evidence/sprint-e2/logs/`；命名 `e2<包号>-<场景>-<run_id>.log`（`run_id` 为 `YYYYMMDD-HHMMSS`，与 E1 的 `e18-*` 风格一致）。
- 每个 run 另写一份 summary：场景结果、通过/失败/未覆盖、镜像 ID 与 SHA 对照、耗时、残留风险、清理结果。
- 证据只含命令、退出码、数量、相对路径与脱敏后的日志；不写连接串、密码、token、生产数据。
- 时间统一记录 UTC（日志内），简报可并列本地时间；与 E1.8 元数据格式对齐。
- 失败证据不覆盖：受控失败日志与正常路径日志分开命名，保留原始输出。

---

## 8. 门禁与关闭条件

### 8.1 每个工作包的完成定义（DoD）

1. 文件清单与写入范围符合第 3 节，未越界修改既有文件；
2. 正常路径 + 失败路径均真实执行，记录命令与退出码；
3. 证据归档、临时资源清理（或明确保留原因）；
4. 简报段落含残留风险、知识更新提案，以及**实现与已批准知识/规格/ADR 的偏差及对应 ID**（按 `CMS_and_WMS/AGENTS.md` 的“After work”要求）；
5. 适用时复跑受影响门禁（至少知识结构与脚本语法检查；涉及应用文件的改动触发 lint/typecheck/unit/build）。

### 8.2 E2 关闭（DSH 侧）

- E2.1–E2.5 本机验收项全部有证据；无法本机完成的项列入第 9 节并由用户/维护者确认负责人。
- E2.6 发布记录模板与本机演练记录完成；E1 门禁复跑全部通过（无新增失败）。
- DSH 自测结论标记“待独立验收”，交 Codex 按 ADR-005 独立复跑；生产发布另由项目用户审批。
- E1 遗留的分支保护与真实 CI 首跑由维护者关闭，其状态与负责人记录在简报待决项，不虚报为 E2 通过项。
- 关闭前确认：生产 Compose 的 PG 版本/卷、ADR-002 备份参数（RPO/RTO/保留/责任人）等 Runbook 阻塞项状态未变化，或在简报中明确仍为生产发布前置条件。

---

## 9. 待用户/维护者确认与提供

下表为执行前确认项（默认值按交接与仓库现状给出，推荐采用默认值）：

| # | 事项 | 默认/建议 | 影响 |
|---|---|---|---|
| 1 | 本次执行范围 | 仅本机 staging 完成 E2.1–E2.6；远程 staging 列为待办 | 决定验收口径；无远程资源时这是唯一可执行路径 |
| 2 | staging 资源命名/端口 | `flower-e2-staging`、18081/15433、V1/V2 库 `flower_e2_v1/v2` | 与 E1/开发环境隔离 |
| 3 | staging 是否含 nginx | 不含，记录差异 | 远程 staging 另行覆盖域名/TLS |
| 4 | 上一版镜像来源 | 优先用 `1c71923` 构建；失败回退 `flower-e05-verification:final` 并注明边界 | 决定 E2.4 增量证据强度 |
| 5 | 定时备份运行位置 | 默认**不注册**系统任务：脚本提供 `-Once`/loop 与注册说明，证据用手动运行采集；注册 Windows 任务计划需用户明确同意 | 避免越界修改系统状态 |
| 6 | 是否创建独立 staging workflow | 本期只交付提案，不写 `.github/workflows/` | 写 workflow 需触发条件/镜像库/目标主机/最小权限确认 |
| 7 | 是否提交/推送 git | 默认不提交不推送，E2 结束由用户决定 | 影响交付形态与“可复查入口” |
| 8 | 远程 staging 资源 | 需维护者提供：主机/SSH、域名与证书、registry 仓库与凭据、ACR 登录、secrets、外部服务测试配置、staging 备份目标 | 缺失项只能记录待办，不能宣称远程通过 |
| 9 | 生产发布前置 | 生产 PG 版本/卷确认、ADR-002 的 RPO/RTO/保留/恢复责任人、分支保护与真实 CI 首跑 | 不阻塞本机 E2，但阻塞生产放行 |
| 10 | 时间/里程碑 | 每批次一个执行会话；批次内失败先记录再继续可独立项 | 便于用户按批审阅 |
| 11 | 远程 staging 验收映射 | 每包验收项在证据中标注“本机已验证 / 待远程复跑”；远程失败不得回填为本机失败或反之 | 保证证据口径可追溯 |
| 12 | 真实 PR 门禁阻止合并（E1 遗留，维护者） | 维护者推送分支/PR、启用 required checks 并验证一次受控失败被阻止 | 不阻塞本机 E2，但属 E1 关闭与 E2 独立验收的外部前提 |
| 13 | 本机系统级变更（如注册计划任务、添加防火墙规则） | 默认不做；如确需，先说明目的/范围/注销方式并取得同意 | 工作区外写入需额外授权 |

---

## 10. 风险与缓解

| 风险 | 可能性/影响 | 缓解 |
|---|---|---|
| 真实镜像构建失败（容器内 `npm ci` 访问 npmmirror 500、依赖或 Prisma 生成失败、ENOSPC） | 中/高（E1 已遇 npmmirror 故障，当前探测已恢复 200；C: 仅余约 19.4 GiB） | E2.1 首步实测并归档完整日志；失败单列阻塞；按“网络/配置/磁盘”归因；仅在证据指向构建配置时提交 Dockerfile/registry 方案提案；最坏情况用预构建镜像完成机制演练并把真实构建标为阻塞 |
| 无远程 staging 资源，验收只能到本机 | 高/中 | 本机与远程分开记录；平台差异（registry、SSH、TLS、外部服务、上传限制）列入待办；远程 Linux 命令等价片段随 README 交付 |
| 注入测试污染仓库或真实数据 | 低/高 | 受控失败镜像/迁移只在隔离栈与一次性库；恢复与回滚演练限定新建库与白名单；不触碰 `flower-v2-pg`（55432）、原生 PG（5432）与生产；失败迁移只在一一次性库 `migrate resolve` 或整库销毁 |
| 误连原生 PG 或开发实例 | 中/高 | 脚本不接受任意连接串/端口；只经项目 compose 容器；denylist 覆盖两个实例；证据中不打印连接串 |
| 上一版镜像来源非真实发布产物 | 中/中 | 优先构建 `1c71923`；回退预构建镜像时在证据中明确边界，并由维护者在远程 staging 用真实上一版 digest 复跑 |
| 增量场景库位错误（在已到 8 迁移的库上跑旧镜像） | 中/高 | 独立 `flower-e2-verify` 项目与 `flower_e2_incr_*` 空库；先断言旧镜像应用 7 个迁移，再部署新镜像 |
| Windows 与 Linux 差异（路径/权限/时区/pg_dump 版本/PowerShell） | 中/中 | 备份恢复在容器内执行；PowerShell 统一路径处理；README 提供 bash 等价片段；记录 UTC |
| cron 与迁移竞争、失败后 cron 继续跑 | 中/中 | 部署顺序强制 web 健康+迁移完成后才启动 cron；失败先停 cron；记录启动时间与首轮成功日志 |
| 备份校验不足导致“假备份” | 中/高 | 候选门槛（导出+结构+sha256+非空）；坏归档/目标冲突演练；失败不清理旧有效备份；恢复耗时单独演练记录 |
| 回滚兼容性误判 | 中/高 | 半自动回滚要求执行者提供兼容证据；回滚前断言 pending=0；不兼容场景在恢复副本上停止；不自动回滚数据库 |
| Docker Desktop 写满 C: 影响运行中的开发容器 | 中/高 | 构建前记录 C:/vhdx 余量；定向 prune（不用全局 prune）；构建后记录增量；失败先归因 ENOSPC |
| 计划偏离实际（交接情况变化） | 中/中 | 每批次开始先复核基线；差异记录并以证据为准；范围变更按第 11 节 |

---

## 11. 变更控制与升级规则

- **证据优先**：任何超出第 3 节写入范围的修改（Dockerfile、compose、workflow、应用源码、package/锁文件、生产配置）都先记录失败证据，形成范围变更提案（问题、证据、最小修复、影响、回退方案），交用户确认。
- **系统级变更**：注册 Windows 计划任务/服务、修改宿主机网络或防火墙等属于工作区外变更，默认不做；确需时先说明目的、范围、回退/注销方式并取得用户同意。
- **规则冲突**：触及业务规则、数据模型、API 契约或 ADR 时，按 `CMS_and_WMS/AGENTS.md` 引用受影响 ID 并暂停该依赖项，继续不受影响工作。
- **生产相关待决项**：PG 版本/卷、RPO/RTO、备份异地、恢复责任人等由维护者/项目用户关闭；DSH 只提供演练数据与建议。
- **提交策略**：默认不提交不推送；按工作包拆分提交的方案在 E2.6 简报中给出，由用户决定。

---

## 12. 交付物清单

- 本计划 `docs/sprint-e2-plan.md`。
- `deploy/staging/`（compose/env/init/checks/scripts/images 模板/README，含 Linux 命令等价片段与远程接入待办）。
- `docs/evidence/sprint-e2/logs/`（各包场景日志与 summary，`e2x-<场景>-<run_id>.log`）。
- `docs/evidence/sprint-e2/releases/`（发布记录）。
- `docs/sprint-e2-release-record.md`、`docs/sprint-e2-open-decisions.md`、`docs/sprint-e2-evidence.md`。
- 发布手册 E2 小节更新提案（按 E2 证据，不改写 E1.8 历史结论）。
- 每包简报：基线、文件、命令与退出码、通过/失败/跳过、证据、残留风险、知识更新建议、与已批准知识的偏差。

---

## 13. 确认后首批执行清单（E2.1 批次 0–1）

1. 复核基线：`git -C CMS_and_WMS status --short --branch`、`git -C CMS_and_WMS log -5 --oneline`，记录并保留既有差异。
2. 记录环境快照：Docker/Compose 版本、镜像清单、端口占用（5432 原生 PG、55432 `flower-v2-pg`、空闲端口）、容器清单、C:/docker_data.vhdx 余量与构建缓存。
3. 创建 `deploy/staging/` 骨架、compose/env/init 与 `Staging.Common.ps1`。
4. 在 `CMS_and_WMS` 根执行真实镜像构建，归档命令、SHA、镜像 ID/架构/本地 RepoDigest 与完整日志，写 `images.json`；失败则按“网络/配置/磁盘”归因并记录阻塞，进入第 11 节提案或降级路径。
5. 起 db 后先做 `--entrypoint sh` + `--connect` 目标预检，再启动 web/cron；完成双库迁移、健康、登录/V2 入口/工作台冒烟、合成数据基线、cron 轮次、隔离清单与持久化验证。
6. 归档 `e21-*` 证据与 summary，更新发布记录模板与简报（E2.6 持续维护）；清理（或按需保留栈供 E2.2 使用）。
7. 批次 1 结果交用户审阅后进入批次 2/3。





