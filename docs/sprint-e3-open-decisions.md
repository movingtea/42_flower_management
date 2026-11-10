# Sprint E3 待决清单（外部输入与批准项）

2026-11-11。本清单汇总交接已明确“需维护者/项目用户批准或提供”、且 DSH 无法自行决定的事项。未关闭前按 [Sprint E3 执行计划](sprint-e3-plan.md) §8 的默认值执行：外部集成默认关闭、生产参数保持保守或关闭、所有占位值不写真实值。关闭状态需记录决定人、日期与依据。

## 1. 可观测性外部平台（E3.3/E3.4）

| # | 事项 | 现状/仓库事实 | 默认（未批准前） | 需谁决定 |
|---|---|---|---|---|
| 1 | 错误追踪平台与 DSN | 无任何 SDK/DSN/配置；`package.json` 无 OpenTelemetry/pino | 只用本地 sink 与导出格式；外部投递关闭 | 项目用户 + 维护者 |
| 2 | 环境与版本命名 | 无运行时环境/版本字段约定；`Dockerfile`/`deploy.yml` 未注入源码 SHA | 字段为 `env`/`version`，缺失记 `unknown`；SHA 注入另立提案 | 维护者 |
| 3 | 告警通知渠道与接收人 | 无平台、无值班表 | `deploy/observability/` 只放占位与示例；接收人/渠道占位 | 项目用户 |
| 4 | 告警阈值 | 仓库无监控配置；本机合成数据不代表生产规模 | 阈值占位；staging 用测试值演示 | 项目用户 + 维护者 |
| 5 | 数据驻留与保留期 | 无定义 | 记录为待定；不投递外部数据 | 项目用户 |
| 6 | 指标入口访问角色 | `/api/admin/system/*` 属 `BUSINESS_API_PREFIXES`，IT_ADMIN 会被 proxy 403；`src/lib/rbac.ts` 不在 E3 允许路径 | 复用 `business:read`；IT_ADMIN 可读性记录为缺口 | 项目用户 + Codex |
| 7 | 备份/迁移失败信号来源 | E2 备份/迁移脚本有日志，但无统一事件/指标 | 告警目录引用 E2 日志字段；接入方式待定 | 维护者 |
| 8 | cron 生产监控方式 | 生产 compose 的 cron 无 healthcheck/volume，且不在 E3 允许路径 | staging 共享卷 + 心跳演示；生产修改列维护者待办 | 维护者 |
| 9 | 业务指标范围扩展 | 采购验收、订单确认、配送、成本重算的失败挂点文件不在 E3.4 允许路径 | 首轮只覆盖登录失败、库存负数阻止等现有可识别路径；其余另立 E3.4b 合同 | 项目用户 + Codex |
| 10 | 版本/源码 SHA 注入 | 运行时无 `GIT_SHA`/`APP_VERSION`；注入需改 deploy/compose | 读取 env，缺失 `unknown`；注入提案待批 | 维护者 |

## 2. 登录限流与可信代理（E3.6）

| # | 事项 | 现状 | 默认（未批准前） | 需谁决定 |
|---|---|---|---|---|
| 11 | 限流阈值、窗口、锁定时长、延迟策略 | 仓库零限流；无产品参数 | 测试配置验证机制；生产默认关闭/保守 | 项目用户 |
| 12 | 可信代理链与跳数 | 生产 nginx 用 `$proxy_add_x_forwarded_for`（最左段可伪造）；staging 无 nginx | 默认忽略 XFF（`TRUSTED_PROXY_HOPS=0`）；生产值待批 | 维护者 |
| 13 | 是否存在 CDN/多级代理 | 仓库只见单层 nginx 示例 | 按单层 nginx 假设设计，配置可扩展 | 维护者 |
| 14 | 多实例与共享存储 | 当前全部 compose 单副本；Next 文档不建议依赖 proxy 全局态 | 单实例内存实现仅本机/staging；多实例共享存储列为阻塞项 | 项目用户 + 维护者 |
| 15 | 限流生产启用状态 | 无 | 默认关闭；单机实现不得标“生产完成” | 项目用户 |

## 3. 凭据治理与首次登录（E3.5）

