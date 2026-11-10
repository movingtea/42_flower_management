# Sprint E3 实现契约（跨包共享接口）

2026-11-11。本文件是 E3.1–E3.7 并行实现的共享契约，所有工作包必须遵守；偏离需先通知 Lead 并更新本文件。实现细节可调整，但**字段名、事件名、header 名、env 名、指标名**不得单方面改动。

## 1. 结构化日志（E3.1，`src/lib/observability/`）

- 导出模块：`logger.ts`、`redact.ts`、`context.ts`、`sink.ts`；`index.ts` 只做 E3.1 的 barrel，之后不再改（后续包按文件路径直接 import）。
- API（最小集）：

```ts
export type LogLevel = "debug" | "info" | "warn" | "error";
export interface LogEventInput {
  level: LogLevel;                 // 必填
  event: string;                   // 点分稳定事件名，必填
  fields?: Record<string, unknown>; // 递归脱敏后原样保留
  requestId?: string;              // 可由 context 自动补齐
  runId?: string;                  // 后台任务
  error?: unknown;                 // 序列化为 err
}
export function logEvent(input: LogEventInput): void; // 绝不 throw
export function createLogger(bindings?: Partial<Pick<LogEventInput, "requestId" | "runId">>): { logEvent(input: Omit<LogEventInput, "requestId" | "runId">): void };
export function setLogSink(sink: (record: Record<string, unknown>) => void): void; // 测试注入
```

- 序列化记录（一行一个 JSON，供默认 sink）：
  `{"v":1,"ts":"<UTC ISO>","level":"info","event":"cron.task.round","service":"flower-wms","env":"<NODE_ENV|APP_ENV|unknown>","version":"<APP_VERSION|GIT_SHA|unknown>","requestId":"<id，可选>","runId":"<id，可选>","fields":{...},"err":{"name":"Error","code":"...","message":"...","digest":"...","stack":"..."}}`
- `err` 只保留 `name/code/message/digest/stack`；stack 仅在 error 级别且 `LOG_STACKS !== "false"` 时输出，长度上限 8 KiB。`message` 也经过脱敏。
- 脱敏：键名大小写无关、忽略 `_`/`-` 后匹配 `password|passwd|pwd|pass|secret|token|authorization|cookie|setcookie|apikey|apisecret|dsn|connectionstring|databaseurl|privatekey|credential|credentials|authsecret`；字符串中出现 `postgres://`、`postgresql://`、`mysql://`、`redis://`、`Bearer <token>`、`Basic <token>` 整体替换 `[redacted]`。深度上限 6、对象键上限 100、数组上限 50，循环引用输出 `[circular]`；不可序列化值（bigint/function/symbol）安全字符串化。
- 默认 sink：`info/debug` → stdout，`warn/error` → stderr，JSON 行；开发环境（`NODE_ENV !== "production"` 且 `LOG_FORMAT !== "json"`）可输出人类可读行。sink 抛错时由 logger 捕获并降级，**不得改变业务结果**。
- 事件名白名单（新增需更新本契约）：
  - `service.started`：`{pid, nodeEnv}`
  - `http.health.check`：`{outcome:"success"|"failure", status:number, v1DurationMs:number|null, v2DurationMs:number|null, failedDb?: "v1"|"v2"|"both"}`
  - `auth.login.attempt`：`{outcome:"success"|"failure", provider:"legacy"|"v2", reason:"ok"|"missing_credentials"|"unknown_user"|"wrong_password"|"inactive"|"membership_denied"|"throttled"|"store_error"|"internal_error", accountFingerprint:string}`
  - `cron.worker.started`：`{pid, inventoryIntervalMs, orderExpiryIntervalMs}`
  - `cron.task.round`：`{task:"inventory-sync"|"order-expiry", outcome:"started"|"success"|"failure", durationMs:number, counts?:{affected?:number, scanned?:number}, reason?:string}`
  - `stocktake.confirm`：`{outcome:"started"|"success"|"failure", stocktakeId?:string, storeId?:string, reason?:"negative_stock"|"invalid_state"|"permission"|"conflict"|"internal"}`
  - `http.request`（E3.2）：`{method, route:"<Next route template，不含查询串>", status:number, durationMs:number}`
  - `error.server`（E3.3）：`{route, routeType:"render"|"route"|"action"|"proxy", errorName, errorCode?:string, groupKey:string, digest?:string}`
  - `error.delivery.failed`（E3.3）：`{adapter, reason}`
  - `auth.password.changed`（E3.5）：`{outcome:"success"|"failure", staffFingerprint:string, reason?:string}`
  - `auth.login.throttled`（E3.6）：`{provider:"legacy"|"v2", scope:"account"|"source"|"both", retryAfterSecondsBucket:0|15|60|300}`
  - `security.startup.check`（E3.5）：`{outcome:"ok"|"warn"|"blocked", findings:string[]}`
  - `metrics.render.failed`（E3.4）：`{reason}`
