# Flower WMS Sprint E3 执行计划（DSH）

2026-11-11。依据 [Sprint E3 交接](sprint-e3-dsh-handoff.md)、[Sprint E2 交付简报](sprint-e2-evidence.md)、[Sprint E2 待决清单](sprint-e2-open-decisions.md)、[E0 知识索引](../knowledge/00-Home/E0-knowledge-index.md)、[ADR-004](../knowledge/05-ADR/ADR-004-agent-knowledge-governance.md)、[ADR-005](../knowledge/05-ADR/ADR-005-codex-dsh-responsibilities.md) 与 [V1/V2 归属](../knowledge/03-Architecture/E0-v1-v2-ownership.md) 编写。基线为 `dev` 上的 `65326e5`（Sprint E2 done）。

**执行状态（2026-11-11）：E3.1–E3.7 DSH 本机自测完成，批次 5 全量门禁已执行，见 [Sprint E3 交付简报](sprint-e3-evidence.md)；Codex 独立验收与生产/外部启用未完成。** 本文件保留为执行前计划与边界依据；实际实现文件、命令、退出码、证据与残留风险以交付简报和 `docs/evidence/sprint-e3/logs/` 为准。执行中相对计划的偏差（测试命名、E3.4 补充 error 计数指标、E3.3 真实捕获边界等）已在简报 §11 列出。

---

## 1. 目标与验收口径

E3 沿用交接的七个工作包，工程关闭标准见交接 §13：

1. 关键 HTTP、认证、数据库和 cron 路径使用同一结构化事件约定，request ID 或 run ID 贯穿日志与错误事件。
2. 受控服务器异常可被追踪，告警目录与 Runbook 可执行，外部平台缺失部分明确标注。
3. 数据库与 cron 的健康和失败可观察，公开健康接口不泄露内部信息，cron 不再依赖错误的 web 健康语义。
4. 生产 bootstrap 管理员没有默认口令路径，首次改密闭环及审计有自动化证据；V1 遗留风险被明确记录。
5. 登录失败治理通过边界、并发和绕过测试；多实例共享策略未落地时不能把单机限流标为生产完成。
6. PR 与镜像安全扫描有正常和失败证据、处置政策和过期例外检查；真实 GitHub/registry 首跑由维护者补证。
7. E1 全量质量门禁保持通过，E2 staging 部署、健康、cron 和回滚主路径无回归。
8. DSH 自测完成后标记“待 Codex 独立验收”；生产告警、限流、账号策略和安全门禁的启用仍需维护者或项目用户批准。

**验收口径**

- **证据优先。** 每个验收项记录命令、UTC 时间、退出码与脱敏日志；失败场景必须真实触发，不用注释或模拟输出代替。
- **区分三档结论。** 所有结论只写“代码/本机通过”“本机 staging 通过”“外部集成待验证（维护者）”，不得把跳过、未适用、缺少凭据说成通过。
- **不越权、不泄密。** DSH 不推送、不合并、不发布、不改云端设置；不读取或写入密钥；日志、指标、错误事件、测试证据中不得出现请求头、Cookie、口令、密码哈希、连接串、Auth.js token、个人联系方式或第三方凭据。
- **外部集成默认关闭。** 缺少 DSN、告警渠道或云权限时，实现本地可验证的事件适配器、导出格式和受控失败；外部投递列待验证。
- **不引入数据库迁移。** 任何新增持久化模型（会话版本、失败计数表、cron 心跳表等）必须先提交 Prisma 设计和迁移计划，经 Codex（及需要时项目用户）批准后另行实施；E3 首轮只用现有 `mustChangePassword`、`AuditEvent`、内存态与文件态。
- **不改变业务语义。** 不修改库存、预留、权限、事务和业务审计语义；不重构全部历史 `console.*`；不把业务审计表改造成日志库。

**本 Sprint 非目标**（交接 §3）：生产部署、修改已批准业务规则、退役 V1、批量升级依赖、自动修复扫描漏洞、无设计验收的数据库迁移。

---

## 2. 实际基线（2026-11-11 盘点）

### 2.1 仓库与工作树

- 仓库 `CMS_and_WMS`，分支 `dev`，HEAD `65326e5`（Sprint E2 done），`dev...main/dev [ahead 5]`，未推送；无 git tag。
- 工作树仅一个未跟踪文件 `docs/sprint-e3-dsh-handoff.md`（本次交接输入）；其 sha256 与 DSH 附件一致（`9d932f51…`）。E2 的 `deploy/staging/`、`docs/evidence/sprint-e2/` 等 83 个证据文件已提交在 `65326e5`。
- 接手核对已完成：根目录、`CMS_and_WMS`、`flower-wms-system` 的 AGENTS 已读；按 AGENTS 的“发布/测试/页面”路由核对了 ADR、知识索引、E2 证据与待决清单。E3 会写 `docs/evidence/sprint-e3/`（当前不存在）。

### 2.2 环境

| 项 | 值 |
|---|---|
| OS / Shell | Windows；PowerShell（DSH） |
| Node / npm | v24.14.0 / 11.11.1 |
| Docker / Compose | Docker 29.9.2 / Compose v5.6.1（daemon 可用） |
| PostgreSQL | 本机原生 PG18 工具在 PATH（`C:\Program Files\PostgreSQL\18\bin`），DB harness 可用；`127.0.0.1:5432` 为原生 PG18，`127.0.0.1:55432` 为开发容器 `flower-v2-pg`——**全程不触碰** |
| 浏览器 E2E | Playwright 1.58；浏览器需已安装（E1 首次安装有网络依赖） |
| Next.js | 16.2.6（`node_modules` 实际安装）；`next-auth` 实际 5.0.0-beta.31（声明 `^5.0.0-beta.30`） |

### 2.3 代码与测试现状

