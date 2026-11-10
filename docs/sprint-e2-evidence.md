# Sprint E2 DSH 交付简报（进行中）

2026-11-10。依据 [Sprint E2 交接](sprint-e2-dsh-handoff.md) 与 [Sprint E2 执行计划](sprint-e2-plan.md)。本文件按工作包持续回填（E2.6 要求），当前进度：**E2.1–E2.6 本机范围内完成（DSH 自测通过，待 Codex 独立验收）；远程 staging 与生产发布未验证**。远程 staging 资源未提供，本机结果标注“本机验证”。未提交、未推送。

## 1. 开始基线

- 仓库 `CMS_and_WMS`，分支 `dev`，HEAD `9112ed3bfa46171a103a92d54c1008e5e6d4a09d`（Sprint E1 Done），`dev...main/dev [ahead 4]`。
- 工作区既有差异：`M .obsidian/workspace.json`、`?? docs/sprint-e2-dsh-handoff.md`、`?? docs/sprint-e2-plan.md`；E2 新增 `deploy/staging/`、`docs/evidence/sprint-e2/`、本文件。
- 环境：Docker 29.9.2、Compose v5.6.1、Node 24.14.0；已占用且未触碰：原生 Windows PG18（`127.0.0.1:5432`）、本地开发容器 `flower-v2-pg`（`127.0.0.1:55432`，库 `flower_v2_test`）。

## 2. E2.1 · staging 与真实镜像基线（本机完成）

### 2.1 真实镜像构建

从 HEAD 用仓库根 Dockerfile 直接构建在 deps 阶段失败（容器内 `npm ci` 网络问题），四次尝试记录如下：

| 尝试 | 方式 | 结果 | 证据 |
|---|---|---|---|
| 1 | 仓库根 Dockerfile | deps 阶段约 20 分钟无输出，人工取消 | [e21-build-attempt1](evidence/sprint-e2/logs/e21-build-9112ed3bfa46-20261110-173320.log) |
| 2 | 仓库根 Dockerfile（重试） | 12 分钟后 `ECONNRESET`，exit 1 | [e21-build-attempt2](evidence/sprint-e2/logs/e21-build-9112ed3bfa46-20261110-183511-attempt2.log) |
| 3 | `deploy/staging/images/Dockerfile.staging`（官方 registry + 重试/超时） | 3 小时 22 分钟后网络错误，exit 1 | [e21-build-attempt3](evidence/sprint-e2/logs/e21-build-9112ed3bfa46-20261110-185537-attempt3-variant.log) |
| 4 | `deploy/staging/images/Dockerfile.staging-offline`（本地 `flower-e2-deps:linux`） | **成功** | [e21-build-attempt4](evidence/sprint-e2/logs/e21-build-9112ed3bfa46-20261110-222030-attempt4-offline.log) |

成功镜像（本机）：

| 字段 | 值 |
|---|---|
| tag | `flower-e2-staging:9112ed3bfa46` |
| image ID | `sha256:ce51b56411863864898bbe32d781711c18b9973b758eba06957123562058882a` |
| 平台 / 大小 | `linux/amd64` / 1.8 GB |
| 源码 SHA | `9112ed3bfa46171a103a92d54c1008e5e6d4a09d` |
| 构建变体 | `deploy/staging/images/Dockerfile.staging-offline`（deps 复用本地 `flower-e2-deps:linux`；跳过 `npm prune --omit=dev`） |
| 本地 RepoDigest | `flower-e2-staging@sha256:ce51b564…`（本地构建标识，**不是** registry digest） |

偏差与提案：生产 Dockerfile 未修改；变体仅用于本机 staging，原因是容器网络无法稳定完成 deps 阶段 `npm ci`（锁文件 627 条 resolved 指向 npmmirror CDN，E1 已有同类故障记录）。E2 简报建议维护者/CI 采用固定 registry 重写策略（与 E1.6 PR workflow 一致）后复跑真实构建。证据与说明见 [构建变体说明](../deploy/staging/images/README.md)。

### 2.2 staging 资源（本机隔离）

| 资源 | 值 |
|---|---|
| Compose 项目 | `flower-e2-staging` |
| 容器 | `flower-e2-staging-db` / `-web` / `-cron` |
| 网络 / 卷 | `flower-e2-staging_default` / `flower-e2-staging_postgres_data`、`_next_cache` |
| 宿主端口 | web `127.0.0.1:18081`、db `127.0.0.1:15433` |
| 数据库 | V1 `flower_e2_v1`、V2 `flower_e2_v2_test`（PG 18.6，digest 固定） |
| 合成数据 | V2 `test` seed `minimum,roles`（admin/manager/buyer/sales/florist，密码=用户名；由宿主经 127.0.0.1:15433 写入） |

### 2.3 启动与验收结果