| # | 事项 | 现状 | 默认（未批准前） | 需谁决定 |
|---|---|---|---|---|
| 16 | 密码策略分叉：bootstrap/改密 16 位、人员重置 8 位、V1 重置 6 位 | `password-policy.ts` 与 `staff-management.ts:12`、V1 `staff-users.ts` 不一致 | 保持现状并在文档标注；不擅自收紧 | 项目用户 + Codex |
| 17 | 管理员重置是否置 `mustChangePassword=true` | `resetStaffPassword` 不置 must-flag | 保持现状；如需变更另立范围提案 | 项目用户 |
| 18 | 启动检查策略：告警 vs 拒绝启动 | 无启动检查；存量生产账号状态未知 | 默认高严重度告警、退出码 0；`FAIL_ON_INSECURE_BOOTSTRAP=true` 才阻断（需批准） | 项目用户 + 维护者 |
| 19 | 当前生产账号状态 | 无法从仓库确认生产库是否存在默认口令/未完成 bootstrap 账号 | 只读检查、不修改账号；生产结论由维护者核对 | 维护者 |
| 20 | 会话撤销要求 | JWT 无状态、无 tokenVersion/session 表；E3 不新增迁移 | 依赖“下一次授权重读 DB + proxy 重定向”并如实记录；tokenVersion 另立迁移提案 | 项目用户 + Codex |
| 21 | V1 遗留风险处置 | V1 `admin/admin`、无 mustChangePassword、重置 ≥6、会话不回查 DB | 只记录并提示，不修改 V1 schema/seed | 项目用户 |
| 22 | 生产 bootstrap 密码文件管理 | `seed.ts` 只接受 `V2_BOOTSTRAP_ADMIN_PASSWORD_FILE`；`.env.production.example` 未列该变量 | 不写真实值；发布手册/环境模板更新另行提案 | 维护者 |

## 4. 安全门禁与供应链（E3.7）

| # | 事项 | 现状 | 默认（未批准前） | 需谁决定 |
|---|---|---|---|---|
| 23 | security.yml 首跑与分支保护 | 仓库无 security workflow；无 required checks | 本地只验证结构/脚本/受控样本；真实首跑待维护者 | 维护者 |
| 24 | Code Scanning / SARIF 上传 | 无配置；仓库为 public | workflow 允许 SARIF 上传但不宣称已启用 | 维护者 |
| 25 | 镜像扫描来源与 ACR 权限 | `deploy.yml` 推 ACR `:<sha>`；E3 不修改它 | 从 ACR 拉取指定 digest 扫描（`workflow_dispatch`），需最小权限凭据；PR 只扫工作区/SBOM | 维护者 |
| 26 | 扫描工具与版本固定 | 无工具；候选：dependency-review v5.0.0、gitleaks v3.0.0/CLI v8.30.1、sbom-action v0.24.3、trivy-action v0.36.0（均已核对 tag→commit SHA） | workflow 内固定 40 位 SHA；本地不装二进制时只做结构/样本验证 | Codex + 维护者 |
| 27 | Dependabot 是否启用 | 无 `.github/dependabot.yml` | 建议采用（npm + actions + docker，周更分组） | 维护者 |
| 28 | 例外审批人与到期策略 | 无例外机制 | 例外必含 ID/理由/负责人/到期日/补偿；过期使检查失败；审批人占位 | 项目用户 + 维护者 |
| 29 | 工具链网络与 runner 白名单 | 需访问 npmjs、GitHub releases、ghcr.io（trivy DB） | CI runner 需可访问；本机不依赖外部扫描器完成验收 | 维护者 |
| 30 | 生产镜像构建可复现性 | 锁文件 627/739 条指向 npmmirror；E2 容器内 `npm ci` 失败；Dockerfile/锁文件不在 E3.7 允许路径 | 不重建生产镜像、不改 Dockerfile/锁文件；扫描 ACR 已推送产物；构建修复另立提案 | 维护者 |

## 5. 执行方式与交付（DSH 内部/Codex 确认）

| # | 事项 | 建议 | 影响 |
|---|---|---|---|
| 31 | 测试发现文件名调整：`logger.test.ts` → `logger.vitest.ts` 等 | 采用可被现有 runner 发现的后缀；不改 `package.json` 测试脚本 | 若不调整，E3.1 验收测试会被静默忽略（已由侦察确认） |
| 32 | E3.2 matcher 覆盖范围 | 最小新增 `/api/health`；不覆盖 `/api/auth/*`、`/api/miniprogram/*`、`/uploads/*`，行为保持不变并记录 | 决定 request ID 覆盖率与 Auth.js 回调风险 |
| 33 | E3.3 错误边界文件清单 | 只新增 `src/app/global-error.tsx`；不新增 per-route `error.tsx` | 避免改变现有页面错误 UI；需 Codex 确认 |
| 34 | E3.5 启动检查实现方式 | 独立脚本 + `docker-entrypoint.sh` 增加一行调用（交接“二选一”的落地解释） | 若 Codex 认为超出，可改为 entrypoint 内联 |
| 35 | 是否允许新增依赖 | 默认零新增；E3.3 SDK 需用户批准后才动 `package.json` | 影响实现方式与锁文件 |
| 36 | 是否提交/推送 | 默认不提交不推送；E3 关闭时由用户决定拆分提交 | 影响“可复查入口”的所在（本地工作区 vs 仓库） |
| 37 | staging 资源重建 | E2 资源已清理；用 `deploy/staging/` 重建本机隔离栈，不触碰生产/开发实例 | E3.4/E3.3 演练前提 |
| 38 | 各包 Codex 验收门 | 至少 E3.1、E3.5、E3.6、最终集成；E3.2 依赖 E3.1 验收 | 决定批次能否推进 |