| 领域 | 已核实事实 | E3 缺口 |
|---|---|---|
| 观测/日志 | `src/lib/observability/` 不存在；`src` 生产代码仅 20 处 `console.*`（19 文件，179 处集中在 `*.test.ts`），`scripts` 221 处（40 文件）；无 logger/context/脱敏；审计走 `src/lib/audit-helpers.ts` 与 V1 `AuditLog`/V2 `AuditEvent` | 无统一 schema、级别、脱敏、request/run 关联、错误序列化 |
| 请求关联 | `src/proxy.ts`（195 行，10 条 matcher）被 `NextAuth(authConfig)` 包裹；无 request ID 生成/校验/响应头；`/api/health`、`/api/auth/*`、`/api/miniprogram/*`、`/uploads/*`、静态资源不在 matcher | 无入站 ID 校验、无响应头、日志无法按请求关联 |
| Next.js 能力 | Next 16 已把 middleware 更名为 `proxy`；proxy 默认 Node runtime 且不允许设 `runtime`；`src/instrumentation.ts` 支持 `register` 与 `onRequestError`（`routeType` 含 `route/action/render/proxy`）；`next typegen` 可用并被 CI 使用 | 尚无 `instrumentation.ts`；`src/app` 没有 `error.tsx`/`global-error.tsx`/`not-found.tsx` |
| 错误边界 | 121 个 Route Handler（120 个在 `src/app/api`，1 个上传路径），113 个含 `try{`；13 个文件含 `"use server"`；错误响应统一走 `src/lib/api.ts` 与 `src/lib/business-errors.ts` | 未处理异常无法形成可分组、可关联事件；没有本地受控失败证据 |
| 健康/诊断 | `/api/health` 仅双库 `SELECT 1`，返回 `{"status":"ok"}`/503，`catch {}` 丢弃错误；被 `deploy/staging/scripts/Staging.Common.ps1:416`、`deploy/rehearsal/scripts/Rehearsal.Common.ps1:292`、`deploy.yml:99`、`Dockerfile:92-93` 硬断言；已有受保护的 `/api/admin/system/health`（`requirePermission("business:read")`）与 `src/services/system-health.ts`，其中 cron 检查写死 `UNKNOWN` | 无组件耗时、无请求/错误/DB/cron 指标、无受保护指标入口；公开健康接口不能泄漏内部信息 |
| cron | `scripts/cron-inventory-daemon.ts`（85 行）：库存同步默认 15 分钟、订单过期默认 1 分钟，`console` 文本日志、`for(;;)` + 30s sleep、无 run ID/耗时/计数；`docker-compose.yml` 的 cron 容器无 healthcheck/volume，继承镜像 `/api/health` HEALTHCHECK 恒 unhealthy；staging compose 显式 `healthcheck.disable` | 无成功轮次/连续失败信号，cron 健康语义仍依赖 web |
| 数据库 | V1 `src/lib/prisma.ts:14`、V2 `src/v2/db.ts:10` 均 `new PrismaPg({ connectionString })`，无连接池参数；`@prisma/adapter-pg` 有 `underlyingDriver()`/`onPoolError` 但 `PrismaClient` 不暴露 adapter；两个 db 客户端不在 E3.4 允许路径 | 池指标按交接记为能力缺口；只做探测成功/耗时与失败分类 |
| 认证/登录 | 单 Auth.js 实例，V1 `credentials` 与 V2 `v2-credentials` 两个 provider；失败一律 `return null`，UI 统一“用户名或密码错误”；JWT `maxAge 12h`；`mustChangePassword` + `v2BootstrapSession` + proxy 重定向 + `/account/v2-password` 内联 Server Action（CAS 更新后本地 signOut）；失败仅客户端可见，服务端零日志/零指标 | 无跨 provider 的失败观测、限流、延迟或锁定；改密无审计事件；旧 JWT 无服务端撤销手段 |
| 密码/初始账号 | `src/v2/password-policy.ts` 为唯一强度函数（≥16 字符、≤72 字节、不含用户名、去重字符≥8）；人员重置仅 ≥8（`staff-management.ts:12`）、V1 重置 ≥6；`prisma/v2/seed.ts` production 只接受密码文件、校验强度、拒绝 test tier 与同名覆盖；生产 seed 置 `mustChangePassword=true`；seed 错误会打印 `error.message`（密码文件缺失时含路径）；V1 `prisma/seed.ts` 硬编码 `admin/admin` 并打印明文 | 生产默认口令/首次改密/启动保护需核对闭合；V1 遗留需记录；策略分叉（16/8/6）需决策 |
| 审计模型 | V2 `AuditEvent` 的 `tenantId` 必填；bootstrap 会话的 `defaultTenantId/currentTenantId` 为 null；V1 `AuditLog`/`StaffAuditLog` 独立 | 改密审计需先解析租户；业务审计不得承载运行日志 |
| CI/供应链 | `.github/workflows/pr.yml`：`pull_request` 触发、`permissions: contents: read`、Node 24、官方 registry 重写、5 个必跑门禁（knowledge-structure/lint/typecheck/unit/build）+ 3 个条件门禁（db-regression/e2e/traceability）；`deploy.yml` 仅 `push master` → ACR + SSH，无 permissions 块；全部第三方 action 按主版本 tag、未固定 SHA；无 `.github/dependabot.yml`、无 `.github/security/`、无任何依赖/secret/SBOM/镜像扫描 | 需独立 security workflow、SHA 固定、失败/例外政策、受控样本与可归档报告 |
| 构建/依赖 | 生产 `Dockerfile`：`node:22-alpine`（无 digest）、deps 阶段 `npm ci`、prod-deps `npm prune --omit=dev`、runner 非 root、含 HEALTHCHECK；锁文件 739 个 resolved 条目中 627 个指向 `registry.npmmirror.com`，112 个指向 `registry.npmjs.org`；无 `.npmrc`；无 `engines`；CI Node 24 与镜像 node:22 不一致；E2 已实测容器内 `npm ci` 网络失败并以 staging-offline 变体绕过 | 生产镜像构建可复现性未闭环；不得在本 Sprint 改 Dockerfile/锁文件；安全扫描镜像来源需明确 |
| 测试基建 | `vitest.config.ts` 仅收 `**/*.vitest.ts`（当前仅 1 文件）；`test:unit` = vitest + harness 自测 + `test-v2 unit`（只发现 `src/v2/domain/**`、`src/v2/navigation.test.ts`、`src/app/v2/**`）；`test:integration:v2` 发现 `src/v2/**` 与 `src/app/v2/**` 的 `*.test.ts`；`test:ci` = 两套临时 PG 集群的串行全量；E2E 7 个 spec、workers=1、`next dev` 3100、E1 实测约 4.2 分钟；登录 e2e 账号密码均为 `admin/admin` 等并缓存 storageState | **新测试的落点必须匹配发现规则，否则会被静默忽略**（详见 §6.2） |

### 2.4 E2 遗留已知限制（不得当作 E3 缺陷或通过项）

- 远程 staging、真实 registry digest、GitHub Actions 首跑、分支保护仍未由维护者验证。
- 本机构建曾受锁文件 npmmirror 下载地址与网络 `ECONNRESET` 影响；E2 使用 staging-offline 变体成功，产物含 devDependencies，**不代表生产镜像**。
- cron 容器继承 web HEALTHCHECK 会 unhealthy；staging 已 `healthcheck.disable`，生产监控口径待维护者确认。
- 生产 PostgreSQL 卷/版本、备份参数、告警平台、通知渠道与登录限流生产参数仍待确认。

---

## 3. 范围、写入所有权与合同

### 3.1 本 Sprint 新建（建议精确路径）

以下路径均在交接“允许路径”最大边界内；标 `*` 的是对交接建议文件名的技术调整（测试发现规则，需 Codex 在合同时确认）。

```text
CMS_and_WMS/
├── docs/
│   ├── sprint-e3-plan.md                  # 本文件
│   ├── sprint-e3-open-decisions.md        # 待决清单
│   ├── sprint-e3-evidence.md              # 交付简报（执行期按包回填）
│   ├── sprint-e3-alert-catalog.md         # E3.3 告警目录
│   ├── sprint-e3-credential-governance.md # E3.5
│   ├── sprint-e3-security-gates.md        # E3.7
│   └── evidence/sprint-e3/logs/           # e3<包>-<场景>-<run_id>.log（脱敏）
├── deploy/
│   └── observability/                     # E3.3/E3.4：告警规则、示例配置、说明（共用，串行合并）
├── flower-wms-system/
│   ├── src/
│   │   ├── instrumentation.ts             # E3.2 建；E3.3 追加 onRequestError（串行）
│   │   ├── lib/observability/
│   │   │   ├── index.ts
│   │   │   ├── logger.ts                  # 固定 schema 版本、级别、事件、错误序列化
│   │   │   ├── redact.ts                  # 大小写无关、嵌套字段脱敏
│   │   │   ├── context.ts                 # run ID / request ID 上下文，注入式
│   │   │   ├── sink.ts                    # 内存 sink（测试）/stdout/stderr
│   │   │   ├── request-id.ts              # 入站校验、生成、header 名
│   │   │   ├── error-classify.ts          # 预期拒绝/校验失败 vs 系统错误
│   │   │   ├── error-events.ts            # 脱敏、分组、受控投递接口
│   │   │   ├── metrics.ts                 # 低基数进程内指标 + 渲染
│   │   │   └── *.vitest.ts *              # 单测（不得用 logger.test.ts，见 §6.2）
│   │   ├── app/
│   │   │   ├── api/health/route.ts        # 改：事件 + 耗时；响应契约不变
│   │   │   ├── api/admin/system/metrics/route.ts   # 新：受保护指标入口
│   │   │   └── global-error.tsx           # 新（E3.3）：含 <html>/<body>，显示 digest
│   │   ├── proxy.ts                       # 改（E3.2；E3.6 仅在验收后按需）
│   │   ├── auth.ts                        # 改（E3.1 → E3.5 → E3.6 串行）
│   │   ├── auth.config.ts                 # 改（E3.5，必要时）
│   │   ├── lib/auth-security/
│   │   │   ├── index.ts
│   │   │   ├── policy.ts                  # 阈值/窗口/开关的 env 契约与默认值
│   │   │   ├── store.ts                   # 有界内存存储（上限 + TTL 清理）
│   │   │   ├── keys.ts                    # 账号/来源指纹
│   │   │   ├── throttle.ts                # 决策（检查/记录/成功重置）
│   │   │   └── *.vitest.ts *              # 单测
│   │   ├── app/account/v2-password/page.tsx  # 改（E3.5）：审计 + CAS 结果 + 通用错误
│   │   ├── app/account/v2-password/page.vitest.ts *  # 聚焦测试
│   │   ├── v2/password-policy.ts          # 改（E3.5）：策略常量/辅助，保持现有行为
│   │   ├── v2/password-policy.vitest.ts * # 新
│   │   ├── v2/credential-governance.test.ts *  # 新：seed 合同（integration 发现）
│   │   ├── v2/auth.ts                     # 改（E3.5/E3.6 视需要）
│   │   └── v2/services/stocktake.ts       # 改（E3.1）：仅边界事件，不动事务/抛错/审计
│   ├── prisma/v2/
│   │   ├── seed.ts                        # 改（E3.5）：错误不外泄路径/口令
│   │   └── seed/production.ts             # 改（E3.5）：竞态兜底行补 mustChangePassword
│   ├── scripts/
│   │   ├── cron-inventory-daemon.ts       # 改（E3.1 → E3.4 串行）：runId/心跳/计数
│   │   └── check-v2-credential-governance.mjs  # 新（E3.5 启动检查）
│   ├── docker-entrypoint.sh               # 改（E3.5）：迁移后调用启动检查（警告/可配置失败）
│   └── tests/e2e/login-throttle.spec.ts   # 新（E3.6）
├── .github/
│   ├── workflows/security.yml             # 新（E3.7，独立 workflow）
│   ├── dependabot.yml                     # 新（E3.7，可选默认采用）
│   └── security/                          # 新：策略、例外、secret/镜像扫描配置
└── scripts/security/                      # 新（E3.7）：离线校验脚本 + fixtures
```

