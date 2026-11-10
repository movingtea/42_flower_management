# Sprint E3 DSH 交付简报（进行中）

2026-11-11。依据 [Sprint E3 交接](sprint-e3-dsh-handoff.md)、[Sprint E3 执行计划](sprint-e3-plan.md)、[待决清单](sprint-e3-open-decisions.md) 与 [跨包实现契约](evidence/sprint-e3/contracts.md)。本文件按工作包持续回填，批次 5 汇总。

**状态**：E3.1–E3.7 本机自测完成（DSH 自测通过，待 Codex 独立验收）；批次 5 全量门禁已执行至 `test:ci`，E1/E2 无回归；远程 staging、真实 registry digest、GitHub Actions 首跑仍未验证。

## 1. 开始基线

- 仓库 `CMS_and_WMS`，分支 `dev`，HEAD `65326e5`（Sprint E2 done），`dev...main/dev [ahead 5]`，未推送。
- 工作树开始仅 `docs/sprint-e3-dsh-handoff.md` 未跟踪；E3 新增计划/待决/契约/证据与实现文件。
- 环境：Windows、Node v24.14.0/npm 11.11.1、Docker 29.9.2/Compose v5.6.1、本机 PG18 工具在 PATH；不触碰原生 PG（5432）与 `flower-v2-pg`（55432）。
- E2 交付已提交于 `65326e5`（83 个证据文件）；本机保留镜像 `flower-e2-staging:9112ed3bfa46`、`flower-e05-verification:final`。

## 2. E3.1 · 结构化日志与运行上下文（本机完成）

新增 `src/lib/observability/{index,logger,redact,context,sink}.ts` + 4 个 `.vitest.ts`（60 tests 量级）。修改 `src/app/api/health/route.ts`、`src/auth.ts`、`scripts/cron-inventory-daemon.ts`、`src/v2/services/stocktake.ts`。

| 验收项 | 结果 | 证据 |
|---|---|---|
| 固定 schema/版本/级别/事件名；`Error` 序列化；循环/不可序列化不抛错 | 通过；JSON 行 v=1，事件名稳定；测试覆盖循环、BigInt、函数、symbol、sink 抛错 | [e31-redaction-and-failure-isolation](evidence/sprint-e3/logs/e31-redaction-and-failure-isolation-20261110-1638.log) |
| 敏感字段大小写无关、嵌套脱敏；测试证明值不出现 | 通过；password/authorization/cookie/token/secret/连接串等递归脱敏；后补 host:port/Prisma P1001/ECONNREFUSED 整段脱敏（E3.2 复核项） | 同上 + [e32-redaction-hostport](evidence/sprint-e3/logs/e32-redaction-hostport-20261110-1647.log) |
| 开发可读、测试可注入 sink、生产 stdout/stderr、日志失败不改变业务 | 通过；注入式 sink，默认按级别 stdout/stderr；序列化/sink 异常均被吞掉 | 同上 |
| 代表路径开始/成功/失败事件 | health（200/503、双库耗时）、auth 两 provider（HMAC 指纹、无明文）、cron（runId+耗时+安全 counts）、stocktake 确认边界（事务/抛错/审计未改） | [e31-representative-events](evidence/sprint-e3/logs/e31-representative-events-20261110-1638.log)、[e31-stocktake](evidence/sprint-e3/logs/e31-stocktake-20261110-1630.log) |
| 业务审计保持原样，不写运行日志进审计表 | 未改 `audit-helpers`/`AuditLog`/`AuditEvent` 语义 | 代码审阅 |

命令（`flower-wms-system`）：`npx next typegen` 0、`npx tsc --noEmit` 0、`npm run lint` 0（0 error/15 既有 warning）、`npm run test:unit` 0、`npm run test:integration:v2` 0。见 [e31-gates](evidence/sprint-e3/logs/e31-gates-20261110-1639.log)。

## 3. E3.2 · 请求 ID 与 HTTP 关联（本机完成）