- 禁止记录：明文用户名、密码、密码哈希、Cookie、Authorization、请求头原文、完整 URL/查询串、请求体、数据库连接串、token、个人联系方式、第三方凭据。
- 账号指纹：`HMAC-SHA256(key = AUTH_SECRET || NEXTAUTH_SECRET || "e3-dev", normalizedUsername)` 取前 16 位 hex；不得可逆。实现位于 `redact.ts` 的 `fingerprintAccount`（normalize = trim + lowercase），E3.4/E3.6 直接复用，不得改签名或移动位置。
- 测试文件命名（E3 执行期确认）：能被现有 runner 发现的文件才有效——`*.vitest.ts`（vitest）、`src/v2/**/*.test.ts`（integration）、`src/app/v2/**/*.test.ts`（unit/integration）；`src/lib/**/*.test.ts` 不会被任何命令执行。交接建议的 `logger.test.ts` 因此改为 `logger.vitest.ts`。

## 2. request ID（E3.2）

- Header 名：`x-request-id`（请求与响应都使用）。
- 入站合法格式：`^[A-Za-z0-9._-]{8,64}$`；合法保留，非法/超长/控制字符替换；缺失时用 `crypto.randomUUID()`。
- 响应头：所有经过 proxy 的分支（200/302/307/401/403/503/JSON）都带 `x-request-id`；上游日志使用同一值。
- `src/lib/observability/request-id.ts` 导出：`REQUEST_ID_HEADER`、`isValidRequestId(value)`、`ensureRequestId(value?)`、`getIncomingRequestId(headers)`。
- `context.ts` 导出 `runWithLogContext({requestId?, runId?}, fn)` / `getLogContext()`（AsyncLocalStorage，Node runtime；不可用时返回 `{}`）。`logger` 自动合并 context 中的 requestId/runId。
- matcher：保留现有 10 条，最小新增 `/api/health`；不加入 `/api/auth/:path*`、`/api/miniprogram/:path*`、`/uploads/:path*`；排除 `_next/static`、`_next/image`、`favicon.ico`。HTTP 日志只记录 route template，不记录查询串。

## 3. 错误事件（E3.3）

- `src/lib/observability/error-classify.ts`：`classifyError(error, context): {kind:"expected"|"system", reason, code?}`。`expected` 至少覆盖：Auth.js `AuthError`/`CredentialsSignin`、`NEXT_REDIRECT`/`NEXT_NOT_FOUND` digest、`src/lib/business-errors.ts` 的稳定错误码、输入校验失败。
- `src/lib/observability/error-events.ts`：`buildErrorEvent(error, request, context)`（脱敏）、`deliverErrorEvent(event)`（本地 sink 默认写 stderr JSON 行；`ERROR_EVENT_FILE` 可指定文件；外部适配器通过 env 注入，失败只记 `error.delivery.failed`，绝不 throw）。
- 字段：环境、版本、requestId（从 request headers 取）、routePath（route template）、routeType、错误类别/稳定 code、groupKey=`<errorName>:<code|unknown>:<routePath>`、安全堆栈、digest。禁止 headers 原文、query、body、连接串。
- 受控失败：`ERROR_EVENT_FAIL=1` 时投递适配器抛错，应用继续运行并记录 `error.delivery.failed`（测试用）。

## 4. 指标（E3.4）

- 文件：`src/lib/observability/metrics.ts`；无外部依赖；进程内低基数。
- API：`recordHttpRequest({method,route,status,durationMs})`、`recordDbProbe({db:"v1"|"v2",outcome:"success"|"failure",durationMs})`、`recordCronRound({task,outcome,durationMs?,counts?})`、`recordLoginFailure({provider,reason})`、`recordBusinessFailure(signal)`、`renderMetrics(): string`（Prometheus text exposition）、`resetMetricsForTests()`、`installMetricsLogSink()`（把上述日志事件映射为指标，幂等）。
- 指标名与标签（不得新增高基数标签）：
  - `wms_http_requests_total{method,route,status_class}`
  - `wms_http_5xx_total{route}`
  - `wms_http_request_duration_ms_bucket{route,le}` / `_count` / `_sum`（buckets: 50,100,200,500,1000,2000,5000）
  - `wms_db_probe_total{db,outcome}`
  - `wms_db_probe_duration_ms_bucket{db,le}` / `_count` / `_sum`
  - `wms_cron_last_success_timestamp_seconds{task}`（gauge）
  - `wms_cron_consecutive_failures{task}`（gauge）
  - `wms_cron_rounds_total{task,outcome}`
  - `wms_login_failures_total{provider,reason}`
  - `wms_business_failures_total{signal}`，`signal ∈ {stock_negative_blocked, purchase_receive_failed, order_confirm_failed, delivery_failed, cost_recalc_failed}`
  - `wms_error_events_total{kind,reason}`，`kind ∈ {expected, system}`，`reason` 为 E3.3 分类器的固定枚举；expected 计数来自 debug 级 `error.server`，system 来自告警级 `error.server`（E3.3 AC“预期结果仍提供计数指标”）