### 3.2 可能修改的既有文件（逐项理由与条件）

| 文件 | 允许的修改 | 条件 |
|---|---|---|
| [health route](../flower-wms-system/src/app/api/health/route.ts) | 增加日志事件、每库探测耗时；**保持 200/503、`{"status":"ok"}`/`{"status":"unavailable"}` 键与语义不变** | E3.1/E3.2/E3.4，改动必须过 E2 staging/rehearsal 断言 |
| [proxy.ts](../flower-wms-system/src/proxy.ts) | request ID 校验/生成、请求/响应头、matcher 最小扩展；不改变登录/回调/上传/V1/V2/健康检查现有状态码、重定向与缓存行为 | E3.2 独占；E3.6 仅在 E3.2 验收后且确需时 |
| [auth.ts](../flower-wms-system/src/auth.ts) | 结构化事件、失败计数、限流接入、安全指纹；不改变登录成功/失败外观与授权语义 | E3.1 → E3.5 → E3.6 串行，同一时间仅一个 owner |
| [auth.config.ts](../flower-wms-system/src/auth.config.ts) | 仅当会话/回调语义需要且不引入 DB 依赖（proxy 兼容） | E3.5，需在合同说明 |
| [cron daemon](../flower-wms-system/scripts/cron-inventory-daemon.ts) | runId、开始/成功/失败/耗时/计数、心跳文件；保持退出语义、轮询间隔与任务顺序 | E3.1 建事件契约 → E3.4 加心跳，串行 |
| [stocktake.ts](../flower-wms-system/src/v2/services/stocktake.ts) | 只在导出边界包一层事件；**不改事务、抛错、幂等和业务审计** | E3.1 |
| `prisma/v2/seed.ts`、`seed/production.ts` | 错误脱敏、竞态兜底字段补齐；**不改 seed 语义与“已存在不覆盖”** | E3.5 |
| [v2-password page](../flower-wms-system/src/app/account/v2-password/page.tsx) | 改密成功写 `AuditEvent`、处理 CAS 结果、通用错误；**不新增绕过路径** | E3.5 |
| `docker-entrypoint.sh` | 迁移后、seed 前调用启动检查；默认只告警，拒绝启动需显式开关/批准 | E3.5（选择“独立脚本 + entrypoint 调用”方案，见 §4.5） |
| [staging compose](../deploy/staging/compose/docker-compose.staging.yml) | 仅非生产：cron 心跳共享卷、cron healthcheck 语义；**不动生产 compose** | E3.4 |
| [staging workflow 提案](../deploy/staging/workflow-proposal.md) | 仅补充安全门禁对接说明（追加段） | E3.7 |

其余既有文件（生产 `Dockerfile`、生产 `docker-compose.yml`/`docker-compose.example.yml`、`.github/workflows/pr.yml`、`deploy.yml`、应用依赖与锁文件、迁移历史、已批准知识、E1/E2 证据、`.obsidian/`）**默认不修改**。`package.json`/锁文件只允许在“现有依赖无法满足且用户批准新增依赖”时改动（E3 设计默认零新增依赖）。

### 3.3 不触碰清单

- 生产容器/卷/网络/Compose/云端设置、ACR/SSH 凭据、生产环境变量与数据库；本机原生 PG18（5432）与开发容器 `flower-v2-pg`（55432）。
- Git 远程写操作（不 commit、不 push、不建分支、不发布）；不读取 `.env*` 真实值。
- `deploy/staging/.runtime/`（含历史 secrets 与备份）；E3 需要 staging 时重建独立资源。
- 已批准业务规则、权限矩阵、库存/预留/事务/审计语义、迁移历史与 Prisma schema。
- E1/E2 证据原文（只新增 E3 证据；引用 E2 用链接）。
- 业务审计表（不得写入运行日志）。

### 3.4 文件所有权与串行边界

| 路径 | 唯一 owner | 说明 |
|---|---|---|
| `src/lib/observability/**` | E3.1 owner（观测 agent） | E3.2/E3.3/E3.4 只能由同一 owner 串行追加；不得并行编辑 |
| `src/instrumentation.ts` | E3.2 建 → E3.3 追加 | 同一文件串行，合并前 E3.2 必须验收 |
| `src/proxy.ts` | E3.2 | E3.6 仅在 E3.2 验收后、方案确需时开放 |
| `src/auth.ts` / `src/auth.config.ts` | E3.5 实现 → E3.6 | E3.1 只做日志接入；任何两个包不得同时编辑 |
| `src/app/api/health/route.ts` | E3.1 → E3.2 → E3.4 | 每次改动前复核响应契约 |
| `scripts/cron-inventory-daemon.ts` | E3.1 → E3.4 | 心跳与事件同文件串行 |
| `deploy/observability/**` | E3.3 → E3.4 | 两包共享，串行合并 |
| `deploy/staging/compose/docker-compose.staging.yml` | E3.4 | 仅非生产 |
| `package.json` / 锁文件 | 无默认 owner | 仅在批准后由单一 owner 修改 |
| `docs/` 汇总类文档 | Lead | 各包提供段落，Lead 汇总，避免并行改同一文件 |

**硬规则**：不同任务不得同时修改同一路径；开始每个任务前再次收窄 `allowed_paths`；使用 Agent Teams 时在共享任务上声明 write scope，观测/认证/安全三个 owner 的写域互不重叠。

### 3.5 ADR-005 合同与任务 ID

交接已给稳定 Task ID；执行时每个包另记录 DSH session ID：

| 包 | Task ID | 依赖 |
|---|---|---|
| E3.1 | `e31-observability-core` | 无（首批） |
| E3.2 | `e32-request-correlation` | E3.1 验收（未验收只做设计与测试盘点） |
| E3.3 | `e33-error-alerting` | E3.1、E3.2 的事件与关联字段 |
| E3.4 | `e34-runtime-monitoring` | E3.1、E3.2（设计可在批 2 做） |
| E3.5 | `e35-credential-governance` | 只读盘点可首批；实现需认证文件所有权 |
| E3.6 | `e36-login-throttling` | E3.5 验收（认证入口） |
| E3.7 | `e37-security-gates` | 无（可首批并行） |

每个合同必须列出：本轮精确修改文件、禁止路径、验收标准到证据的映射、聚焦测试命令、失败样本、证据目录、残留风险与待决项。范围外文件（如业务指标挂点、生产 compose、`package.json` 测试脚本、`.env.production.example`）需先提交范围变更提案。

### 3.6 提交策略

默认**不提交、不推送**。每个包完成后在简报给出建议拆分（代码/配置、测试、文档、证据），E3 关闭时由用户决定是否提交到 `dev`；不覆盖其他会话产生的文件。

---

## 4. 工作包分解

### 4.1 E3.1 · 可观测性基础与结构化日志（`e31-observability-core`）

**结果**：服务端通用结构化日志、字段脱敏、后台任务运行上下文；先迁移健康检查、认证、cron 和 V2 盘点服务四个代表路径。

**精确写入（建议）**

- 新增：`src/lib/observability/{index,logger,redact,context,sink}.ts` 与对应 `*.vitest.ts`。
- 修改：`src/app/api/health/route.ts`、`src/auth.ts`、`scripts/cron-inventory-daemon.ts`、`src/v2/services/stocktake.ts`。
- 不改 `package.json`/锁文件（零新增依赖；用 `node:crypto`、`node:process`）。

**实施要点**