新增 `src/lib/observability/request-id.ts`（+9 tests）与 `src/instrumentation.ts`（`register`：`service.started`，初始化 log context）；修改 `src/proxy.ts`、`src/app/api/health/route.ts`；matcher 最小新增 `/api/health`，`/api/auth/*`、`/api/miniprogram/*`、`/uploads/*`、静态资源保持不经过 proxy。

| 验收项 | 结果 | 证据 |
|---|---|---|
| 无入站 ID 生成、合法保留、非法/超长/控制字符替换 | 通过；8–64 字符白名单，非法替换 UUID；20 并发一一对应、20 无入站 ID 全唯一 | [e32-request-matrix](evidence/sprint-e3/logs/e32-request-matrix-20261110-1646.log) |
| API 响应含约定 header，日志同 ID | 通过；307/200/401/403/503 全分支 header 保留（Auth.js 重建 Response 后由外层统一挂头）；health 响应头=route log=health.check log | 同上、[e32-health-503](evidence/sprint-e3/logs/e32-health-503-20261110-1647.log) |
| matcher 排除构建/静态；现有状态码/重定向/缓存不变 | 通过；根 307、登录 200、/v2 307、admin API 401、health 200/503 与响应体不变；e2e 20 passed（1 个既有 controlled-failure 按设计 skip） | 同上、[e32-build-and-e2e](evidence/sprint-e3/logs/e32-build-and-e2e-20261110-1649.log) |
| request ID 不出现在指标标签/业务审计主键/授权判断 | 代码审阅通过；仅 header/日志关联使用 | [e32-gates-and-ownership](evidence/sprint-e3/logs/e32-gates-and-ownership-20261110-1650.log) |

已知边界：proxy 无法获知 pass-through 路由的最终状态码，因此 `http.request` 只记录 proxy 自产状态分支 + health；页面/pass-through 路由的完整状态与耗时不在 E3.2 覆盖内（E3.4 指标说明中记录）。

命令：`npx next typegen` 0、`npx tsc --noEmit` 0、`npm run lint` 0、`npm run test:unit` 0、`npm run build` 0（ƒ Proxy）、`npm run test:e2e` 0。tsconfig/next-env 生成改动已还原。

## 4. E3.5 · 默认密码与首次登录治理（本机完成）

| 验收项 | 结果 | 证据 |
|---|---|---|
| production seed 拒绝弱密码/缺失文件/test tier/默认凭据，错误不打印路径口令 | 通过；密码文件读取失败返回固定文案；拒绝矩阵 6 场景 exit 1 且输出无路径/口令/哈希；强密码初始化成功且 `mustChangePassword=true` | [e35-seed-missing-password-file](evidence/sprint-e3/logs/e35-seed-missing-password-file-20261110-163243.log) |
| bootstrap 管理员改密前只能访问改密/退出；改密撤销旧会话或下次授权重判；安全审计事件 | 通过；CAS 更新并检查 count，失败 signOut 不泄露状态；成功后写 `AuditEvent(V2_STAFF_PASSWORD_CHANGED)`（tenantId 由成员关系解析，快照仅状态）+ `auth.password.changed`；随后 signOut；旧 JWT 由 proxy 重定向 + 下次授权重读 DB 约束（无 tokenVersion，已记录） | [e35-unit-full](evidence/sprint-e3/logs/e35-unit-full-20261110-163818.log)、e35-integration |
| 启动检查识别默认凭据/未完成 bootstrap，按批准策略告警或拒绝 | 通过；只读检查，默认 warn exit 0、`block` exit 1；干净样例 ok；检查前后账号状态一致 | [e35-startup-warn](evidence/sprint-e3/logs/e35-startup-warn-20261110-163412.log)、[e35-startup-block](evidence/sprint-e3/logs/e35-startup-block-20261110-163440.log) |
| V1 遗留单列，不套 V2 规则 | 通过；V1 admin/admin、无 mustChangePassword、重置 ≥6、会话不回查 DB 均记录于文档 | [sprint-e3-credential-governance](sprint-e3-credential-governance.md) |

命令：`npx next typegen` 0、`npx tsc --noEmit` 0、`npm run lint` 0、`npm run test:unit` 0（vitest 7 文件 73 tests）、`npm run test:integration:v2` 0（33 files）。见 [e35-gates](evidence/sprint-e3/logs/e35-gates-20261110-163723.log)。