## 6. 建议的执行前确认顺序

1. 先确认 #31–#38（与 DSH 执行方式、测试、范围直接相关），以便批次 1 立即启动。
2. 再确认 #11–#18（认证/限流/凭据默认值），E3.5/E3.6 实现前必须关闭。
3. #1–#10（外部平台/阈值/指标范围）可在 E3.3/E3.4 实现前关闭，缺失时按默认占位。
4. #23–#30（GitHub/ACR/供应链）不阻塞本地 E3.7 结构与样本验证，但阻塞“真实首次运行”结论。

## 7. 执行结果状态（2026-11-11）

E3.1–E3.7 已按计划完成 DSH 本机自测（见 [Sprint E3 交付简报](sprint-e3-evidence.md)）。以下为各待决项在执行期的落地方式：**未批准项一律按“占位/关闭/只记录”实现，不宣称生产启用**。

| 待决组 | 执行期落地 | 仍需谁关闭 |
|---|---|---|
| #1–#10 可观测性外部平台/阈值/指标范围/版本注入 | 本地 sink、告警目录与指标占位；外部投递默认关闭；指标入口复用 `business:read`；E3.4b 范围扩展未做 | 项目用户 + 维护者 |
| #11–#15 限流参数/可信代理/多实例 | 机制已实现并测试；生产默认 `LOGIN_THROTTLE_ENABLED=false`；`TRUSTED_PROXY_HOPS=0`；单实例内存实现有上限/TTL，多实例仍为阻塞项 | 项目用户 + 维护者 |
| #16–#22 密码策略/启动检查/会话撤销/V1 遗留 | 保持 16/8/6 现状并集中常量；启动检查默认 warn（block 需 env 与批准）；无 tokenVersion；V1 遗留只记录；改密审计已闭环 | 项目用户 + Codex + 维护者 |
| #23–#30 安全门禁/真实扫描/ACR/Dependabot/例外审批 | security.yml、dependabot、政策与离线校验已交付；真实 gitleaks/trivy/SBOM/Actions 首跑/ACR 拉取/required checks/Code Scanning 未执行，证据标明 deferred | 维护者 |
| #31 测试发现命名 | 已采用 `*.vitest.ts`（含 E3.1 `logger.vitest.ts`），未改 `package.json` 测试脚本 | Codex 合同确认 |
| #32 E3.2 matcher 覆盖 | 最小新增 `/api/health`；`/api/auth/*`、`/api/miniprogram/*`、`/uploads/*`、静态资源不覆盖且行为不变；证据矩阵已记录 | Codex 确认 |
| #33 E3.3 错误边界 | 仅新增 `src/app/global-error.tsx`；未新增 per-route error.tsx；`onRequestError` 真实捕获 Route Handler 已证，action/render/proxy 为单测覆盖 | Codex 确认 |
| #34 E3.5 启动检查实现 | 独立脚本 + `docker-entrypoint.sh` 迁移后调用；只读、默认 warn | Codex 确认 |
| #35 新增依赖 | 未新增任何依赖；`package.json`/锁文件未改 | — |
| #36 提交/推送 | 未 commit、未 push；工作区交付 | 用户 |
| #37 staging 资源 | 本机以临时 PG + `next dev`/build 做等价演练；未重建 Docker staging，未触碰生产/开发实例 | 用户（如需 Docker staging 复跑） |
| #38 Codex 验收门 | E3.1/E3.5/E3.6 及最终集成的 DSH 自测与证据已就绪，等待 Codex 独立复跑 | Codex |
| 执行期新增偏差 | E3.4 增加 `wms_error_events_total{kind,reason}`（关闭 E3.3 预期结果计数验收）；契约已同步 | Codex 评审 |

**未完成/需外部补证**：生产启用（告警平台投递、限流参数、启动阻断、安全 required checks）、真实 GitHub Actions/ACR/Code Scanning、远程 staging、真实依赖/镜像扫描。以上均不得表述为已验证通过。