1. **固定 schema（版本化 JSON 行）**：`{v, ts(UTC ISO), level, event, service, env, version, requestId?, runId?, ...safe fields}`。级别固定 `debug/info/warn/error`；事件名采用稳定的点分名（如 `http.health.check`、`auth.login.attempt`、`cron.task.round`、`stocktake.confirm`）。非 JSON 可序列化值（循环引用、BigInt、Error、函数、Symbol）不得抛错；`Error` 序列化为 `{name, message?, code?, digest?, stack?}`（stack 仅内部、按级别策略）。
2. **脱敏**：对 `password/passwd/pwd/authorization/cookie/set-cookie/token/secret/apiKey/dsn/connectionString/url?` 等键做大小写无关、递归、数组元素处理；连接串、Bearer、Basic、Cookie 值整体替换为 `[redacted]`；测试证明敏感值不出现。
3. **开发可读、测试可注入、生产 stdout/stderr**：开发环境可用人类可读格式（仍能从测试断言结构化输出）；测试注入内存 sink；写失败（EPIPE 等）被捕获，**绝不影响业务事务结果**。
4. **代表路径事件**：
   - 健康检查：开始/成功/失败 + V1/V2 探测耗时 + 状态码；**响应体保持不变**。
   - 认证：两个 provider 的成功/失败（失败原因分类为 `invalid_credentials`/`inactive`/`membership_denied`/`throttled` 等）；账号用 HMAC-SHA256（`AUTH_SECRET` 派生）截断指纹，**不记录明文用户名/密码/请求体**。
   - cron：每轮/每个任务 `started/completed/failed`、runId、任务名、耗时、安全计数；保留 interval 与退出语义。
   - 盘点确认：仅在导出边界记录开始/成功/失败与安全 ID；不改 100+ 处 `throw`、事务、幂等与审计写入。
5. **不把运行日志写入 `AuditLog`/`AuditEvent`**；审计沿用现有 `safeLogAudit` 语义与失败隔离。
6. **测试发现修正**：交接建议的 `logger.test.ts` 不会被现有 runner 发现（`vitest` 只收 `*.vitest.ts`，`test-v2 unit` 只扫 `src/v2/domain`、`src/v2/navigation.test.ts`、`src/app/v2`）。计划统一用 `*.vitest.ts`；不修改 `package.json` 测试脚本（后者超出“仅依赖无法满足”的开放条件，且需 Codex 批准）。

**自测**

```text
npx next typegen
npx tsc --noEmit
npm run lint
npm run test:unit
npm run test:integration:v2
```

**证据**：脱敏测试输出（敏感值不出现）、循环对象/不可序列化值测试、sink 失败不影响业务、四个代表路径的正常/失败日志样例（脱敏）、`docs/evidence/sprint-e3/logs/e31-*`。

**依赖/风险**：无依赖；主要风险是 `stocktake.ts` 边界选择与认证指纹设计（见 §9）。完成后交 Codex 独立验收，再启动 E3.2。

---

### 4.2 E3.2 · 请求 ID 与 HTTP 关联（`e32-request-correlation`）

**结果**：适用请求具有经过校验的 request ID；响应回传同一 ID；同一请求的日志可关联；Auth.js、静态资源和现有路由行为不变。

**开始前**：阅读已安装的 `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/{proxy,instrumentation}.md` 与 `01-getting-started/16-proxy.md`，确认 matcher/Node runtime/header 传播约定。

**精确写入（建议）**

- 新增：`src/lib/observability/request-id.ts`、`request-id.vitest.ts`；`src/instrumentation.ts`（本轮只做 `register`：启动事件与运行上下文初始化；`onRequestError` 留给 E3.3 串行追加）。
- 修改：`src/proxy.ts`、`src/app/api/health/route.ts`、`src/lib/observability/{context,logger}.ts`（同一 owner 串行）。
- 不改 `/api/auth/*`、`/api/miniprogram/*`、`/uploads/*` 与静态资源行为；覆盖矩阵见下。

**实施要点**

1. **ID 规则**：入站接受 `X-Request-Id`/`x-request-id` 的合法值（长度上限如 64、字符白名单 `[A-Za-z0-9._-]`），非法/超长/含控制字符一律替换；无入站值时用高质量随机（`crypto.randomUUID()` 或 16 字节随机 base32/hex），长度固定。**不得用于授权、幂等键、审计主键或指标标签。**
2. **传播**：proxy 内把最终 ID 写入**请求头**（`NextResponse.next({request:{headers}})`）供上游 Route Handler/Server Component/Action 读取；所有 return 分支（含 redirect/401/403/JSON）统一挂**响应头** `X-Request-Id`。`auth()` 包装层会重建 Response（next-auth `handleAuth` 用 `new Response(body, response)` 复制），**必须在 dev/staging 实测 redirect/401/403/正常分支头是否保留**；不保留时改为在包装层外层统一 `response.headers.set` 或采用 `NextResponse` 再包装的兼容写法。
3. **注入与关联**：Route Handler 从请求头读取；Server Component/Action 用 `headers()`；服务层通过 `context.runWithRequestId()`（`AsyncLocalStorage`，仅 Node runtime）或显式传参关联。缺上下文时记录 `requestId:"-"/absent` 而不是伪造。
4. **matcher**：保留现有 10 条；最小新增 `/api/health`；排除 `_next/static`、`_next/image`、`favicon.ico` 等构建/静态资源；**不把 `/api/auth/*` 加入 matcher**（避免 Auth.js 路由被 proxy 的 auth 包裹影响回调）。覆盖矩阵写入合同：
   - 覆盖：`/`、`/login`、`/v2*`、`/wms*`、`/cms*`、`/admin*`、`/api/admin*`、`/api/cms*`、`/api/business*`、`/api/health`。
   - 不覆盖但行为不变：`/api/auth/*`（Auth.js 回调）、`/api/miniprogram/*`、`/uploads/*`、静态资源；这些由 E3.3 的 incident 事件缺失说明或后续工作包补齐。
5. **日志**：HTTP 事件至少含 UTC 时间、级别、事件名、服务、环境、版本/源码 SHA（缺失时 `unknown`）、request ID、方法、**规范化路由**（用 route template，不含查询串与动态 ID）、状态码、耗时。日志失败不影响响应。
6. **缓存行为**：除 `/`、`/login`、`/admin`、`/cms*` 等预渲染路径外，115/121 个 route 已 `force-dynamic`；不新增缓存头、不改 redirect 目标；e2e 与 staging 冒烟复跑验证。

**自测**

```text
npx next typegen
npx tsc --noEmit
npm run lint
npm run test:unit
npm run build
npm run test:e2e
```

外加本机 dev/staging 请求矩阵：正常 200、登录 302、未登录 307/401、403、健康 200/503、回调路径；每类记录响应头 ID 与日志同一 ID；并发请求不串号（脚本化 20 并发）。

**证据**：请求/响应头样例、日志关联样例、非法 ID 替换、并发不串号、现有状态码/重定向/缓存无变化的对比、`e32-*` 日志。

**依赖/风险**：依赖 E3.1 验收；风险是 Auth.js 包装层 header 保留与本机无 nginx 时的代理头（本包不处理 XFF 信任，留给 E3.6）。

---

### 4.3 E3.3 · 错误追踪与告警契约（`e33-error-alerting`）

**结果**：服务器未处理异常生成脱敏、可关联、可分组的错误事件；预期拒绝/校验失败/受控业务冲突被过滤并计数；本地受控失败证据与告警规则文档；外部平台可选。

**精确写入（建议）**

- 新增：`src/lib/observability/{error-classify,error-events}.ts` 及 `*.vitest.ts`；`src/app/global-error.tsx`；`deploy/observability/`（README、示例规则、导出格式）；`docs/sprint-e3-alert-catalog.md`。
- 修改：`src/instrumentation.ts`（追加 `onRequestError`，与 E3.2 串行合并）、`src/lib/observability/**`。
- **开始前列出精确边界文件**：`src/app/global-error.tsx`（必须含 `<html>/<body>`，client component）；不新增 per-route `error.tsx`（避免改变现有页面错误 UI；如 Codex 要求再列入合同）。

**实施要点**