## 5. E3.6 · 登录限流与失败治理（本机完成）

新增 `src/lib/auth-security/{index,policy,keys,store,throttle}.ts` + 4 个 `.vitest.ts`（38 tests）；修改 `src/auth.ts` 两 provider 统一走 `guardCredentialsLogin`；新增混成测试 `src/v2/login-throttle.test.ts`。

| 验收项 | 结果 | 证据 |
|---|---|---|
| 账号 + 来源双维度有界速率；未知/错密/停用外部一致；成功只重置账号桶 | 通过；未知/错密/停用均返回 null，限流后统一抛 `CredentialsSignin` 子类（code=too_many_attempts）；成功仅清账号桶，保留来源历史 | [e36-integration-login-throttle](evidence/sprint-e3/logs/e36-integration-login-throttle-20261110-164709.log) |
| 不泄露账号存在性；日志用安全指纹 | 通过；账号/来源 key 均 HMAC 指纹，无明文用户名/IP | 同上 |
| 阈值边界/窗口恢复/成功登录/provider 切换/并发失败/代理头伪造/存储不可用 | 通过；含 12 并发失败、锁恢复、伪造 XFF（0 hops 忽略）、store 异常 fail-open/fail-closed、缺密码不计数；V1/V2 共用同一闸门 | 同上 + auth-security 单测 |
| 单实例内存有上限与清理；多实例列阻塞，不宣称生产完备 | 通过；Map 上限 + TTL + 淘汰；生产默认 `LOGIN_THROTTLE_ENABLED=false`，多实例共享存储列阻塞项 | [sprint-e3-plan](sprint-e3-plan.md) §8 |

命令：`npx next typegen` 0、`npx tsc --noEmit` 0、`npm run lint` 0、`npm run test:unit` 0（12 文件 125 tests）、`npm run test:integration:v2` 0（34 files）。见 [e36-unit-full](evidence/sprint-e3/logs/e36-unit-full-20261110-165106.log)、[e36-gates](evidence/sprint-e3/logs/e36-gates-20261110-165120.log)。E2E 未新增（默认关闭，既有登录 e2e 行为不变，记为未跑）。

## 6. E3.7 · 依赖、密钥与镜像安全门禁（本机结构与样本完成，真实首跑待维护者）

新增 `.github/workflows/security.yml`（独立 workflow；同仓 PR + dispatch；默认 `contents: read`；全部 `uses:` 固定 40 位 SHA）、`.github/security/{policy.yml,gitleaks.toml,trivy-ignore.yaml}`、`.github/dependabot.yml`、`scripts/security/{check-workflow-pins,check-exceptions,check-lockfile}.mjs` + lib + 34 fixtures、[sprint-e3-security-gates](sprint-e3-security-gates.md)；`deploy/staging/workflow-proposal.md` 仅追加 13 行。

| 验收项 | 结果 | 证据 |
|---|---|---|
| 锁文件依赖、secret、SBOM、运行镜像扫描均有固定版本工具/action，权限最小、SHA 固定 | 通过（结构/脚本层）；8 个 action 已用 git ls-remote/API 复核 tag→commit；PR 不构建/不拉生产镜像，镜像扫描走 dispatch 拉 ACR `:<sha>` | [e37-action-sha](evidence/sprint-e3/logs/e37-action-sha-verification-20261110-163122.log)、[e37-workflow-structure](evidence/sprint-e3/logs/e37-workflow-structure-20261110-163122.log) |
| 政策区分运行时/开发依赖、严重度、可利用性、修复可用性；例外含 ID/理由/负责人/到期日/补偿，过期失败 | 通过；受控 fixtures 逐一失败（过期、缺字段、未背书 ignore、过宽 allowlist 等 34 项） | [e37-exceptions](evidence/sprint-e3/logs/e37-exceptions-20261110-163122.log)、[e37-config-syntax](evidence/sprint-e3/logs/e37-config-syntax-20261110-163122.log) |
| 受控样本证明每类检查能失败；正常仓库不输出 secret | 通过；脚本自检/受控 fixtures 全部 0 退出；敏感扫描 56 文件 0 命中 | [e37-final-verification](evidence/sprint-e3/logs/e37-final-verification-20261110-163122.log)、[e37-sensitive-scan](evidence/sprint-e3/logs/e37-sensitive-scan-20261110-163122.log) |
| 扫描生产目标 stage；staging-offline 不替代 | 通过（设计）：镜像扫描拉 ACR 生产 Dockerfile 产物 `:<sha>`；不重建生产镜像（E2 已证容器内 npm ci 不可靠） | [e37-real-scan-deferred](evidence/sprint-e3/logs/e37-real-scan-deferred-20261110-163122.log)（明确 deferred 非 pass） |
| 发现漏洞只报告，不批量升级/重写锁文件 | 通过；锁文件 627/739 legacy mirror 仅 warning，未修改 | [e37-lockfile](evidence/sprint-e3/logs/e37-lockfile-20261110-163122.log) |