| 检查项 | 结果 |
|---|---|
| entrypoint 迁移 | V1 45 / V2 8 个迁移已应用；`migrate status` 均为 up to date |
| 健康 | `/api/health` 200 `{"status":"ok"}`（启动约 15.6 秒） |
| 登录页 / V2 入口 | `/login` 200；未登录 `/v2`、`/v2/inventory`、`/v2/orders`、`/v2/catalog` 均 307 跳登录 |
| 完整凭据登录 | `/api/auth/callback/v2-credentials` 302；登录后 `/v2` 200（工作台可访问） |
| cron | `[cron-worker] started`；`[cron-inventory] done`、`[cron-order-expiry] done` 成功轮次 |
| 持久化 | 合成标记 `_e2_marker` 在只重建 db 容器后保留；V2 迁移历史仍为 8 |
| 隔离 | 项目容器/卷/网络均带前缀；web 仅绑定 `127.0.0.1:18081`；未触碰 `flower-v2-pg` 与原生 PG |

主要证据（`docs/evidence/sprint-e2/logs/`）：

- 预检与镜像：[preflight](evidence/sprint-e2/logs/e21-preflight-20261110-173320.log) / [imagemeta](evidence/sprint-e2/logs/e21-imagemeta-20261110-222507.log)
- 启动：[dbinit2](evidence/sprint-e2/logs/e21-dbinit2-20261110-183830.log) / [up](evidence/sprint-e2/logs/e21-up-20261110-222514.log)
- 验收：[verify](evidence/sprint-e2/logs/e21-verify-20261110-222643.log)；持久化：[persistence](evidence/sprint-e2/logs/e21-persistence-20261110-222659.log)
- 清理/重置：[cleanup](evidence/sprint-e2/logs/e21-cleanup-20261110-183814.log)；首次 verify 的失败证据保留（STAGING_IMAGE 注入与端口断言缺陷，已修复）。

### 2.4 残留风险与远程待办