1. **事件字段**：环境、版本/源码 SHA、request ID（来自 E3.2 请求头；`onRequestError` 的 `request.headers` 取其值）、`routePath`（route template）、`routeType`（render/route/action/proxy）、错误类别、稳定分组键（错误名+code+routePath）、安全堆栈。**不记录** headers 原文、Cookie、查询串、请求体、数据库 URL、SQL 参数与用户输入。
2. **过滤**：预期认证拒绝（`AuthError`/`CredentialsSignin`）、输入校验失败（`business-errors` 的稳定 code）、`redirect()`/`notFound()` 控制流、受控业务冲突 → 只计数、不生成告警级事件；分类器可测试。
3. **受控投递**：默认本地 sink（stdout JSON 行/文件）用于验证；若配置外部 DSN 则异步投递，**SDK 不可用/投递失败时应用继续运行**，只记录一条投递失败事件。不安装 SDK，除非用户批准（`package.json` 开放条件）。
4. **受控失败证据**：在隔离 staging 上选择无 `try/catch` 的既有 route，用非法 JSON/缺失参数触发真实未捕获异常（不涉及真实数据、不改代码）；记录 request ID 与错误事件。若无法稳定触发，用 `onRequestError` 契约测试 + 本地适配器事件补证，并在简报标注“真实 500 捕获待补”，不得虚报。
5. **告警目录**至少定义：5xx 比率、关键任务连续失败、数据库不可用、备份失败、迁移失败、登录失败异常升高。每条含：信号、窗口、阈值占位、严重度、负责人占位、Runbook 链接；备份/迁移信号来源于 E2 脚本日志字段（只引用，不改 E2 脚本）。

**自测**：分类/脱敏/分组单测；`npx tsc --noEmit`、`npm run lint`、`npm run test:unit`、`npm run build`；staging 受控失败演练；事件中敏感字段扫描。

**证据**：受控失败事件样例（脱敏）、过滤样例（登录失败/校验失败不产生系统错误告警）、投递失败不致命、告警目录、`e33-*` 日志。

**待维护者输入**：错误追踪平台、DSN、环境与版本命名、通知渠道、接收人、数据驻留与保留期。默认全部占位，不写真实值。

---

### 4.4 E3.4 · 数据库、cron 与业务信号监控（`e34-runtime-monitoring`）

**结果**：低基数指标 + 受保护诊断入口，覆盖 V1/V2 DB 可用性、请求数与 5xx/延迟分桶、cron 最近成功与连续失败，以及首批可识别业务失败计数。

**精确写入（建议）**

- 新增：`src/lib/observability/metrics.ts`、`metrics.vitest.ts`；`src/app/api/admin/system/metrics/route.ts`（`force-dynamic` + `requirePermission("business:read")`，与 `system-health` 同构）及 `route.vitest.ts`。
- 修改：`src/app/api/health/route.ts`（探测耗时）、`scripts/cron-inventory-daemon.ts`（心跳文件 + 计数事件 → 指标 sink）、`deploy/observability/**`、`deploy/staging/compose/docker-compose.staging.yml`（cron 心跳共享卷 + healthcheck；仅非生产）、`src/lib/observability/**`（观测 owner 串行）。
- 可选新增（**需批准**）：`scripts/cron-healthcheck.mjs`（若不用 compose 内联 healthcheck）。

**实施要点**

1. **指标模型**：进程内低基数计数器/直方图（请求数、5xx、延迟分桶、DB 探测成功/失败/耗时、cron 最近成功时间戳与连续失败数）；标签只允许固定枚举（路由模板、方法、状态类、组件、结果），禁止订单 ID、用户名、URL 查询、错误文本、request ID。多实例不聚合的局限写入文档。
2. **业务信号**：通过 E3.1 的日志事件 + 指标 sink 映射（不改 auth/stocktake 之外的业务文件）：登录失败（两个 provider）、库存负数阻止（盘点确认失败的稳定分类）、采购验收失败/订单确认失败/配送失败/成本重算失败中**现有可识别路径**。可识别路径不足者列入“E3.4b 范围扩展提案”，需用户/Codex 批准后另立合同，不在本包擅自扩大文件范围。
3. **受保护入口**：`/api/admin/system/metrics` 默认不公开；未授权返回 401/403；响应不含库名、用户名、连接信息；采集/渲染失败不影响业务请求。当前 `/api/admin/system/*` 属 `BUSINESS_API_PREFIXES`，IT_ADMIN 会被 proxy 403——保持现状并列入待决；不修改 `src/lib/rbac.ts`（不在允许路径）。
4. **公开健康检查**：`/api/health` 只保留存活/就绪语义与现有响应键；组件耗时、连接池缺失、cron 细节只在受保护入口；不改 E2 脚本断言。
5. **cron 监控**：cron 每轮成功/失败写心跳文件（时间戳 + 计数 + 最近错误类别，无敏感值），**staging** 通过共享卷让 web 的指标入口读取；cron 容器 healthcheck 改为“最近成功轮次时效”检查（compose 内联命令，不新增脚本）。生产 compose 的同等修改不在本 Sprint 允许路径 → 列为维护者待办；cron 不再复用 `/api/health` 作为健康语义（staging 已验证 `healthcheck.disable` 的替代）。
6. **DB 连接池**：当前 Prisma adapter/`pg` 组合无法稳定获取池指标，按交接记为能力缺口；不依赖未公开属性、不 monkey patch。`src/lib/prisma.ts`/`src/v2/db.ts` 不在允许路径，不改。

**自测**：单测（指标渲染、标签基数、鉴权）；`npm run test:unit`、`npx tsc --noEmit`、`npm run lint`、`npm run build`；staging 合成流量展示一次正常趋势 + 一次受控异常（停止 DB/cron 或注入失败），保存脱敏输出与告警判断结果；指标入口未授权/授权请求对比。

**证据**：指标快照（脱敏）、未授权 401/403、受控异常趋势、cron 心跳与连续失败演示、`e34-*` 日志。

**依赖/风险**：依赖 E3.1/E3.2；主要风险是 cron 心跳的跨容器可见性、业务指标挂点范围、IT_ADMIN 访问语义。

---

### 4.5 E3.5 · 默认密码与首次登录治理（`e35-credential-governance`）

**结果**：核对并闭合 V2 生产管理员的强密码、首次改密、审计与启动保护；明确 V1 并存限制。

**精确写入（建议）**

- 修改：`src/v2/password-policy.ts`、`src/v2/auth.ts`、`src/v2/auth-source.test.ts`、`src/auth.ts`、`src/auth.config.ts`、`src/app/account/v2-password/page.tsx`、`prisma/v2/seed.ts`、`prisma/v2/seed/production.ts`、`docker-entrypoint.sh`（仅增加调用）。
- 新增：`src/v2/password-policy.vitest.ts`、`src/v2/credential-governance.test.ts`（integration 发现）、`src/app/account/v2-password/page.vitest.ts`、`scripts/check-v2-credential-governance.mjs`、`docs/sprint-e3-credential-governance.md`。
- 不改 Prisma schema/迁移；不改 V1 schema；不改 `src/proxy.ts`（现有 proxy 已把 `v2BootstrapSession` 重定向到改密页）。

**实施要点**

1. **production seed 硬化**（保留现有拒绝逻辑）：缺失密码文件、弱密码、test tier、默认凭据继续失败；`readFile` 错误包装为固定文案，**不打印路径或口令**；生产 bootstrap 仍只接受密码文件与强密码；`production.ts` 的 `upsert.create` 竞态兜底补 `mustChangePassword:true`，不改变“已存在不覆盖”。
2. **首次改密闭环**：确认 bootstrap 会话在改密前只能访问改密/退出入口（现有 proxy 重定向 + `resolveV2Membership`/`loadV2Context` 的 `V2PasswordChangeRequired`；`/account/v2-password` 不在 matcher 但页面自身校验会话与 DB 状态）。改密成功：CAS `updateMany` 后检查 `count`；**写安全审计事件**（`AuditEvent`，action 如 `V2_STAFF_PASSWORD_CHANGED`，before/after 只含状态，不含哈希/口令），tenantId 需先从 TenantMember/StoreMember 解析（bootstrap 会话的 tenant 字段为 null）；随后 signOut。旧 JWT：proxy 依据 `v2BootstrapSession` claim 持续重定向，v2 授权每次重读 DB（`mustChangePassword`/active/roles 立即生效），等价于“下一次授权重新判定”；**不新增 sessionVersion 字段**（需迁移，列入待决）。其他设备旧会话在本 Sprint 的保障与限制写入文档。
3. **密码策略**：`password-policy.ts` 收敛为单一来源与命名常量（bootstrap/改密 16 位、人员重置 8 位、V1 重置 6 位现状记录在案）；未获产品决定前**不擅自统一或收紧**，只在文档标注分叉与建议。
4. **启动检查**：`check-v2-credential-governance.mjs` 照 `check-v2-database-target.mjs` 的只读、fail-fast、错误不含 DSN 模式；检测：已知默认口令（对 active staff 的 bcrypt 哈希与一小份已知默认候选比对）、生产活动账号仍 `mustChangePassword=true`（bootstrap 未完成）、V1 `admin/admin` 风险提示。默认**高严重度告警 + 退出码 0**；`FAIL_ON_INSECURE_BOOTSTRAP=true` 时才拒绝启动；不自行锁死存量生产账号。检查在 `docker-entrypoint.sh` 迁移之后执行，失败按策略处理且日志不含路径/口令。
5. **V1 遗留**：单列文档——V1 无 mustChangePassword、无自助改密、重置仅 ≥6、会话不回查 DB、V1 seed 有 `admin/admin`；不把 V2 规则套到 V1 schema，不修改 V1 seed。
6. **管理员重置的 mustChangePassword**：`resetStaffPassword` 当前不置 must-flag（`staff-management.ts:568-597`）；是否改变属产品决策，默认**保持现状并记录**，不修改该服务文件（不在允许路径）。如需，另立范围变更。