未验证（维护者）：真实 Actions 首跑、branch protection/required checks、Code Scanning 启用、ACR 只读拉取权限、Dependency graph、组织 GITLEAKS_LICENSE、网络白名单、fork PR 覆盖；真实 gitleaks/trivy/SBOM 未执行。

## 7. E3.3 · 错误追踪与告警契约（本机完成）

新增 `src/lib/observability/{error-classify,error-events}.ts` + 2 个 `.vitest.ts`（40 tests）；`src/instrumentation.ts` 追加 `onRequestError`；新增 `src/app/global-error.tsx`（client、自带 html/body、仅显示 digest 与通用提示）；`deploy/observability/{alert-rules.example.yaml,alert-delivery.example.yaml,README-ALERTS.md}` + `docs/sprint-e3-alert-catalog.md`。

| 验收项 | 结果 | 证据 |
|---|---|---|
| 捕获 Route Handler/Server Action/后台任务未处理异常，事件含环境/版本/request/run ID/稳定分组键/安全上下文 | Route Handler 真实 500 已捕获；action/render/proxy 同一 `onRequestError` 路径有单测；cron 失败由 E3.1/E3.4 事件负责（不产生 `error.server`）；事件含 env/version/requestId/route 模板/routeType/groupKey/安全 stack | [e33-system-error](evidence/sprint-e3/logs/e33-system-error-20261110-1709.log) |
| 过滤预期认证拒绝/校验失败/受控业务冲突，仍提供计数指标 | 通过；expected 只发 debug 级 `error.server{kind=expected}`、不投递；`wms_error_events_total{kind,reason}` 对 expected/system 均计数（由 E3.4 sink 映射，关闭“预期结果仍提供计数指标”） | [e33-error-contract](evidence/sprint-e3/logs/e33-error-contract-20261110-1710.log) |
| 受控失败产生可定位事件；事件无凭据/Cookie/请求体/DB URL；SDK 不可用时应用继续 | 通过；真实 500（V1 DB 指向关闭端口，临时 PG harness）产生 1 条脱敏 `error.server`，requestId 关联；`ERROR_EVENT_FAIL=1` 时仅 `error.delivery.failed`，500 响应与后续 `/login` 正常 | [e33-delivery-failure](evidence/sprint-e3/logs/e33-delivery-failure-20261110-1709.log)、[e33-sensitive-scan](evidence/sprint-e3/logs/e33-sensitive-scan-20261110-1712.log) |
| 告警目录覆盖 5xx 比率、关键任务连续失败、DB 不可用、备份失败、迁移失败、登录失败异常升高；含窗口/阈值占位/严重度/负责人/Runbook | 通过；6 条规则 + 6 个 Runbook 锚点，阈值/接收人/平台/保留期明确占位；PyYAML 结构校验通过（平台加载待维护者） | [e33-alert-rules](evidence/sprint-e3/logs/e33-alert-rules-20261110-1711.log)、[sprint-e3-alert-catalog](sprint-e3-alert-catalog.md) |

