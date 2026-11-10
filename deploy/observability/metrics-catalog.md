# Flower WMS 运行指标目录（Sprint E3.4）

2026-11-11。本文件描述 E3.4 引入的进程内低基数指标、受保护抓取入口、cron 心跳与当前能力边界。
告警规则与投递不在本文件范围（见 E3.3 的 alert 文件）。

## 1. 抓取入口

| 项 | 值 |
| --- | --- |
| 路径 | `/api/admin/system/metrics` |
| 方法 | `GET` |
| 鉴权 | 复用 `requirePermission("business:read")`；未登录 401、无业务权限 403（既有 JSON 错误边界） |
| 响应 | `text/plain; version=0.0.4; charset=utf-8`，`Cache-Control: no-store` |
| 内容 | 仅指标文本；不含库名、用户名、连接串、请求 ID、查询参数或业务 ID |
| 抓取方 | 受保护的内网 Prometheus/staging 验证脚本；公开 `/api/health` 不承载指标 |

实现位置：`flower-wms-system/src/lib/observability/metrics.ts`、
`flower-wms-system/src/app/api/admin/system/metrics/route.ts`。

## 2. 指标与标签（低基数白名单）

| 指标 | 类型 | 标签 | 来源 |
| --- | --- | --- | --- |
| `wms_http_requests_total` | counter | `method`, `route`, `status_class` | health route 直调 + 日志 sink 映射 `http.request`（proxy 自产分支） |
| `wms_http_5xx_total` | counter | `route` | 同上（仅 5xx） |
| `wms_http_request_duration_ms_bucket/_count/_sum` | histogram | `route`, `le` | 同上，桶 `50,100,200,500,1000,2000,5000` |
| `wms_db_probe_total` | counter | `db`（v1/v2）, `outcome`（success/failure） | health route `recordDbProbe` |
| `wms_db_probe_duration_ms_bucket/_count/_sum` | histogram | `db`, `le` | 同上 |
| `wms_cron_last_success_timestamp_seconds` | gauge | `task`（inventory-sync/order-expiry） | cron daemon `recordCronRound` + 心跳文件 |
| `wms_cron_consecutive_failures` | gauge | `task` | 同上 |
| `wms_cron_rounds_total` | counter | `task`, `outcome`（started/success/failure） | 同上 |
| `wms_login_failures_total` | counter | `provider`（legacy/v2）, `reason`（既有稳定枚举） | 日志 sink 映射 `auth.login.attempt` 失败 |
| `wms_business_failures_total` | counter | `signal`（固定枚举） | 日志 sink 映射 `stocktake.confirm` 的 `negative_stock` |

标签规则：

- `route` 只接受以 `/` 开头的路由模板；查询串、动态 ID 之外的非白名单字符替换为 `_`，超长截断。
- 方法只允许 `GET/HEAD/POST/PUT/PATCH/DELETE/OPTIONS`，其他记为 `OTHER`；状态类只允许 `1xx..5xx`。
- 未知 `signal` 直接忽略；`reason` 净化后最长 64 字符。
- 单进程最多 5000 条序列，达到上限后丢弃新序列，防止异常输入造成内存增长。
- request ID、订单/批次/员工 ID、URL 查询串、错误原文、用户名/邮箱一律不得作为标签。

## 3. 事件 → 指标映射（日志 sink）

`metrics.ts` 首次被 web/cron 进程导入时幂等安装日志 sink 包装：先映射指标，再把记录交给原 sink
（stdout/stderr 输出不变）。映射范围：

- `http.request` → `wms_http_requests_total`/5xx/延迟；`/api/health` 由路由直调，跳过以避免重复计数。
- `auth.login.attempt` 且 `outcome=failure` → `wms_login_failures_total`（用指纹事件中的 provider/reason）。
- `stocktake.confirm` 且 `outcome=failure`、`reason=negative_stock` → `wms_business_failures_total{signal="stock_negative_blocked"}`。
- `http.health.check`、`cron.task.round` 由生产者直调对应 `record*`，sink 不重复计数。

指标采集/渲染异常被隔离：`logEvent` 与 sink 包装都捕获异常，业务请求与日志写入结果不变。

## 4. cron 心跳

- 文件路径：env `CRON_HEARTBEAT_FILE`，默认 `/tmp/flower-cron-heartbeat.json`。
- 写入：每轮任务完成后写 `{updatedAt, tasks:{<task>:{lastSuccessAt, consecutiveFailures, lastRunAt, lastOutcome}}}`；
  启动时尽力读取旧文件以延续连续失败计数；写失败不影响轮询与退出语义。
- 读取：staging compose 通过共享卷 `/var/run/flower/cron-heartbeat.json` 让 web 与 cron healthcheck 共享；
  cron healthcheck 以“最近成功时间 < 30 分钟”为 healthy 条件，不再复用 web `/api/health`。
- 生产 compose 的同构修改不在 E3.4 允许路径，列为维护者待办。

## 5. 已知边界（不得宣称生产完备）

- 指标是**单进程内存态**：多实例/多副本不会自动聚合；需要共享存储或 Prometheus 侧聚合，
  该工作与生产抓取网络、认证代理链一并列为维护者待办。
- Prisma adapter/`pg` 组合无法稳定读取连接池指标，按交接记为能力缺口；不 monkey patch。
- proxy 无法获知 pass-through 路由的最终状态码，因此 HTTP 指标目前覆盖 readiness 端点与 proxy
  自产分支；全路由覆盖需在后续工作包调整响应层（E3.4b 提案）。
- 无现有可识别挂点的业务信号（采购验收失败、订单确认失败、配送失败、成本重算失败）
  列为 E3.4b 范围扩展提案，不在本包擅自扩大文件范围。