**自测**：策略/seed 合同/改密决策单测；`npx next typegen`、`npx tsc --noEmit`、`npm run lint`、`npm run test:unit`、`npm run test:integration:v2`；在隔离 DB 验证 production seed 拒绝矩阵与正常初始化；启动检查的正常/默认口令/未完成 bootstrap 三种样例；登录 e2e 回归。

**证据**：seed 拒绝矩阵（弱密码/缺文件/test tier/默认凭据）、改密审计事件样例、改密前后会话行为、启动检查样例、V1 遗留清单、`e35-*` 日志。

**依赖/风险**：E3.1 的事件契约；认证文件与 E3.6 串行；主要风险是审计 tenantId 解析、旧 JWT 撤销的表述边界、启动检查误伤存量账号。

---

### 4.6 E3.6 · 登录限流与失败治理（`e36-login-throttling`）

**结果**：V1/V2 Credentials 登录具备统一失败节流与观测；不能通过切换 provider 绕过；不形成用户名枚举或无限内存增长。

**精确写入（建议）**

- 新增：`src/lib/auth-security/{index,policy,store,keys,throttle}.ts` + `*.vitest.ts`；`tests/e2e/login-throttle.spec.ts`；集成测试（扩展 `src/v2/auth-source.test.ts` 或新增 `src/v2/login-throttle.test.ts`）。
- 修改：`src/auth.ts`（两个 authorize 统一接入）、`src/lib/observability/**`（日志/指标，串行）。`src/proxy.ts` 仅当 E3.2 已验收且方案确需时开放（当前登录 POST 走 `/api/auth/*`，不在 matcher，预计不需要）。
- 不新增持久化模型/迁移；不改登录页（不可列于允许路径）；不改 `package.json` 测试脚本。

**实施要点**

1. **实现位置**：`authorize(credentials, request)` 内（Auth.js v5 支持第二参数；`callbacks.signIn`/`events.signIn` 只在成功路径触发，不能计数失败）。两个 provider 共用同一 store，provider 切换无法绕过。
2. **有界策略**：账号维度 + 来源地址维度；Map 上限 + TTL 清理 + 可注入时钟；账号 key 用用户名规范化后的 HMAC-SHA256 截断指纹（不存明文）；来源 key 来自可信代理链解析（见下）。阈值/窗口/锁定时长/延迟策略全部 env 驱动，缺省为“测试配置 + 生产保护性关闭/保守值”，真值待批准。
3. **外部行为一致**：未知用户、错误密码、停用用户与限流的外部结果不得区分账号存在性；限流时抛 Auth.js `CredentialsSignin` 子类并携带稳定的内部 `code`，但登录页不新增差异化文案（保持统一“用户名或密码错误”），不泄露账号状态。
4. **成功重置**：成功登录只重置账号失败状态，不清除来源地址的滥用记录；窗口恢复、并发失败、阈值边界、provider 切换、存储不可用（注入抛错时 fail-open + 日志/指标，或按批准策略 fail-closed）均有测试。
5. **可信代理**：生产唯一入口为 nginx（`$proxy_add_x_forwarded_for`，最左段可伪造、最右段为 nginx 观测值）；staging 无 nginx，web 直连 127.0.0.1。实现 `TRUSTED_PROXY_HOPS`/`TRUST_PROXY_HEADERS` 契约：默认 0 = 忽略 XFF（本机/staging）；生产值由维护者批准后设置。伪造 `X-Forwarded-For` 的测试必须失败/不生效。
6. **多实例**：单实例内存实现仅限本机/staging 第一阶段，必须有容量上限与清理；多实例共享存储、可信代理链、生产阈值列为**阻塞项**，交付时明确“不得宣称生产完备”。
7. **观测**：失败/限流事件含 provider、安全指纹、来源类别、结果、retryAfter 秒级区间；指标计数通过 E3.4 sink；不记录明文用户名/密码/完整 IP（可记录哈希或网段，按批准）。

**自测**

```text
npx next typegen
npx tsc --noEmit
npm run lint
npm run test:unit
npm run test:integration:v2
npm run test:e2e
```

外加专题 e2e（独立账号，避免污染 `admin` storageState）：阈值边界、窗口恢复、成功重置、V1/V2 切换、伪造代理头、并发失败、限流后正常登录恢复。

**证据**：测试矩阵、限流日志/指标样例、代理头伪造失败、多实例限制说明、`e36-*` 日志。

**依赖/风险**：E3.5 验收；认证文件与 E3.5 串行；风险是生产参数缺失、XFF 信任、e2e 账号连带锁定、Auth.js 错误码兼容。

---

### 4.7 E3.7 · 依赖、密钥与镜像安全门禁（`e37-security-gates`）

**结果**：PR 与镜像流程产生可归档的依赖、secret、SBOM 与镜像漏洞结果，并有失败政策与过期例外机制。

**精确写入（建议）**

- 新增：`.github/workflows/security.yml`（独立 workflow）、`.github/dependabot.yml`（若采用，默认建议采用）、`.github/security/`（政策、例外、secret/镜像扫描配置）、`scripts/security/`（离线校验脚本 + fixtures）、`docs/sprint-e3-security-gates.md`。
- 修改：`deploy/staging/workflow-proposal.md`（仅追加对接说明）。
- 不改生产 `Dockerfile`、`deploy.yml`、`pr.yml`、应用依赖与锁文件。

**实施要点**

1. **门禁分层**：
   - PR（同仓、无 secrets）：`dependency-review`（官方 action，固定 SHA）、secret 扫描（gitleaks，固定版本/SHA + 仓库配置与 allowlist）、锁文件/供应链离线校验、SBOM（对工作区/构建产物生成 SPDX/CycloneDX）。
   - 镜像（push master 或 `workflow_dispatch`）：从 ACR 拉取 `:<sha>` 生产镜像（`deploy.yml` 已推送），用固定版本 trivy 扫描运行镜像并归档 SARIF/JSON；不在 PR 现场重构建生产镜像（E2 已证容器内 `npm ci` 网络不可靠，且 Dockerfile 不在允许路径）。
   - 真实 Actions 首跑、分支保护、Code Scanning 启用、ACR 权限由维护者补证；本地只验证 workflow 结构、脚本退出语义与受控样本。
2. **固定版本与最小权限**：所有 `uses:` 固定到 40 位 commit SHA（含版本注释）；workflow `permissions` 最小化（`contents: read`，仅 SARIF 上传需要时加 `security-events: write`）；不用 `pull_request_target`；秘密不落日志。
3. **政策与例外**：区分运行时/开发依赖、严重度、可利用性、修复可用性；例外条目必须含漏洞 ID、理由、负责人、到期日、补偿措施；`scripts/security/check-exceptions.mjs` 在过期时失败。受控样本证明每类检查能失败；正常仓库证明不输出 secret。
4. **报告归档**：结果作为 artifact 保存（SARIF/JSON/SBOM/摘要），保留期与体积写入政策；日志不含凭据。
5. **发现漏洞只生成报告与修复工作包**，不在本任务批量升级依赖或重写锁文件。
6. **已核实的候选 action SHA（执行时复核 tag→commit）**：`actions/dependency-review-action@a1d282b`（v5.0.0）、`gitleaks/gitleaks-action@e0c47f4`（v3.0.0，或 gitleaks CLI v8.30.1）、`anchore/sbom-action@66cbf4b`（v0.24.3）、`aquasecurity/trivy-action@ed142fd`（v0.36.0）。`node:22-alpine` 等基础镜像 digest 固定属生产 Dockerfile 范围，不在本包。

