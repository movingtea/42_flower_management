# Flower WMS Sprint E3 告警目录（E3.3）

2026-11-11。本文件是 E3.3「错误追踪与告警契约」的可执行告警目录：每条信号给出数据源、窗口、
阈值占位、严重度、负责人占位与 Runbook。规则示例见
[`deploy/observability/alert-rules.example.yaml`](../deploy/observability/alert-rules.example.yaml)
与 [`deploy/observability/README-ALERTS.md`](../deploy/observability/README-ALERTS.md)。

**状态：占位 / 未启用。** 错误追踪平台、告警通知渠道、接收人、阈值、数据驻留与保留期均未获批；
带 `<...>` 的值为占位符，不得写入真实凭据或个人信息。真实值由维护者/项目用户提供后，才可把对应
信号标记为“已启用”。本 Sprint 只交付规则结构与本地可验证证据。

## 1. 约定与数据来源

- **阈值占位**：`<THRESHOLD_*>`。维护者提供前，规则不得进入生产告警通道。
- **严重度**：`critical`（立即处理）/ `warning`（当班处理）/ `info`（观察）。最终取值待批准；
  本文件给的是建议值。
- **负责人占位**：`<OWNER_PLACEHOLDER>`。每个信号必须有唯一 owner 与备份 owner（待维护者提供）。
- **通知渠道**：`<CHANNEL_PLACEHOLDER>`。平台未定，见 §6。
- **保留期**：`<RETENTION_PLACEHOLDER>`。按数据驻留与合规要求由维护者确定，见 §7。
- **数据源分层**：
  - 应用指标：E3.4 的 `/api/admin/system/metrics`（单进程内存态；多实例聚合待维护者）。
  - 结构化事件：E3.3 的 `error.server` / `error.delivery.failed`（stderr JSON 行或 `ERROR_EVENT_FILE`）。
  - E2 脚本与流水线：备份 `Backup-Staging.ps1`、迁移 `db:v2:migrate:deploy` 的退出码与证据输出。
- **禁止内容**：告警标签与通知正文不得包含 request ID、URL 查询串、请求体、Cookie/Authorization、
  明文用户名/密码、密码哈希、数据库连接串或第三方凭据；日志只允许安全账号指纹。

### 1.1 E3.3 错误事件契约（告警侧过滤依据）

`error.server` 事件的 JSON 行与 E3.1 日志同信封，字段固定：

```json
{"v":1,"ts":"<UTC ISO>","level":"error","event":"error.server","service":"flower-wms",
 "env":"<APP_ENV|NODE_ENV|unknown>","version":"<APP_VERSION|GIT_SHA|unknown>",
 "requestId":"<合法的 x-request-id，可缺失>",
 "fields":{"kind":"system","reason":"unclassified","route":"<Next 路由模板>",
           "routeType":"render|route|action|proxy|unknown","errorName":"...",
           "errorCode":"...","groupKey":"<errorName>:<code|unknown>:<route>",
           "digest":"<Next digest，可缺失>","stack":"<脱敏后的栈帧，可缺失>"}}
```

- 只有 `level=error` 的 `error.server`（即 `kind=system`）是**告警级**事件；
  预期错误（Auth.js 拒绝、`NEXT_REDIRECT`/`NEXT_NOT_FOUND` 控制流、`business-errors` 稳定码、
  非法 JSON 请求体）只产生 `level=debug` 的同名事件用于计数，**不得**接入告警规则。
- `error.delivery.failed` 表示本地/外部投递适配器故障，属于可观测性自监控；只允许形成低级别、
  带 `<CHANNEL_PLACEHOLDER>` 的自监控告警，绝不能替代业务告警，也不得导致应用失败。
- 告警规则如使用错误事件，只允许按 `groupKey` 聚类；`requestId` 仅用于人工排查关联，
  禁止作为指标标签或告警分组键。

## 2. 信号总览