命令：`npx next typegen` 0、`npx tsc --noEmit` 0、`npm run lint` 0、`npm run test:unit` 0（178 tests）、`npm run build` 0。见 [e33-gates](evidence/sprint-e3/logs/e33-gates-20261110-1705.log)、[e33-build](evidence/sprint-e3/logs/e33-build-20261110-1706.log)。

## 8. E3.4 · 数据库、cron 与业务信号监控（本机完成）

新增 `src/lib/observability/metrics.ts`（+13→14 tests）、`src/app/api/admin/system/metrics/route.ts`、`src/v2/metrics-route.test.ts`（integration 发现）、`deploy/observability/metrics-catalog.md`；修改 health route（`recordDbProbe`/`recordHttpRequest`）、cron daemon（`CRON_HEARTBEAT_FILE` + `recordCronRound`）、staging compose（cron 心跳共享卷 + 最近成功时效 healthcheck，仅非生产）。

| 验收项 | 结果 | 证据 |
|---|---|---|
| 请求数/5xx/延迟分桶、V1/V2 探测成功与耗时、cron 最近成功与连续失败、登录失败、库存负数阻止 | 通过；指标名/标签严格按契约；登录失败/库存负数经日志 sink 映射；cron 进程记录轮次/最后成功/连续失败/心跳，web 指标入口在渲染前从共享心跳文件同步 cron 的最近成功与连续失败；expected/system 错误事件另计 `wms_error_events_total` | [e34-metrics-normal](evidence/sprint-e3/logs/e34-metrics-normal-20261110-1700.log)、[e34-cron-heartbeat](evidence/sprint-e3/logs/e34-cron-heartbeat-20261110-1701.log) |
| 入口默认不公开；未授权拒绝；响应不含库名/用户名/连接信息；采集失败不使业务请求失败 | 通过；`requirePermission("business:read")`、force-dynamic、no-store、Prometheus text；未登录 401、无权限 403、有权限 200；渲染异常只返回 500 并记事件 | 同上、e34-gates |
| cron 依据成功轮次，不复用 web health；受控停跑/连续失败可触发告警条件 | 通过；健康检查读取心跳最后成功时效（fresh=0/stale=1）；受控失败轮次 `consecutiveFailures=1` 且保留 lastSuccessAt；生产 compose 修改列维护者待办 | [e34-cron-heartbeat](evidence/sprint-e3/logs/e34-cron-heartbeat-20261110-1701.log) |
| staging 合成流量展示正常趋势与受控异常，保存脱敏输出与告警判断 | 通过（本机等价：`next dev` + 临时 PG harness，非 Docker staging）；6×health 200 正常趋势；6×health 503 受控异常 → 5xx/DB probe failure 计数与告警判断 | [e34-metrics-normal](evidence/sprint-e3/logs/e34-metrics-normal-20261110-1700.log)、[e34-metrics-controlled-failure](evidence/sprint-e3/logs/e34-metrics-controlled-failure-20261110-1701.log) |

命令：`npx next typegen` 0、`npx tsc --noEmit` 0、`npm run lint` 0、`npm run test:unit` 0（14 files/154 tests）、`npm run test:integration:v2` 0（35 files）、staging compose `config --quiet` 0。见 [e34-gates-and-scope](evidence/sprint-e3/logs/e34-gates-and-scope-20261110-1704.log)。

未覆盖（E3.4b 提案/维护者待办）：采购验收/订单确认/配送/成本重算失败无现有稳定挂点；全路由 pass-through 状态需响应层新挂点；多实例聚合、生产抓取网络/认证、连接池指标（能力缺口）、生产 compose 心跳修改。

## 9. 全量门禁与批次 5（执行记录）

在 `CMS_and_WMS/flower-wms-system`（除非注明）执行；日期 2026-11-11（UTC 2026-11-10）：

