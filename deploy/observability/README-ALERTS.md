# Flower WMS 告警规则与投递说明（Sprint E3.3）

2026-11-11。本目录存放 E3.3 的**告警规则示例**与**投递说明**。规则本身未绑定平台、未在生产启用；
可执行目录（信号 → 窗口 → 阈值占位 → 严重度 → 负责人占位 → Runbook）见
[`docs/sprint-e3-alert-catalog.md`](../../docs/sprint-e3-alert-catalog.md)。

同目录的 [`metrics-catalog.md`](metrics-catalog.md) 是 E3.4 的指标目录（指标名、标签、抓取入口与
能力边界），本文件的规则表达式引用其中的指标名。

## 1. 文件

| 文件 | 作用 | 状态 |
| --- | --- | --- |
| [`alert-rules.example.yaml`](alert-rules.example.yaml) | 6 类信号的 Prometheus 风格告警规则示例 | 示例；阈值/窗口/严重度/负责人为占位 |
| [`alert-delivery.example.yaml`](alert-delivery.example.yaml) | 严重度 → 接收渠道的路由/抑制示例（Alertmanager 风格） | 示例；平台与接收人未定 |
| [`README-ALERTS.md`](README-ALERTS.md) | 本说明 | — |
| [`../../docs/sprint-e3-alert-catalog.md`](../../docs/sprint-e3-alert-catalog.md) | 可执行告警目录与 Runbook 索引 | 占位值集中在“待维护者提供”表 |
| [`metrics-catalog.md`](metrics-catalog.md) | E3.4 指标目录（本包不修改） | 已由 E3.4 提供 |

## 2. 告警信号与规则对应

| # | 信号 | 规则名 | 数据源 | Runbook |
| --- | --- | --- | --- | --- |
| 1 | 5xx 比率 | `WmsHigh5xxRatio` | `wms_http_5xx_total` / `wms_http_requests_total`（E3.4） | [rb-5xx-ratio](../../docs/sprint-e3-alert-catalog.md#rb-5xx-ratio) |
| 2 | 关键任务连续失败 | `WmsCronConsecutiveFailures` | `wms_cron_consecutive_failures{task}`（E3.4 + cron 心跳） | [rb-cron-consecutive-failures](../../docs/sprint-e3-alert-catalog.md#rb-cron-consecutive-failures) |
| 3 | 数据库不可用 | `WmsDatabaseUnavailable` | `wms_db_probe_total{db,outcome}`（E3.4，`/api/health` 探测） | [rb-db-unavailable](../../docs/sprint-e3-alert-catalog.md#rb-db-unavailable) |
| 4 | 备份失败 | `WmsBackupJobFailed` | E2 备份脚本（`BACKUP_OK`、`failed/`、非零退出）经平台导出器/日志；**指标未定** | [rb-backup-failed](../../docs/sprint-e3-alert-catalog.md#rb-backup-failed) |
| 5 | 迁移失败 | `WmsMigrationFailed` | E2 迁移/部署流水线（`db:v2:migrate:deploy` 退出码、migrate status）；**指标未定** | [rb-migration-failed](../../docs/sprint-e3-alert-catalog.md#rb-migration-failed) |
| 6 | 登录失败异常升高 | `WmsLoginFailureSpike` | `wms_login_failures_total{provider,reason}`（E3.4；日志只含账号指纹） | [rb-login-failure-spike](../../docs/sprint-e3-alert-catalog.md#rb-login-failure-spike) |

补充信号（不强制告警，供接入平台后选配）：E3.3 的 `error.server` 结构化事件（stderr JSON 行 /
`ERROR_EVENT_FILE`）可作为错误追踪平台的事件源；`error.delivery.failed` 表示投递适配器异常，
只应形成低级别自监控告警，不应替代业务告警。平台未定前不新增规则，避免与维护者选型冲突。

## 3. 外部平台投递（平台未定，全部占位）

错误追踪平台、DSN、告警通知渠道、接收人、数据驻留与保留期均未批准。在维护者给出这些值之前：

- **默认关闭外部投递**。E3.3 只使用本地适配器：默认 stderr 一行 JSON；`ERROR_EVENT_FILE` 指定文件时追加。
  外部 SDK 不安装、不联网、不写真实 DSN。
- `alert-rules.example.yaml` 与 `alert-delivery.example.yaml` 中的 `<...>` 是唯一允许的真实值入口；
  真实 URL/token/Webhook 只放部署环境变量或平台密钥库，不进入仓库、日志或证据。
- 平台选型需要维护者提供：平台名称与版本、抓取/推送协议、告警规则格式、路由与抑制策略、
  接收人/值班表、静默与升级流程、数据驻留区域、保留期与访问控制。
- 未接入平台时，`docs/sprint-e3-alert-catalog.md` §5 的“待维护者提供”表是启用前的检查清单；
  表中任一项为空即视为“外部集成待验证”，不得标记为已启用或生产完备。

### 3.1 若选择 Prometheus + Alertmanager

1. 由受保护的内网 Prometheus 抓取 `/api/admin/system/metrics`（鉴权方式见 metrics-catalog §1）。
2. 将 `alert-rules.example.yaml` 的占位符替换为维护者批准的阈值/窗口，放入平台的 rules 目录。
3. 将 `alert-delivery.example.yaml` 改写为实际的 receivers/routing；真实密钥走平台密钥库。
4. 先以 `severity=info` 或静默方式观察 1 个发布周期，确认误报率后再提升严重度。

### 3.2 若选择 SaaS 错误追踪/告警平台

- 事件源可用 `ERROR_EVENT_FILE` 采集的 JSON 行（字段与环境/版本/requestId/routeType/groupKey 稳定）。
- 平台侧把 `groupKey` 作为分组指纹，`requestId` 只用于关联查询，不进入指标标签或分组键。
- 需要维护者确认：数据驻留、PII 策略、采样率、保留期、平台告警规则格式与通知渠道。

## 4. 校验方式

```text
# YAML 语法（本机有 Python + PyYAML 时；无平台工具也可执行）
python -c "import yaml,sys; [yaml.safe_load(open(p,encoding='utf-8')) for p in sys.argv[1:]]; print('YAML_OK')" deploy/observability/alert-rules.example.yaml deploy/observability/alert-delivery.example.yaml

# 有 Prometheus 工具链时（本机当前未安装，属平台待办）
promtool check rules deploy/observability/alert-rules.example.yaml
```

规则语义校验（6 类信号齐全、每条含窗口/阈值占位/严重度/负责人占位/runbook 链接）在
`docs/sprint-e3-alert-catalog.md` §4 以清单形式给出；E3.3 证据 `e33-alert-rules-*.log`
记录 YAML 解析结果与占位符扫描结果。**promtool 未在本机安装**，因此“规则可被 Prometheus 加载”
属于外部集成待验证，不得报告为已通过。

## 5. 清理与停用

- 未启用前：删除或忽略本目录示例即可，不影响应用运行（告警文件不被应用加载）。
- 已接入平台后：用平台静默/inhibit 处理已知维护窗口；测试告警必须带 `test=true` 标签，
  验证后按平台流程删除或等待其自动过期；不要在仓库里留下指向真实接收人的测试配置。
- 证据中的告警样例只保留规则名、占位阈值与判断结果，不保留平台后台导出、真实 receiver 或 webhook。