| # | 信号 | 规则名 | 类型 | 窗口占位 | 阈值占位 | 严重度（建议） | Owner | Runbook |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | 5xx 比率 | `WmsHigh5xxRatio` | 指标比率 | `<WINDOW_5XX>` | `<THRESHOLD_5XX_RATIO>` | critical | `<OWNER_PLACEHOLDER>` | [rb-5xx-ratio](#rb-5xx-ratio) |
| 2 | 关键任务连续失败 | `WmsCronConsecutiveFailures` | 指标 gauge | `<FOR_CRON_CONSECUTIVE_FAILURES>` | `<THRESHOLD_CRON_CONSECUTIVE_FAILURES>` | critical | `<OWNER_PLACEHOLDER>` | [rb-cron-consecutive-failures](#rb-cron-consecutive-failures) |
| 3 | 数据库不可用 | `WmsDatabaseUnavailable` | 指标计数 | `<WINDOW_DB>` | `<THRESHOLD_DB_PROBE_FAILURES>` | critical | `<OWNER_PLACEHOLDER>` | [rb-db-unavailable](#rb-db-unavailable) |
| 4 | 备份失败 | `WmsBackupJobFailed` | 任务/日志 + 平台导出器（未定） | `<FOR_BACKUP_FAILED>` | `<THRESHOLD_BACKUP_MAX_AGE_SECONDS>` | critical | `<OWNER_PLACEHOLDER>` | [rb-backup-failed](#rb-backup-failed) |
| 5 | 迁移失败 | `WmsMigrationFailed` | 流水线/任务 + 平台导出器（未定） | `<WINDOW_MIGRATION>` | `<THRESHOLD_MIGRATION_FAILURES>` | critical | `<OWNER_PLACEHOLDER>` | [rb-migration-failed](#rb-migration-failed) |
| 6 | 登录失败异常升高 | `WmsLoginFailureSpike` | 指标速率 | `<WINDOW_LOGIN>` | `<THRESHOLD_LOGIN_FAILURES_PER_SECOND>` | warning | `<OWNER_PLACEHOLDER>` | [rb-login-failure-spike](#rb-login-failure-spike) |

> 表达式以 `deploy/observability/alert-rules.example.yaml` 为准；本表不重复完整 PromQL。

## 3. Runbook

### rb-5xx-ratio

**信号**：`sum(rate(wms_http_5xx_total[<WINDOW_5XX>])) / clamp_min(sum(rate(wms_http_requests_total[<WINDOW_5XX>])), 0.001) > <THRESHOLD_5XX_RATIO>`，持续 `<FOR_5XX_RATIO>`。
**数据源**：E3.4 `wms_http_5xx_total{route}` 与 `wms_http_requests_total{method,route,status_class}`；
E3.3 `error.server`（`level=error`）用于定位异常堆栈。
**严重度 / Owner / 渠道**：`<SEVERITY_5XX_RATIO>`（建议 critical）· `<OWNER_PLACEHOLDER>` · `<CHANNEL_PLACEHOLDER>`。
**步骤**：
1. 确认告警是否与发布/配置变更同一时间窗；记录 `env`/`version`。
2. 从受保护指标入口按 `route` 标签找出 5xx 集中的路由模板（禁止使用查询串或 ID）。
3. 取最近 `error.server` 事件：按 `groupKey` 聚类，按 `requestId` 关联同一请求的 `http.request` 日志；
   检查 `errorName`/`errorCode`/安全栈，判断是数据库、依赖、发布还是代码缺陷。
4. 命中已知维护窗口或受控演练时，按平台流程静默；否则按严重度升级并保留证据。
5. 恢复后确认 5xx 比率回落，记录根因与后续工作包。
**清理/验证**：在非生产环境用受控 5xx（如关闭数据库或注入错误，见 E3.3 证据）验证规则触发；
验证后删除测试告警/静默，确认无残留。

### rb-cron-consecutive-failures

**信号**：`max by (task) (wms_cron_consecutive_failures) >= <THRESHOLD_CRON_CONSECUTIVE_FAILURES>`，持续 `<FOR_CRON_CONSECUTIVE_FAILURES>`。
**数据源**：E3.4 cron 心跳（`CRON_HEARTBEAT_FILE`）与 `wms_cron_consecutive_failures{task}`；
`wms_cron_last_success_timestamp_seconds{task}` 用于判断停跑。cron 健康语义**不得**复用 web `/api/health`。
**严重度 / Owner / 渠道**：`<SEVERITY_CRON>`（建议 critical）· `<OWNER_PLACEHOLDER>` · `<CHANNEL_PLACEHOLDER>`。
**步骤**：
1. 确认 `task`（`inventory-sync` / `order-expiry`）与容器状态，检查 cron 容器退出码、重启次数与日志。
2. 读取心跳文件的 `lastSuccessAt`/`lastRunAt`/`lastOutcome`（只读；不含业务明细）。
3. 检查数据库探测、锁竞争、依赖与最近发布；若任务停跑，按 `<ESCALATION_PLACEHOLDER>` 升级。
4. 恢复后确认连续失败计数归零、最近成功时间更新；记录停跑时长与影响范围。
**清理/验证**：staging 用停跑/注入失败演示触发条件；验证后恢复任务并确认 gauge 归零，
不把测试心跳文件带入生产。

### rb-db-unavailable

**信号**：`sum by (db) (increase(wms_db_probe_total{outcome="failure"}[<WINDOW_DB>])) >= <THRESHOLD_DB_PROBE_FAILURES>`，持续 `<FOR_DB_UNAVAILABLE>`。
**数据源**：E3.4 `/api/health` 的 V1/V2 `SELECT 1` 探测（`wms_db_probe_total{db,outcome}`）。
公开健康接口只暴露整体状态；库名/用户名/连接信息只在受保护入口与 Runbook 内排查。
**严重度 / Owner / 渠道**：`<SEVERITY_DB>`（建议 critical）· `<OWNER_PLACEHOLDER>` · `<CHANNEL_PLACEHOLDER>`。
**步骤**：
1. 区分 V1/V2（`db` 标签），确认是单库故障还是整体网络/主机问题。
2. 检查数据库进程、磁盘、连接数、最近迁移与网络策略；不复制连接串到工单/聊天。
3. 若为迁移或配置变更导致，先按 E2 回滚/恢复计划处理；保留备份可用性信息。
4. 恢复后确认探测成功、`/api/health` 返回 `{"status":"ok"}`，记录故障窗口与影响。
**清理/验证**：staging 停止对应数据库演示触发条件；恢复后确认探测恢复、规则 resolved。

### rb-backup-failed

**信号**：最近成功备份超过 `<THRESHOLD_BACKUP_MAX_AGE_SECONDS>` 或备份任务失败。
E2 脚本成功时输出 `BACKUP_OK <set>` 并写 manifest；失败时把备份集移入 `failed/`、保留上一份有效
备份并以非零码退出。平台指标未定，暂以“任务退出码 / 日志 / 调度器状态”作为等价信号；
`<PLATFORM_EXPORTER_BACKUP_LAST_SUCCESS_METRIC>` 为待接入的导出器占位。
**严重度 / Owner / 渠道**：`<SEVERITY_BACKUP>`（建议 critical）· `<OWNER_PLACEHOLDER>` · `<CHANNEL_PLACEHOLDER>`。
**步骤**：
1. 确认失败的是 V1 还是 V2 备份集，查看 `failed/` 下的失败产物与证据摘要。
2. 确认上一份有效备份仍在且可读；**不得**删除上一份有效备份。
3. 检查磁盘空间、数据库连接、权限与备份脚本退出码；修复后重跑备份并验证 restore 演练记录。
4. 超过保留期未恢复时升级到 `<ESCALATION_PLACEHOLDER>`，并在恢复计划中标注风险。
**清理/验证**：staging 用受控失败（磁盘/权限/连接）验证失败路径与告警；恢复后重跑成功并清理测试产物。
**保留期**：`<RETENTION_PLACEHOLDER>`（备份与告警证据分别定义）。

### rb-migration-failed

**信号**：迁移步骤失败、存在未应用迁移或 `db:v2:migrate:deploy` 非零退出。
数据源：E2 部署/迁移流水线与 `prisma migrate status`；平台指标未定，
`<PLATFORM_EXPORTER_MIGRATION_FAILED_METRIC>` 为待接入的导出器占位。禁止在失败状态继续发布。
**严重度 / Owner / 渠道**：`<SEVERITY_MIGRATION>`（建议 critical）· `<OWNER_PLACEHOLDER>` · `<CHANNEL_PLACEHOLDER>`。
**步骤**：
1. 停止发布流程，记录目标环境、迁移名与退出码（不记录连接串）。
2. 确认备份可用与 `migrate status` 输出；按 E2 迁移/回滚计划决定前滚或回滚。
3. 修复后重新执行迁移验证（`db:v2:migrate:check` 等既有命令），确认无漂移。
4. 若影响生产数据，升级到项目用户与 `<ESCALATION_PLACEHOLDER>`，保留事件证据。
**清理/验证**：staging 用受控坏迁移镜像/脚本验证失败与阻断；恢复后清理测试迁移产物。

### rb-login-failure-spike

**信号**：`sum by (provider) (rate(wms_login_failures_total[<WINDOW_LOGIN>])) > <THRESHOLD_LOGIN_FAILURES_PER_SECOND>`，持续 `<FOR_LOGIN_SPIKE>`。
**数据源**：E3.4 `wms_login_failures_total{provider,reason}`（来自 E3.1 `auth.login.attempt` 失败事件）。
日志只含安全账号指纹；**禁止**在告警、工单或聊天中记录明文用户名/密码/来源 IP 原文。
**严重度 / Owner / 渠道**：`<SEVERITY_LOGIN>`（建议 warning）· `<OWNER_PLACEHOLDER>` · `<CHANNEL_PLACEHOLDER>`。
**步骤**：
1. 区分 provider（legacy/v2）与 `reason` 枚举，判断是用户集中输错、客户端问题还是暴力破解。
2. 检查是否有代理/网关异常、认证配置变更或依赖故障；必要时按安全事件流程升级。
3. 若确认攻击：按批准的限流/封禁策略处置（E3.6 生产参数待批准，不得自行在告警流程中改配置）。
4. 恢复后确认失败速率回落；记录时间窗与处置动作，不保留账号明文。
**清理/验证**：测试环境用受控失败登录验证速率规则；验证后清理测试账号与告警，不污染共享账号。

## 4. 待维护者提供（启用前置清单）

| # | 项 | 适用信号 | 当前值 | 状态 |
| --- | --- | --- | --- | --- |
| 1 | 错误追踪/告警平台与版本 | 全部 | `<PLATFORM_PLACEHOLDER>` | 待维护者提供 |
| 2 | 抓取/推送协议与网络（内网抓取、鉴权代理） | 1/2/3/6 | `<INGEST_PLACEHOLDER>` | 待维护者提供 |
| 3 | 5xx 比率阈值与窗口 | 1 | `<THRESHOLD_5XX_RATIO>` / `<WINDOW_5XX>` | 待维护者提供 |
| 4 | cron 连续失败阈值/窗口 | 2 | `<THRESHOLD_CRON_CONSECUTIVE_FAILURES>` / `<FOR_CRON_CONSECUTIVE_FAILURES>` | 待维护者提供 |
| 5 | DB 探测失败阈值/窗口 | 3 | `<THRESHOLD_DB_PROBE_FAILURES>` / `<WINDOW_DB>` | 待维护者提供 |
| 6 | 备份最大时效与失败判定来源 | 4 | `<THRESHOLD_BACKUP_MAX_AGE_SECONDS>` / `<PLATFORM_EXPORTER_BACKUP_LAST_SUCCESS_METRIC>` | 待维护者提供 |
| 7 | 迁移失败判定来源与窗口 | 5 | `<THRESHOLD_MIGRATION_FAILURES>` / `<PLATFORM_EXPORTER_MIGRATION_FAILED_METRIC>` | 待维护者提供 |
| 8 | 登录失败速率阈值/窗口 | 6 | `<THRESHOLD_LOGIN_FAILURES_PER_SECOND>` / `<WINDOW_LOGIN>` | 待维护者提供 |
| 9 | 严重度与升级路径 | 全部 | `<SEVERITY_*>` / `<ESCALATION_PLACEHOLDER>` | 待维护者提供 |
| 10 | 负责人 / 备份负责人 / 值班表 | 全部 | `<OWNER_PLACEHOLDER>` | 待维护者提供 |
| 11 | 通知渠道（Webhook/PagerDuty/Slack/邮件等） | 全部 | `<CHANNEL_PLACEHOLDER>` / `<RECEIVER_PLACEHOLDER>` | 待维护者提供 |
| 12 | 静默/抑制策略与维护窗口 | 全部 | `<SILENCE_PLACEHOLDER>` | 待维护者提供 |
| 13 | 数据驻留区域与访问控制 | 全部 | `<DATA_RESIDENCY_PLACEHOLDER>` | 待维护者提供 |
| 14 | 告警/事件/证据保留期 | 全部 | `<RETENTION_PLACEHOLDER>` | 待维护者提供 |
| 15 | 多实例指标聚合方式 | 1/2/3/6 | `<AGGREGATION_PLACEHOLDER>` | 待维护者提供（E3.4 单进程限制） |

## 5. 验证与清理

### 5.1 规则结构验证（本机可执行）

```text
# YAML 语法（Python + PyYAML）
python -c "import yaml,sys; [yaml.safe_load(open(p,encoding='utf-8')) for p in sys.argv[1:]]; print('YAML_OK')" deploy/observability/alert-rules.example.yaml deploy/observability/alert-delivery.example.yaml

# 占位符与必需字段扫描（只读文本检查）
#   每个 alert 必须包含：expr、for、severity、owner、runbook_url、signal
node -e "const fs=require('fs');const t=fs.readFileSync('deploy/observability/alert-rules.example.yaml','utf8');const names=[...t.matchAll(/-\s+alert:\s+(\S+)/g)].map(m=>m[1]);console.log('alerts='+names.length,names.join(','));"
```

`promtool check rules` 需要 Prometheus 工具链；本机当前未安装，因此“可被 Prometheus 加载”
属于外部集成待验证，不得报告为通过。

### 5.2 规则行为验证（外部平台 / 受控演练）

- 指标类信号：在 staging 用受控异常（停数据库、停 cron、注入 5xx、受控失败登录）触发一次，
  记录“趋势 + 规则判断结果 + 是否 resolved”。演练步骤参考 E3.3/E3.4 的受控失败证据。
- 备份/迁移信号：在隔离 staging 用受控失败脚本/坏迁移验证失败路径被捕获；不要触碰生产。
- 错误事件信号：确认 `level=debug` 的预期错误**不会**触发告警；`level=error` 的系统错误会。
- 每条验证记录写入 `docs/evidence/sprint-e3/logs/e33-alert-*.log`，只保留规则名、占位阈值、
  脱敏样例与判断结论。

### 5.3 清理

- 未启用：示例文件不被应用加载，可随时删除或忽略。
- 已启用：用平台静默/inhibit 覆盖维护窗口；测试告警必须带 `test=true` 等可检索标签，
  验证后删除或等待过期；删除指向真实接收人的测试路由。
- 证据与平台后台导出分离：证据只存脱敏摘要，不提交平台导出、真实 receiver、Webhook 或 DSN。
- 保留期到期后按维护者批准的 `<RETENTION_PLACEHOLDER>` 清理；清理前确认审计/合规要求。

## 6. 外部平台投递说明（平台未定）

- 默认关闭外部投递；E3.3 只提供本地适配器（stderr JSON / `ERROR_EVENT_FILE` 追加）。
- 平台可选形态（均未选定）：Prometheus + Alertmanager 自建、托管告警服务、SaaS 错误追踪
  （事件源为 `error.server` JSON）、日志平台告警（stderr 采集）。
- 无论选型如何，维护者必须提供：平台与版本、抓取/推送协议、规则与路由格式、接收人/值班表、
  数据驻留与保留期、静默/升级流程、访问控制与密钥管理方式。
- 真实 URL/token/DSN/Webhook 只放部署环境变量或平台密钥库，不进入仓库、日志与证据。
- 未接入平台期间，本目录只能标记为“规则示例与本地证据完成，外部集成待验证”。

## 7. 数据安全与保留期

- 告警规则、注解、分组键、通知正文：只允许规则名、固定枚举标签、路由模板、Runbook 链接与
  受控摘要；禁止 request ID 作为分组键、禁止业务 ID/用户名/错误原文/连接串。
- `error.server` 事件本身已按 E3.3 契约脱敏：不含请求头原文、查询串、请求体、数据库 URL、
  错误 message 首行与未脱敏栈；`x-request-id` 仅在通过 E3.2 格式校验后记录，用于关联。
- 平台侧保留期、数据驻留、访问审计：`<RETENTION_PLACEHOLDER>` / `<DATA_RESIDENCY_PLACEHOLDER>`，
  待维护者提供；在此之前不得把证据或事件复制到第三方后台。
- 本目录不包含真实阈值、接收人、平台 DSN 或任何凭据。