- 入口：`src/app/api/admin/system/metrics/route.ts`，`export const dynamic = "force-dynamic"`，`requirePermission("business:read")`，未授权返回既有 401/403 语义，`Cache-Control: no-store`，`content-type: text/plain; version=0.0.4`；响应不得含库名、用户名、连接信息。
- cron 心跳：`scripts/cron-inventory-daemon.ts` 写心跳文件（路径 env `CRON_HEARTBEAT_FILE`，默认 `/tmp/flower-cron-heartbeat.json`），JSON `{updatedAt, tasks:{<task>:{lastSuccessAt, consecutiveFailures, lastRunAt, lastOutcome}}}`，只读/只写该文件。staging compose 用共享卷让 web 读取（`CRON_HEARTBEAT_FILE=/var/run/flower/cron-heartbeat.json`），受保护指标入口在渲染前调用 `syncCronHeartbeatFromFile()` 把 cron 的最近成功/连续失败并入快照；cron healthcheck 检查最近成功时效；生产 compose 不在范围。

## 5. 凭据/认证（E3.5/E3.6）

- 密码策略常量：`V2_BOOTSTRAP_PASSWORD_MIN_LENGTH=16`、`V2_STAFF_RESET_PASSWORD_MIN_LENGTH=8`（现状记录）；本 Sprint 保持行为不变，只集中命名与文档。
- 启动检查 env：`V2_CREDENTIAL_CHECK_MODE=warn|block`（默认 `warn`）；`security.startup.check` 事件；阻断时退出码非 0。检查只读，不修改账号。
- 审计 action 常量：`V2_STAFF_PASSWORD_CHANGED`；`AuditEvent` 必填 tenantId 先从 TenantMember/StoreMember 解析；快照不含哈希/口令。
- 限流 env（E3.6）：`LOGIN_THROTTLE_ENABLED=true|false`（默认 false；测试直接注入 config）、`LOGIN_THROTTLE_ACCOUNT_MAX`（默认 5）、`LOGIN_THROTTLE_ACCOUNT_WINDOW_MS`（900000）、`LOGIN_THROTTLE_ACCOUNT_LOCK_MS`（900000）、`LOGIN_THROTTLE_SOURCE_MAX`（20）、`LOGIN_THROTTLE_SOURCE_WINDOW_MS`（900000）、`LOGIN_THROTTLE_SOURCE_LOCK_MS`（900000）、`TRUSTED_PROXY_HOPS`（默认 0）、`LOGIN_THROTTLE_STORE_MAX`（10000）、`LOGIN_THROTTLE_STORE_TTL_MS`（3600000）、`LOGIN_THROTTLE_FAIL_OPEN`（默认 true）。
- 失败原因枚举与 `auth.login.attempt.reason` 一致；未知用户/错密/停用对外统一，日志可用内部枚举（不落明文）。
- 限流抛 `CredentialsSignin` 子类，`code = "too_many_attempts"`；登录页不新增差异化文案。

## 6. 测试与证据

- 测试文件命名必须可被现有 runner 发现：`*.vitest.ts`（vitest）、`src/v2/**/*.test.ts`（integration）、`src/app/v2/**/*.test.ts`（unit/integration）。禁止 `src/lib/**/*.test.ts`（不会被运行）。
- 证据：`docs/evidence/sprint-e3/logs/e3<包号>-<场景>-<run_id>.log`；只存脱敏摘要；失败样本与正常样本分开。
- 禁止：修改 Prisma schema/迁移、生产 compose/Dockerfile/既有 workflow、`package.json`/锁文件（除非 Lead 批准的依赖）、推送/提交 Git、写入真实密钥。

## 7. 文件所有权

- E3.1/2/3/4：`src/lib/observability/**` 由同一 owner 串行；`src/auth.ts` 在 E3.1 完成后才可由 E3.6 修改；`src/proxy.ts` 只 E3.2；`src/instrumentation.ts` E3.2 建、E3.3 追加（串行）。
- E3.5：`src/v2/password-policy.ts`、`src/v2/auth.ts`、`prisma/v2/seed*`、`src/app/account/v2-password/**`、`docker-entrypoint.sh`、`scripts/check-v2-credential-governance.mjs`、`docs/sprint-e3-credential-governance.md`；不改 `src/auth.ts`（留给 E3.6 与 E3.1）。
- E3.6：`src/auth.ts`、`src/lib/auth-security/**`、对应测试；不改 `src/proxy.ts`/登录页，除非 Lead 批准。
- E3.7：`.github/**`（仅新增 security/dependabot）、`scripts/security/**`、`docs/sprint-e3-security-gates.md`；不改既有 workflow。