**自测**

```text
node scripts/security/check-workflow-pins.mjs --self-test
node scripts/security/check-exceptions.mjs --self-test
node scripts/security/<其余离线校验>.mjs --fixtures
node scripts/check-knowledge-structure.mjs --json
node --test scripts/check-knowledge-structure.test.mjs
```

再加 YAML 结构与 `uses:` 位数的离线断言；受控样本（tag 固定、过期例外、缺 integrity、疑似 secret fixture）逐一失败。

**证据**：workflow 结构校验输出、受控失败样本、例外过期失败、SBOM/扫描配置样例（不执行真实扫描时注明“结构验证”）、`e37-*` 日志。

**待维护者**：GitHub 推送/PR/首跑、分支保护与 required checks、Code Scanning、ACR 最小权限与镜像拉取、组织级 secret scanning。

---

## 5. 批次、依赖与团队编排

### 5.1 批次（对齐交接 §11）

```text
批次 0  预检：基线复核、环境/端口/测试可行性、合同收窄、证据目录
  │
批次 1  E3.1（观测 owner） ∥ E3.5 只读盘点（认证 owner） ∥ E3.7（安全 owner）
  │        └─ E3.1 完成 → Codex 独立验收门
批次 2  E3.2（观测 owner） ∥ E3.4 设计（观测 owner 串行） ∥ E3.5 实现（认证 owner） ∥ E3.7 收尾
  │        └─ E3.2 完成 → Codex 独立验收门；E3.5 完成 → Codex 门
批次 3  E3.3（观测 owner） ∥ E3.4 实现（观测 owner，串行合并 observability 共用文件）
批次 4  E3.6（认证 owner；E3.5 验收后）
批次 5  集成、staging 演练、全量门禁、证据整理、Codex 移交
```

- E3.1 未验收前，E3.2 只做设计与测试盘点，不写共用日志文件（交接 §5）。
- E3.3/E3.4 共享 `src/lib/observability/**` 与 `deploy/observability/**`，由同一 owner 串行合并；不同时编辑。
- E3.5 只读盘点可在批 1；实现阶段独占 `auth.ts`/`auth.config.ts`/改密页/seed，不与 E3.1/E3.6 并行写。
- E3.7 独立，可贯穿批 1–2；不修改既有 workflow/Dockerfile/锁文件。
- 批 5 只做汇总与复跑，不再扩大范围；失败先记录再继续不受影响项。

### 5.2 Agent Teams 分工（若用户要求用多 agent 执行）

| 角色 | 负责包 | 写域 | 备注 |
|---|---|---|---|
| Lead | 规划、集成、证据汇总、Codex 移交 | `docs/sprint-e3-*.md`、证据目录、最终 diff 审阅 | 必须最后复核全部差异并跑集成门禁 |
| 观测 agent | E3.1 → E3.2 → E3.3 → E3.4 | `src/lib/observability/**`、proxy、health、instrumentation、metrics route、cron daemon、`deploy/observability/**`、staging compose | 串行，避免共用文件冲突 |
| 认证 agent | E3.5 盘点 → E3.5 实现 → E3.6 | `auth.ts`、`auth.config.ts`、`src/v2/auth.ts`、password policy、改密页、seed、entrypoint、`src/lib/auth-security/**`、登录 e2e | 不与观测 agent 同时改 `auth.ts` |
| 安全 agent | E3.7 | `.github/security/**`、`security.yml`、`scripts/security/**`、安全文档 | 与 CI owner 单一 |
| QA/验证 agent | 独立复核 | 只读 + 测试执行 + 证据核对 | 不写业务文件；按验收标准复跑关键命令，报告差异 |

共享任务板为每个工作包建一个任务，记录 write scope、依赖、owner；跨包依赖用 `blocked_by` 表达。同一路径同一时间只允许一个 owner。

### 5.3 团队外部依赖（阻塞项）

- Codex 独立验收（至少 E3.1、E3.5、E3.6、最终集成四个门）。
- 用户/维护者批准：外部平台、阈值、限流参数、可信代理、启动检查策略、业务指标范围扩展、是否提交/推送、GitHub/ACR 权限。

---

## 6. 验证矩阵

### 6.1 命令

| 层级 | 命令 | 适用/说明 |
|---|---|---|
| 聚焦 | `npx next typegen && npx tsc --noEmit` | 每包必跑 |
| 聚焦 | `npm run lint` | 每包必跑 |
| 聚焦 | `npm run test:unit` | 每包必跑（含 `*.vitest.ts`） |
| 聚焦 | `npm run test:integration:v2` | 涉及 v2/认证/DB 的包（E3.1/E3.4/E3.5/E3.6） |
| 构建 | `npm run build` | E3.2/E3.3/E3.4/E3.5/E3.6 必跑；用与 CI 一致的占位 DB/AUTH env |
| 浏览器 | `npm run test:e2e` | E3.2/E3.3/E3.5/E3.6 必跑；需 Playwright 浏览器 |
| 全量 | `npm run test:ci` | 批次 5 集成；串行两套临时 PG，耗时较长 |
| 知识 | `node scripts/check-knowledge-structure.mjs --json`；`node --test scripts/check-knowledge-structure.test.mjs` | 文档/知识改动后必跑 |
| 补充 | `npx next typegen`、`npm ci` | 全量门禁按交接 §12；`npm ci` 若遇 npmmirror/网络问题，按 pr.yml 方式设置官方 registry 与 replace-host 后重试，并记录归因 |

### 6.2 测试发现约束（对所有包的硬性要求）

- `vitest` 仅发现 `**/*.vitest.ts`；`test-v2 unit` 仅发现 `src/v2/domain/**`、`src/v2/navigation.test.ts`、`src/app/v2/**`；`test-v2 integration` 发现 `src/v2/**` 与 `src/app/v2/**` 的 `*.test.ts`。
- 因此：观测/安全纯函数测试用 `*.vitest.ts`（可在 `src/lib/**`）；认证集成测试放 `src/v2/**`；页面/路由逻辑测试用 `*.vitest.ts` 或抽纯函数到可发现位置；**绝不留下“写了测试但哪个 runner 都不跑”的文件**。`logger.test.ts` 建议名改为 `logger.vitest.ts`（交接文件名调整，需合同确认）。
- 若确需新增测试 runner 覆盖，只能通过 `package.json` 脚本变更实现，须单独批准（超出“依赖无法满足”条件）。

### 6.3 每包验收证据映射

每个包交付：验收标准逐条 → 证据文件/命令/退出码；正常与受控失败样例；敏感信息检查；残留风险；外部待办；与已批准知识/ADR 的偏差及 ID。

---

## 7. 证据、交付与知识库

- 证据目录：`docs/evidence/sprint-e3/logs/`，命名 `e3<包号>-<场景>-<run_id>.log`（`run_id` 形如 `20261111-101500`，UTC），失败证据与正常路径分开保留。
- 证据只含命令、退出码、数量、相对路径与脱敏日志；不写连接串、密码、token、Cookie、请求体、生产数据、第三方后台导出。
- `docs/sprint-e3-evidence.md` 按包持续回填（开始基线、文件与变更摘要、命令与退出码、通过/失败/跳过、证据位置、残留风险、知识修订建议、待决项、与已批准知识/ADR 的偏差）。
- 建议的知识更新（DSH 只提案，Codex/用户批准）：结构化事件与脱敏约定、request ID 契约、指标低基数规则、错误分类与告警目录、凭据治理与启动检查政策、安全门禁政策与例外流程；必要时提议 ADR-006“可观测性与安全基线”。不修改已批准业务规则。
- 不提交/推送：交付在本地工作区；E3 关闭时给出按包拆分提交建议，由用户决定。

---

## 8. 待用户/维护者确认（摘要）

详见 [Sprint E3 待决清单](sprint-e3-open-decisions.md)。执行前至少确认：