| 命令 | 结果 | 说明 |
|---|---|---|
| `npx next typegen` | 0 | 路由类型生成；生成文件 `next-env.d.ts` 已在结束后还原 |
| `npx tsc --noEmit` | 0 | 无类型错误 |
| `npm run lint` | 0 | 0 error / 15 个既有 warning |
| `npm run test:unit` | 0 | vitest 全过 + harness 自测 + DB-free unit 9 文件 |
| `npm run test:integration:v2` | 0 | 35 个 V2 integration 文件 |
| `npm run build` | 0 | 生产构建通过，`ƒ Proxy (Middleware)` 生效 |
| `npm run test:e2e` | 0 | 20 passed、1 个既有 controlled-failure 按设计 skip；约 3.3 分钟 |
| `npm run test:ci` | 0 | 全量回归：legacy 全套 + vitest（15 files/181 tests，含 E3 观测/认证/错误/指标测试）+ harness 自测 34 项 + 35 integration files + 4 smoke files；日志 `e3-final-test-ci-*` |
| `node scripts/check-knowledge-structure.mjs --json`（仓库根） | 0 | 65 markdown / 267 links，0 error |
| `node --test scripts/check-knowledge-structure.test.mjs` | 0 | 17/17 pass |
| `node scripts/security/check-workflow-pins.mjs` / `check-exceptions.mjs` / `check-lockfile.mjs` | 0/0/0 | 锁文件 legacy mirror 627/739 为已知 warning，未改锁文件 |
| `docker compose -f deploy/staging/compose/docker-compose.staging.yml config --quiet` | 0 | staging compose 合法（仅非生产） |

说明：本轮未执行 `npm ci`（node_modules 已存在、锁文件未改；容器内 `npm ci` 受 npmmirror/网络影响已在 E2 记录）。CI 的真实 `npm ci` 由 E1 PR workflow 覆盖，远程首跑仍待维护者。集成改动（E3.3 预期错误计数、E3.4 cron 心跳并入 web 指标）后已复跑 tsc/lint/test:unit/build/e2e；最终记录见 [e3-final-verification](evidence/sprint-e3/logs/e3-final-verification-20261110-1725.log)。

## 10. 残留风险与外部待办

- 外部平台、生产阈值、可信代理跳数、ACR/GitHub 首次运行、远程 staging 等见 [待决清单](sprint-e3-open-decisions.md)。
- E3.2 边界：pass-through 页面/路由最终状态与完整耗时不在 proxy 覆盖内；E3.4 指标只覆盖可采集部分。
- E3.3 边界：真实捕获只验证 Route Handler；action/render/proxy 为单测覆盖；外部平台/promtool 加载待维护者。
- E3.5 边界：无 tokenVersion/迁移，旧 JWT 非即时撤销；管理员重置 must-flag 保持现状。
- E3.6 边界：单实例内存实现；生产默认关闭；多实例共享存储、可信代理、阈值待批准；新增 e2e 未跑（默认关闭，既有登录 e2e 行为不变）。
- E3.7 边界：真实扫描/Actions 首跑/ACR 权限待维护者；“结构验证”不得表述为“扫描通过”。
- 指标 sink 在进程启动时由 instrumentation import 安装；多实例不聚合。

## 11. 与已批准知识/ADR 的偏差

- 未修改已批准业务规则、Prisma schema/迁移、V1 语义。
- 新增观测/安全约定属于实现层；建议 Codex 评审后形成 ADR-006 或知识更新提案（见计划 §7）。
- 测试文件命名从交接建议的 `logger.test.ts` 调整为 `*.vitest.ts`：因现有 runner 只发现该模式，避免测试被静默忽略（计划 §6.2，待 Codex 合同确认）。
- E3.4 在契约外补充 `wms_error_events_total{kind,reason}`（关闭 E3.3“预期结果仍提供计数指标”验收项）并让 web 指标入口从共享心跳文件同步 cron 状态，契约已同步。

## 12. 下一步

1. 收尾 `test:ci` 结果并回填本节；敏感信息复核与最终 diff 审阅。
2. 交 Codex 按 ADR-005 独立验收（至少 E3.1、E3.5、E3.6、最终集成）。
3. 维护者关闭外部待办；生产启用项（告警平台、限流参数、启动阻断、安全 required checks、远程 staging/ACR）另行批准。
4. 是否提交/推送由用户决定；建议按“观测代码+测试 / 认证代码+测试 / 安全 workflow+脚本 / 文档+证据”拆分。