- **构建偏差**：本机镜像使用 staging 变体（deps 来源本地 `flower-e2-deps:linux`、runner 含 devDependencies），不等于生产 CI 构建产物；真实 CI 构建/推送/registry digest 未验证。
- **未覆盖**：ACR push/pull、registry digest 与源码 SHA 对照、SSH 远程部署、staging 域名/TLS、nginx 上传限制与 413、生产规模备份/恢复。
- 未登录跳转目标显示 `localhost:18081`（与配置的 `127.0.0.1` 不同），不影响本机冒烟；远程需以 staging 域名为准。`n- cron 容器继承镜像内 `/api/health` HEALTHCHECK（自身无 web 服务）会长期 unhealthy；staging compose 已显式 `healthcheck.disable`，cron 有效性以成功轮次日志判定。生产 compose 存在同类语义问题，建议维护者确认监控口径（见待决清单）。
- 本机 C: 盘余量约 14 GB、Docker 构建缓存约 14.5 GB（可回收约 5.7 GB）；后续批次开始前建议做定向 `docker builder prune`，并继续监控 C: 余量。
- 远程接入清单见 [staging README](../deploy/staging/README.md)。

## 3. E2.3 · 自动备份与独立恢复（本机完成）

脚本：`Backup-Staging.ps1`、`Restore-Staging.ps1`、`Start-StagingBackupLoop.ps1`、`Invoke-BackupRestoreTests.ps1`。

| 场景 | 结果 | 证据 |
|---|---|---|
| 备份 | V1/V2 分库 `pg_dump -Fc` → sha256 + `pg_restore --list` 校验 → manifest（源版本/UTC/库标识/行数基线）；成功集约 3–5 秒 | e23-backup-* |
| 定时入口 | `-Once` 两轮（模拟两个调度周期）均成功；备份集数量符合 Retention | e23-backup-loop-* |
| 坏归档 | 截断归档恢复失败（非零），目标库保留供定位，上一份有效备份不受影响 | e23-backup-restore-tests-* |
| 目标冲突 | 目标库已存在时拒绝覆盖（非零） | 同上 |
| 保留策略 | 超过 Retention 只清理最旧成功备份，failed/ 隔离目录保留 | 同上 |
| 有效恢复 | 恢复到 `flower_e2_restore_*` 新库，迁移历史 8、关键表行数与 manifest 基线一致；V2 恢复约 3.4–6.6 秒 | e23-restore-* |

限制：本机为合成数据与单机 Docker；生产周期/异地/加密/保留/RPO/RTO/恢复责任人/OSS 一致性仍待决，见 [待决清单](sprint-e2-open-decisions.md)。

## 4. E2.2 · SHA 部署与失败停止（本机完成）

脚本：`Deploy-Staging.ps1`（串行锁、现状记录、目标解析、预检、迁移前备份、停/起、健康、迁移后核对、后启 cron、冒烟、发布记录）与 `Test-StagingMigration.ps1`（preflight/post，退出码 2–5）。

| 场景 | 结果 | 证据 |
|---|---|---|
| 同版本重试 | 连续两次部署同一镜像成功（7.2–8.1 秒健康，cron 成功轮次），迁移不重复 | e22-deploy-* |
| 错误目标 | 不存在的镜像在替换前退出（exit 2），现有 web 保持健康 | e22-deploy-* |
| 数据库目标失败 | V1/V2 同名时 `--connect` 预检失败（非零），未替换应用 | e22-deploy-failure-db-migration-* |
| 迁移失败 | 受控失败迁移镜像在 entrypoint 迁移阶段失败（P3018，exit 1，unfinished=1），流程停止 | 同上 |
| 坏镜像健康失败 | 受控坏镜像部署后 health 180 秒超时（exit 6），未启动 cron，旧镜像保留；随后用正常镜像恢复成功 | e22-deploy-* |
| 发布记录 | 每次成功部署写 `docs/evidence/sprint-e2/releases/rel-*.md`（目标/上一版/健康/冒烟/故障单字段） | releases/ |

说明：迁移执行者保持 web entrypoint 唯一；部署入口不重复执行 migrate。`workflow-proposal.md` 只交付 staging workflow 提案，未写 `.github/workflows/`。受控测试镜像位于 `deploy/staging/images/`，不进入生产构建。
## 5. E2.4 · 迁移前后验证（本机完成）

脚本：`Invoke-MigrationTests.ps1`（empty/incremental 场景驱动）、`Test-StagingMigration.ps1`（preflight/post，退出码 2–5，已支持 `-ContextMode Verify`）。

| 场景 | 结果 | 证据 |
|---|---|---|
| 空库迁移 | 实际 HEAD 镜像在 verify 项目空库应用 V1 45 / V2 8；`prisma migrate diff --exit-code` 输出 `No difference detected.`；0008 枚举/列核对全部为 1 | e24-migration-empty-* |
| 上一版镜像构建 | 用 git worktree 检出 `1c71923`（V2 7 迁移），按该提交的 package-lock 安装 linux 依赖为 `flower-e2-deps:1c71923`，再构建 `flower-e2-prev:1c71923`（id `sha256:45a106bb…`） | e24-migration-incremental-* |
| 增量升级 | 旧镜像在 7 迁移库上健康；production 初始化写入 Tenant=1/Store=1/StaffUser=1 等合成数据；切到 HEAD 镜像后 V2 7→8、V1 45；迁移前后关键表行数差异为空；0008 schema 核对通过；旧镜像在 8 迁移 schema 上健康 7.5 秒 | 同上 |
| 失败分类 exit 3 | 人为插入镜像外迁移记录 `9999_unexpected_history` → preflight 退出码 3 | e24-migration-failures-* |
| 失败分类 exit 4 | 受控失败迁移镜像在 entrypoint 迁移阶段失败（P3018，unfinished=1） | e22-deploy-failure-db-migration-* |
| 失败分类 exit 5 | 受控删除 0008 列 `Stocktake.reviewReasons` → post 核对退出码 5 | e24-migration-failures-* |
| 重跑识别 | 依据退出码与 migration 状态区分：未执行（pending）/ 执行失败（unfinished/failed 行）/ 已应用但核对失败（schema/行数）；失败库保留现场，重跑前按此分类处理 | 同上 |

证据边界：上一版镜像为本地按 `1c71923` 提交构建（staging-only Dockerfile 变体），非真实生产发布 digest；本机为合成数据与单机 Docker，远程 staging 需用真实上一版 digest 复跑。worktree、旧镜像依赖镜像与构建日志均可在 `.runtime`/evidence 中复查。
## 6. E2.5 · 回滚与恢复演练（本机完成）

脚本：`Invoke-StagingRollback.ps1`（半自动；要求执行者提供上一版镜像 + 兼容性证据 JSON；不安全/破坏性迁移拒绝回滚，exit 9）、`Invoke-StagingRollbackDrills.ps1`。

| 场景 | 结果 | 证据 |
|---|---|---|
| 坏镜像 → 回滚 | 受控坏镜像部署按失败停止；回滚到上一版镜像，web/cron 镜像一致，健康恢复 7.3 秒，冒烟通过，回滚总耗时 12.4 秒；数据库保持前滚 | e25-rollback-drills-* |
| 兼容性拒绝 | 不安全证据（假设删除列/收紧约束）→ 回滚入口 exit 9，运行中的 web 状态不变 | 同上 |
| 数据库恢复路径 | 从 E2.3 最新 V2 备份恢复到隔离副本（3.94 秒），迁移历史 8、行数核对通过；数据库恢复与镜像回滚分别记录，副本随后清理 | 同上 |

限制：不兼容场景采用“兼容性证据拒绝 + 恢复副本”验证，未在独立环境构造真实破坏性迁移 + 旧应用组合；远程 staging 应补充该组合演练。`Deploy-Staging.ps1` 的受控退出码已修正（坏镜像场景历史日志中进程退出为 1，但仍满足“失败停止”；修复后不存在镜像场景实测 exit=2）。

## 7. E2.6 · 发布记录、门禁复跑与关闭（本机完成）

- 发布记录模板：`docs/sprint-e2-release-record.md`；本机部署/回滚记录已归档 `docs/evidence/sprint-e2/releases/`。
- E1 门禁复跑（2026-11-10，HEAD `9112ed3`，应用目录）：`knowledge-structure=0`、`knowledge node:test=0`、`next typegen=0`、`tsc --noEmit=0`、`lint=0`、`test:unit=0`、`build（占位 env）=0`。证据：`docs/evidence/sprint-e2/logs/e26-*`。
  - 未复跑 `test:ci`/`test:e2e`：E2 未改应用源码、迁移、seed 或测试；E1 收尾已有干净环境通过证据（如需可在 Codex 验收时复跑）。
- 资源清理：staging 容器/卷/网络已 `down -v` 清理（0 残留），且未触碰 `flower-v2-pg`；临时恢复库/verify 项目已清理；worktree 已移除；镜像保留：`flower-e2-staging:9112ed3bfa46` 与 `flower-e2-deps:linux`（复跑/复查用）。
- 本机关闭时磁盘：C: 曾降至约 0.8 GB，已通过删除 E2 派生镜像、`docker builder prune` 与清理宿主 npm 缓存恢复至约 19.3 GB；后续复跑需预留磁盘并允许重新下载依赖。
- **Codex 独立验收入口**：按 ADR-005 复跑本文件所列证据与失败场景；重点核对 E2.1 构建变体偏差、E2.2 受控失败退出码、E2.3 备份/恢复、E2.4 增量路径、E2.5 兼容性拒绝。未提交/未推送，文件即 `git status` 中的未跟踪目录与文档；生产发布仍由项目用户批准。
## 8. 文件清单（E2.1–E2.6）

- staging 基础设施：`.gitignore`、`compose/docker-compose.staging.yml`、`env/staging.env.example`、`db/init/10-create-v2-database.sh`、`db/checks/*.sql`、`README.md`。
- 脚本：`Staging.Common.ps1`、`Invoke-Staging.ps1`、`Backup-Staging.ps1`、`Restore-Staging.ps1`、`Start-StagingBackupLoop.ps1`、`Invoke-BackupRestoreTests.ps1`、`Deploy-Staging.ps1`、`Test-StagingMigration.ps1`、`Invoke-MigrationTests.ps1`、`Invoke-StagingRollback.ps1`、`Invoke-StagingRollbackDrills.ps1`。
- 构建/失败测试：`images/Dockerfile.staging`、`Dockerfile.staging-offline`、`Dockerfile.bad-health`、`Dockerfile.bad-migration`、`bad-migration/migration.sql`、`images/README.md`；`workflow-proposal.md`。
- 文档/证据：`docs/sprint-e2-plan.md`、`docs/sprint-e2-open-decisions.md`、`docs/sprint-e2-release-record.md`、`docs/evidence/sprint-e2/logs/*`、`docs/evidence/sprint-e2/releases/*`、本文件。
- 未修改生产 `Dockerfile`、`docker-compose.yml`/`docker-compose.example.yml`、`.github/workflows/*`、应用源码、`package.json`/锁文件、迁移历史。

## 9. 下一步

1. DSH 范围：E2.1–E2.6 本机完成，交 Codex 按 ADR-005 独立复跑与验收。
2. 维护者/用户：远程 staging 资源接入并复跑真实构建/推送/部署；关闭生产 PG 版本/卷、备份 RPO/RTO/异地带宽等 Runbook 阻塞项；生产发布审批。
3. 可选补强：远程 staging 的“破坏性迁移 + 旧应用”组合演练、生产规模备份/恢复与 OSS 一致性对账。

## 10. 待用户/维护者确认

- **构建修复已确认仅提案**：用户选择不在本 Sprint 修改生产 Dockerfile/CI；生产构建由维护者/CI 复跑并采用固定 registry 策略（见 `deploy/staging/images/README.md`）。
- 远程 staging 资源（主机/域名/TLS/ACR 凭据/secrets/外部服务测试配置）仍未提供；远程项继续标注待办。
- 生产备份参数（周期、异地、加密、保留、RPO/RTO、恢复责任人、OSS 一致性）待项目用户/维护者决定，见 [待决清单](sprint-e2-open-decisions.md)。
- E2 本机范围已完成；是否进入 Codex 独立验收 / 远程 staging 接入 / 生产审批流程由用户安排。