| # | 事项 | 建议默认 |
|---|---|---|
| 1 | 执行范围 | 先按批 1–3 完成 E3.1/E3.2/E3.3/E3.4/E3.5/E3.7 的本机与 staging 可验证部分；E3.6 在 E3.5 验收后启动；生产项一律待批准 |
| 2 | 外部平台 | 错误追踪平台/DSN、告警渠道/接收人/阈值/保留期未提供 → 全部占位、外部投递默认关闭 |
| 3 | 限流参数 | 生产默认关闭/保守；测试配置验证机制；可信代理跳数与多实例共享存储为批准项 |
| 4 | 凭据策略 | 保持 16/8/6 现状并在文档标注；启动检查默认告警、`FAIL_ON_INSECURE_BOOTSTRAP` 才拒绝启动；管理员重置 must-flag 保持现状 |
| 5 | 业务指标范围 | 首轮仅登录失败/库存负数阻止等现有可识别路径；其余四项另立范围扩展 |
| 6 | cron 生产监控 | staging 演示；生产 compose 的 healthcheck/共享卷修改由维护者批准 |
| 7 | 版本/SHA 注入 | 运行时读取 `APP_VERSION`/`GIT_SHA`，缺失记 `unknown`；注入需改 deploy/compose，另立提案 |
| 8 | 提交/推送 | 默认不提交不推送，E3 关闭时决定 |
| 9 | 测试发现 | 采用 `*.vitest.ts` 等可发现命名（合同确认），不改测试脚本 |

---

## 9. 风险与缓解

| 风险 | 可能性/影响 | 缓解 |
|---|---|---|
| 新测试被现有 runner 静默忽略（交接建议的 `logger.test.ts`） | 高/高 | §6.2 命名约束；每包用 `npm run test:unit`/`integration` 实跑确认测试被执行；合同里写明 |
| proxy 的 Auth.js 包装层重建 Response，响应头丢失 | 中/高 | E3.2 在 dev/staging 实测 200/302/307/401/403/503 全分支；保留外层统一挂头方案；e2e + 请求矩阵 |
| `/api/health` 契约被破坏，E2 staging/rehearsal/部署断言失败 | 中/高 | 只增字段不改键/状态码；每改一次复跑 E2 断言脚本与 deploy 健康检查 |
| request ID 泄漏到指标标签/审计/授权，或日志记录查询串 | 中/高 | 设计约束 + 审查 + 测试；HTTP 日志只记 route template；指标标签白名单 |
| 日志/错误序列化拖慢或影响事务 | 中/高 | 固定字段、浅拷贝、边界包装、写失败隔离；性能样例 |
| 脱敏遗漏嵌套/数组/连接串 | 中/高 | 递归脱敏 + 大小写无关 + 敏感值扫描测试 + 证据人工复核 |
| cron 心跳跨容器不可见，生产 compose 不能改 | 高/中 | staging 共享卷演示；生产列出维护者待办；不以 web `/api/health` 冒充 cron 健康 |
| 改密审计 tenantId 解析失败（bootstrap 会话无 tenant） | 中/高 | 先解析 TenantMember/StoreMember；失败时安全降级并记录，不阻断改密；测试覆盖 |
| 启动检查误伤存量生产账号 | 中/高 | 默认告警不阻断；阻断开关需明确批准；只读、不修改账号 |
| 旧 JWT 无法真正即时撤销 | 高/中 | 依赖“下一次授权重读 DB + proxy 重定向”并如实记录；sessionVersion 需迁移，列待决 |
| 限流内存增长/伪造 XFF/枚举 | 中/高 | 有界 Map+TTL+可注入时钟；默认不信任 XFF；指纹化 key；统一外部行为；并发/伪造测试 |
| 单实例限流被误报为生产完备 | 中/高 | 明确阻塞项与交付措辞；多实例共享存储列为未完成 |
| e2e 限流用例锁定共享账号，连带失败 | 中/中 | 独立账号/显式清理；测试配置下可设关闭或短窗口；串行 workers=1 |
| 业务指标挂点不在允许路径 | 高/中 | 首轮只用现有事件 sink；其余列 E3.4b 提案，不擅自扩文件 |
| 安全扫描需真实 GitHub/ACR/网络，本地不可全验 | 高/高 | 本地只验结构/脚本/样本；真实首跑与分支保护列维护者；不宣称通过 |
| 生产镜像构建受 npmmirror/网络影响 | 高/高 | 不重建生产镜像；扫 ACR 已推送 digest；本地构建按 E2 归因流程；不修改 Dockerfile/锁 |
| 依赖 action SHA 过时/被撤回 | 低/中 | 固定 SHA 同时记录版本与来源；定期 dependabot 更新另立流程 |
| E2 staging 资源已清理，需重建 | 中/中 | 用 `deploy/staging/` 重建本机隔离栈；不触碰生产/开发实例；记录资源清单 |
| 全量门禁耗时长/网络依赖（test:ci、e2e、npm ci） | 中/中 | 分批跑、保留日志；失败区分代码/环境；不把环境失败记成代码失败 |
| 多 agent 并行写同一文件 | 中/高 | §3.4 所有权 + 任务板 write scope + Lead 最终 diff 审阅；共享文件单 owner 串行 |

---

## 10. 关闭标准映射

| 交接 §13 标准 | 工作包 | 证据 |
|---|---|---|
| 关键路径统一事件约定，request/run ID 贯穿 | E3.1/E3.2/E3.4 | 事件样例、请求矩阵、并发不串号、cron 事件 |
| 受控服务器异常可追踪，告警目录可执行 | E3.3 | 受控失败事件、过滤样例、告警目录 |
| DB/cron 可观察，公开健康不泄露，cron 不再依赖 web 健康 | E3.4 | 指标快照、未授权 401/403、cron 心跳/连续失败、staging compose 差异 |
| 生产 bootstrap 无默认口令路径，首次改密闭环+审计 | E3.5 | seed 拒绝矩阵、改密审计、启动检查、V1 遗留清单 |
| 登录失败治理通过边界/并发/绕过测试；单机不标生产完成 | E3.6 | 测试矩阵、代理头伪造、多实例限制说明 |
| PR/镜像安全扫描有正常与失败证据、政策与过期例外 | E3.7 | workflow 结构验证、受控失败、过期例外、artifact 配置；真实首跑待维护者 |
| E1 门禁通过、E2 主路径无回归 | 全包 | 批次 5 全量命令退出码、staging 冒烟、知识门禁 |
| DSH 自测后待 Codex 独立验收 | 全包 | 每包简报 + Codex 门记录；生产启用项列待决 |

---

## 11. 变更控制与升级规则

- **证据优先**：任何超出 §3 的修改先记录失败/缺口证据，形成范围变更提案（问题、证据、最小修复、影响、回退），交用户/Codex 确认后实施。
- **规则冲突**：触及业务规则、数据模型、API 契约或 ADR 时按 `CMS_and_WMS/AGENTS.md` 引用受影响 ID 并暂停依赖项，继续不受影响工作。
- **生产相关**：告警平台、限流参数、启动阻断、安全门禁 required 状态、生产 compose/部署配置由维护者/项目用户关闭；DSH 只提供本机/staging 证据与建议。
- **外部验证**：无法在本机完成的项（GitHub 首跑、ACR digest、远程 staging、外部平台投递）必须标注负责人与状态，不阻塞本机可验证项。
- **提交策略**：默认不提交不推送；提交拆分与顺序由用户在 E3 关闭时决定。

---

## 12. 确认后首批执行清单（批次 0–1）

1. 复核基线：`git -C CMS_and_WMS status --short --branch`、`git -C CMS_and_WMS log -5 --oneline`；确认只有交接文档未跟踪、HEAD 仍为 `65326e5`。
2. 记录环境快照：Node/npm、Docker/Compose、PG18 工具、端口占用（5432/55432 不触碰）、Playwright 浏览器、磁盘余量。
3. 建立证据目录 `docs/evidence/sprint-e3/logs/` 与四个包的 DSH 合同（精确文件、命令、证据、依赖）；在任务板登记 E3.1/E3.5 盘点/E3.7。
4. 启动批次 1：
   - E3.1：建 `src/lib/observability/**`、sink/redact/context、四个代表路径接入 + 测试；跑聚焦门禁；归档证据；交 Codex 验收。
   - E3.5：只读盘点（seed、改密页、proxy、V1 遗留、审计模型），产出盘点记录与实现合同，不写认证文件。
   - E3.7：建 security workflow/scripts/政策骨架与离线自检，完成受控样本。
5. 批次 1 结果交用户审阅；E3.1 验收通过后进入批次 2。
6. 每批次结束写简报段落（含命令/退出码/通过失败/跳过、残留风险、待决项、知识更新建议）；不 commit/push。

---

**本计划不含**：代码实现、迁移、生产配置、外部平台接入、Git 提交/推送。执行前需确认 §8 与待决清单；执行中遇到范围外需求按 §11 处理。
