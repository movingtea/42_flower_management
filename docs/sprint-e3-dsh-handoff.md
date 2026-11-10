# Flower WMS Sprint E3 · 可观测性与安全交接

交接日期为 2026-11-11。仓库为 `CMS_and_WMS`，基线为 `dev` 上的 `65326e5`（Sprint E2 done）。交接盘点时 Git 工作树干净。E3 沿用原始范围：结构化日志、错误追踪与告警、请求 ID、数据库和 cron 监控、默认密码治理、登录限流、依赖与镜像安全扫描。

## 1. DSH 接手步骤

1. 在 `D:/My-project/flower-studio-ecosystem` 工作。先读根目录、`CMS_and_WMS` 和 `CMS_and_WMS/flower-wms-system` 的 `AGENTS.md`，再读 [知识索引](../knowledge/00-Home/E0-knowledge-index.md)、[ADR-004](../knowledge/05-ADR/ADR-004-agent-knowledge-governance.md)、[ADR-005](../knowledge/05-ADR/ADR-005-codex-dsh-responsibilities.md)、[E2 证据](sprint-e2-evidence.md)和 [E2 待决清单](sprint-e2-open-decisions.md)。
2. 运行 `git -C CMS_and_WMS status --short --branch` 和 `git -C CMS_and_WMS log -5 --oneline`，记录实际基线与既有差异。不要覆盖其他会话产生的文件。
3. 每个工作包建立独立、稳定的 DSH task ID。开始前再次收窄 `allowed_paths`。不同任务不能同时修改同一路径。每包完成后提交改动清单、自测命令、退出码、日志样例、失败证据和 DSH session ID，等待 Codex 独立验收。
4. 第一批执行 E3.1。E3.2 依赖 E3.1。E3.3 和 E3.4 依赖前两包的事件与关联字段。E3.5、E3.6 可以在认证文件所有权不重叠时并行分析，写入阶段串行。E3.7 可独立实现。

DSH 不得推送、合并、发布、修改云端设置或读取密钥。不得把请求头、Cookie、口令、密码哈希、数据库连接串、Auth.js token、个人联系方式或第三方凭据写入日志、指标、错误追踪或测试证据。生产告警接收人、错误追踪平台、通知渠道、阈值和数据保留期没有批准前保持可配置，并在交付中列为待决项。

## 2. 当前基线

| 能力 | 已有实现 | E3 缺口 |
| --- | --- | --- |
| 健康检查 | `/api/health` 同时执行 V1、V2 `SELECT 1`，E2 staging 有 web 健康与 cron 成功轮次验证 | 只有整体状态，没有组件耗时、连接池或最近 cron 成功时间；cron 容器不能使用 web HEALTHCHECK |
| 日志 | 应用、脚本和 cron 广泛使用 `console.*`，Docker 有日志输出 | 字段、级别、脱敏、请求关联和环境元数据不统一 |
| 业务审计 | V1 `AuditLog` 与 V2 `AuditEvent` 已记录业务写入证据 | 业务审计不能替代运行日志；不得混合两种保留和访问目的 |
| 管理员初始化 | V2 production seed 只接受密码文件，执行强度校验，已有 `mustChangePassword` / bootstrap session 语义 | 需要核对强制改密是否覆盖全部入口、首次改密审计、启动检查和旧账号风险；V1 仍并存 |
| 登录安全 | Auth.js JWT 会话 12 小时，V1/V2 Credentials provider 已拒绝无效或停用账号 | 没有跨实例可靠的失败计数、限流、延迟或锁定策略，也没有失败率指标 |
| 发布与恢复 | E2 本机 staging、备份恢复、迁移验证和回滚已完成 | 远程 staging、真实 registry digest、生产监控和告警仍待接入 |
| 安全检查 | PR workflow 已执行 lint、类型、测试、构建和知识检查 | 依赖漏洞、secret 检测、容器/镜像扫描、SBOM 和扫描结果处置尚未纳入门禁 |

## 3. 共用设计约束

- 日志与指标使用稳定、低基数的字段。禁止把订单 ID、用户名、URL 查询参数、任意错误文本或 request ID 当作指标标签。request ID 只用于日志与错误事件关联。
- 接受可信、格式合法的入站 request ID，或生成新的 ID。响应回传同一 ID。对客户端提供的值设置长度和字符白名单，不能用它做授权或幂等键。
- HTTP 日志至少含 UTC 时间、级别、事件名、服务、环境、版本或源码 SHA、request ID、方法、规范化路由、状态码和耗时。后台任务日志至少含 run ID、任务名、开始/完成/失败、耗时和安全的计数。
- 错误输出保留错误类别、稳定错误码和安全堆栈。数据库约束值、SQL 参数、连接信息和用户输入默认脱敏。客户端响应继续使用现有安全错误边界，不能暴露内部堆栈。
- 健康检查继续用于存活或就绪判断。指标和诊断采用独立、受保护的入口，不能让公开健康接口泄露拓扑、版本、库名、容量或任务细节。
- V1/V2 数据库、认证源和审计模型继续隔离。不得修改库存、预留、权限、事务或业务审计语义。新增持久化模型必须先提交 Prisma 设计和迁移计划，不得直接生成迁移。
- E3 的外部集成默认关闭。缺少 DSN、告警渠道或云权限时，本地可验证事件适配器、导出格式和受控失败，外部投递标为待维护者验证。

**本 Sprint 非目标**：不执行生产部署，不更改已批准业务规则，不退役 V1，不重构全部历史 `console.*`，不把业务审计表改造成日志库，不批量升级依赖，不自动修复扫描漏洞，不引入数据库迁移，除非对应工作包先取得 Codex 对数据模型设计和迁移计划的验收。

**已知基线限制**：E2 的远程 staging、真实 registry digest 和 GitHub 首跑尚未验证；本机构建曾受 lockfile 中 npmmirror 下载地址和网络 `ECONNRESET` 影响；cron 容器继承 web HEALTHCHECK 时会显示 unhealthy；生产 PostgreSQL 卷与版本、备份参数、告警平台、通知渠道和登录限流生产参数仍待维护者或用户确认。这些限制不能被报告成 E3 代码缺陷，也不能被“跳过”当作通过。

下列 `允许路径` 是各包的最大边界。派发每个 DSH task 前，负责人必须把它进一步转换为 ADR-005 合同，列出本轮实际会修改的精确文件。目录级新建范围只允许放置该工作包直接需要的文件。

## 4. E3.1 · 可观测性基础与结构化日志

**Task ID** `e31-observability-core`

**结果** 建立服务端通用的结构化日志、字段脱敏和后台任务运行上下文，先迁移健康检查、认证、cron 和一个 V2 核心服务作为代表路径。

**允许路径**

- `flower-wms-system/src/lib/observability/**`（新增）
- `flower-wms-system/src/app/api/health/route.ts`
- `flower-wms-system/src/auth.ts`
- `flower-wms-system/scripts/cron-inventory-daemon.ts`
- `flower-wms-system/scripts/cron-inventory-daemon.ts`，该入口同时运行库存与订单过期任务
- `flower-wms-system/src/v2/services/stocktake.ts`
- `flower-wms-system/src/v2/services/stocktake.test.ts`
- `flower-wms-system/src/lib/observability/logger.test.ts`（新增）
- `flower-wms-system/package.json`、`package-lock.json` 仅在现有依赖无法满足时开放

**范例**

- `flower-wms-system/src/app/api/health/route.ts`：动态 Route Handler 与双库检查边界
- `flower-wms-system/src/lib/audit-helpers.ts`：服务端辅助函数、错误隔离和现有命名风格
- `flower-wms-system/scripts/cron-inventory-daemon.ts`：cron 生命周期与退出语义
- `flower-wms-system/src/v2/services/stocktake.ts`：V2 服务错误和事务边界

**验收标准**

- JSON 行日志可解析，固定 schema 有版本。日志级别和事件名可测试，`Error` 可序列化，循环对象或不可序列化值不会使业务操作失败。
- 对 password、authorization、cookie、token、secret、连接串及嵌套同类字段做大小写无关脱敏。测试证明敏感值没有出现在序列化结果。
- 开发环境仍便于阅读，测试可注入内存 sink，生产默认写 stdout/stderr，日志失败不得改变业务事务结果。
- 代表路径输出开始、成功和失败事件。业务审计写入保持原样，不把运行日志写入审计表。

**验证**

```text
npx next typegen
npx tsc --noEmit
npm run lint
npm run test:unit
npm run test:integration:v2
```

## 5. E3.2 · 请求 ID 与 HTTP 关联

**Task ID** `e32-request-correlation`

**结果** 所有适用的 Next.js 请求具有经过校验的 request ID，响应和服务端日志可据此关联，同时保持 Auth.js、静态资源和现有路由行为。

开始前阅读应用安装版本的 `node_modules/next/dist/docs/`，核对 Next.js 16 中 proxy、Route Handler 和 instrumentation 的当前约定。若 E3.1 尚未验收，只做设计和测试盘点，不写共用日志文件。

**允许路径**

- `flower-wms-system/src/proxy.ts`
- `flower-wms-system/src/instrumentation.ts`（若采用且符合当前 Next.js 文档）
- `flower-wms-system/src/lib/observability/**`
- `flower-wms-system/src/app/api/health/route.ts`
- 与 request ID 直接对应的测试

**范例**

- `flower-wms-system/src/proxy.ts`：当前路由匹配与认证前置行为
- `flower-wms-system/src/auth.config.ts`：会话和 callback URL 兼容边界
- `flower-wms-system/src/app/api/health/route.ts`：Route Handler 返回约定

**验收标准**

- 无入站 ID 时生成，高质量随机且长度固定。合法入站 ID 被保留，超长、含控制字符或非法字符的值被替换。
- API 响应含约定的 request ID header，服务端同一请求内的日志使用同一值。并发请求不会串号。
- matcher 排除构建资源和不需处理的静态内容。登录、回调、上传、V1、V2 和公开健康检查的现有状态码、重定向与缓存行为不变。
- request ID 不出现在指标标签、业务审计主键或授权判断中。

**验证**

```text
npx next typegen
npx tsc --noEmit
npm run lint
npm run test:unit
npm run build
npm run test:e2e
```

## 6. E3.3 · 错误追踪与告警契约

**Task ID** `e33-error-alerting`

**结果** 服务器异常可生成脱敏、可关联、可分组的错误事件。提供本地受控失败证据和告警规则文档。外部平台接入保持可选。

**允许路径**

- `flower-wms-system/src/lib/observability/**`
- Next.js 当前版本规定的 instrumentation / error 边界文件，开始前列出精确路径
- `deploy/observability/**`（新增告警规则、示例配置和说明）
- `docs/sprint-e3-alert-catalog.md`（新增）
- `flower-wms-system/package.json`、锁文件仅在用户批准选定 SDK 后开放

**验收标准**

- 捕获 Route Handler、Server Action 或后台任务中未处理异常，事件含环境、版本、request/run ID、稳定分组键和安全上下文。
- 过滤预期的认证拒绝、输入校验失败和受控业务冲突，避免将其全部作为系统错误告警。仍为这些结果提供计数指标。
- 受控失败产生一条可定位事件，事件中不存在凭据、Cookie、请求体或数据库 URL。追踪 SDK 不可用时应用继续运行，日志记录投递故障。
- 告警目录至少定义 5xx 比率、关键任务连续失败、数据库不可用、备份失败、迁移失败和登录失败异常升高。每条含信号、窗口、阈值占位、严重度、负责人占位和 Runbook 链接。

**待维护者输入** 错误追踪平台、DSN、环境和版本命名、告警通知渠道、接收人、数据驻留及保留期。DSH 不写真实值。

## 7. E3.4 · 数据库、cron 与业务信号监控

**Task ID** `e34-runtime-monitoring`

**结果** 以低基数指标和受保护诊断覆盖 V1/V2 数据库可用性、请求延迟、连接问题、cron 最近成功与失败，以及首批关键业务失败计数。

**允许路径**

- `flower-wms-system/src/lib/observability/**`
- `flower-wms-system/src/app/api/health/route.ts`
- 新增受保护的内部诊断或指标 Route Handler 及测试
- `flower-wms-system/scripts/cron-inventory-daemon.ts` 和实际 cron worker 入口
- `deploy/observability/**`
- `deploy/staging/compose/docker-compose.staging.yml` 仅用于非生产验证

**验收标准**

- 指标至少覆盖请求数、5xx、延迟分桶、V1/V2 DB 探测成功与耗时、cron 最近成功时间和连续失败数。业务指标先覆盖登录失败、库存负数阻止、采购验收失败、订单确认失败、配送失败和成本重算失败中的现有可识别路径。
- 指标入口默认不公开。未授权请求被拒绝，响应不含库名、用户名或连接信息。采集失败不使业务请求失败。
- cron 监控依据成功轮次，不复用 web `/api/health` 作为 cron 容器健康检查。受控停跑或连续失败能触发告警条件。
- 使用 staging 合成流量展示一次正常趋势和一次受控异常。保存脱敏输出和告警判断结果。

数据库连接池的内部指标若当前 Prisma adapter / `pg` 组合无法稳定提供，记录为能力缺口。不得依赖未公开属性或 monkey patch Prisma Client。

## 8. E3.5 · 默认密码与首次登录治理

**Task ID** `e35-credential-governance`

**结果** 核对并闭合 V2 生产管理员的强密码、首次改密、审计和启动保护，同时明确 V1 并存期间的限制。

**允许路径**

- `flower-wms-system/src/v2/password-policy.ts` 及其测试
- `flower-wms-system/src/v2/auth.ts`、`src/v2/auth-source.test.ts`
- `flower-wms-system/src/auth.ts`、`src/auth.config.ts` 及直接测试
- `flower-wms-system/src/app/account/v2-password/page.tsx` 及新增的聚焦测试
- `flower-wms-system/prisma/v2/seed/production.ts`、`prisma/v2/seed.ts` 及 seed 合同测试
- `flower-wms-system/docker-entrypoint.sh` 或独立启动检查脚本，二选一并限定范围
- `docs/sprint-e3-credential-governance.md`（新增）

**范例**

- `prisma/v2/seed.ts`：密码文件、生产/test 隔离和数据库目标检查
- `src/v2/password-policy.ts`：当前强度规则
- `src/auth.ts` 与 `src/auth.config.ts`：V1/V2 provider 和 bootstrap session 语义
- `src/v2/services/staff-management.ts`：人员权限和审计约定

**验收标准**

- production seed 继续拒绝弱密码、缺失密码文件、test tier 和默认凭据。错误不得打印密码或路径内容。
- bootstrap 管理员在完成改密前只能访问改密和退出所需入口。改密成功撤销旧会话或保证下一次授权重新判定，并产生安全审计事件。
- 启动检查识别已知默认凭据或未完成 bootstrap 的生产账号时按批准策略拒绝启动或产生高严重度信号。先以文档和测试明确策略，不能自行锁死现有生产账号。
- V1 当前账号治理、退役依赖和无法强制改密的入口单列，不把 V2 规则错误套到 V1 schema。

涉及生产账号状态、会话撤销方式或新增数据库字段时，先提交设计及迁移计划给 Codex。没有批准不得修改 Prisma schema 或生成迁移。

## 9. E3.6 · 登录限流与失败治理

**Task ID** `e36-login-throttling`

**结果** V1/V2 Credentials 登录具备统一的失败节流和观测能力，不能通过切换 provider 绕过，也不能形成用户名枚举或无限内存增长。

**允许路径**

- `flower-wms-system/src/auth.ts`
- `flower-wms-system/src/lib/auth-security/**`（新增）
- `flower-wms-system/src/lib/observability/**`
- 对应单元、集成和 E2E 测试
- `flower-wms-system/src/proxy.ts` 只有在 E3.2 已完成且方案确需修改时开放
- 持久化模型与迁移不在首轮范围

**验收标准**

- 对账号维度和来源地址维度实施有界速率策略。未知用户、错误密码和停用用户的外部行为一致。成功登录只重置适用的账号失败状态，不能清除来源地址的滥用记录。
- 限流响应或 Auth.js 失败结果不泄露账号存在性。日志只记录安全的账号指纹或内部标识，禁止明文用户名和密码。
- 测试覆盖阈值边界、时间窗恢复、成功登录、V1/V2 provider 切换、并发失败、代理头伪造和存储不可用时的行为。
- 单实例内存实现只能作为明确的本机/staging 第一阶段，并必须有容量上限和清理。多实例生产所需的共享存储、可信代理链和策略参数列为阻塞项，不能宣称生产完备。

限流阈值、锁定时长、可信代理和多实例共享存储需要项目用户或维护者批准。若没有这些值，使用测试配置验证机制，并把生产默认保持关闭或保护性保守配置，交付时明确。

## 10. E3.7 · 依赖、密钥与镜像安全门禁

**Task ID** `e37-security-gates`

**结果** PR 和镜像流程产生可归档的依赖、secret、SBOM 与镜像漏洞结果，并有明确的失败政策和例外机制。

**允许路径**

- `.github/workflows/security.yml`（新增，独立 workflow）
- `.github/dependabot.yml`（若采用）
- `.github/security/**`（新增规则和例外）
- `scripts/security/**`（新增）
- `docs/sprint-e3-security-gates.md`（新增）
- `deploy/staging/workflow-proposal.md` 仅补充对接说明
- 应用依赖、生产 Dockerfile 和锁文件不在本包的自动修复范围

**范例**

- `.github/workflows/pr.yml`：Node 版本、官方 npm registry、路径分类和 artifact 约定
- `.github/workflows/deploy.yml`：镜像构建与 SHA tag
- `Dockerfile`：实际生产镜像阶段
- `deploy/staging/images/Dockerfile.staging-offline`：E2 本机构建偏差，只作证据边界参考

**验收标准**

- 锁文件依赖检查、secret 检测、SBOM 生成和最终运行镜像扫描均有固定版本的工具或 action，权限最小化，第三方 action 固定到不可变 commit SHA。
- 门禁政策区分运行时与开发依赖、严重度、可利用性和修复可用性。例外必须包含漏洞 ID、理由、负责人、到期日和补偿措施，过期例外使检查失败。
- 受控样本证明每类检查能失败，正常仓库证明不输出 secret。报告作为 artifact 保存，日志不包含凭据。
- 扫描生产目标 stage。E2 staging-offline 镜像含开发依赖且不代表生产制品，结果不能替代真实生产镜像扫描。
- 发现漏洞时只生成报告和修复工作包，不在本任务中批量升级依赖或重写锁文件。

真实 GitHub Actions 首跑、分支保护、registry 拉取和组织级 secret scanning 需要维护者权限。DSH 本地验证 workflow 结构、脚本退出语义和受控样本。

## 11. 并行与文件所有权

| 批次 | 可并行工作 | 串行边界 |
| --- | --- | --- |
| 1 | E3.1、E3.5 只读盘点、E3.7 | E3.1 独占 `src/lib/observability/**`；E3.5 不写认证文件 |
| 2 | E3.2、E3.4 设计、E3.5 实现、E3.7 收尾 | E3.2 独占 `proxy.ts`；E3.5 独占 `auth.ts` / `auth.config.ts` |
| 3 | E3.3、E3.4 实现 | 两包对 observability 共用文件的修改串行合并 |
| 4 | E3.6 | E3.5 验收后再修改认证入口 |
| 5 | 集成、staging 演练和证据整理 | 单一负责人修改 package、锁文件、Compose 和共用文档 |

若使用多个 DSH agent，给每个 agent 分配互不重叠的精确路径。不要让两个 agent 同时编辑 `package.json`、锁文件、`proxy.ts`、`auth.ts`、`src/lib/observability/**` 或 staging Compose。

## 12. 全量验收与交付格式

每个包先运行聚焦测试，再运行适用的 E1 门禁。最终集成至少执行：

```text
npm ci
npx next typegen
npx tsc --noEmit
npm run lint
npm run test:unit
npm run test:ci
npm run build
npm run test:e2e
node scripts/check-knowledge-structure.mjs --json
node --test scripts/check-knowledge-structure.test.mjs
```

若命令名以当前 `package.json` 为准发生变化，记录实际命令。网络、Docker、外部平台或远程 staging 不可用时，继续完成本地检查并区分“代码通过”“本机 staging 通过”“外部集成待验证”。不得把跳过、未适用或缺少凭据报告为通过。

每包交付以下内容：任务 ID 和 DSH session ID、开始基线、允许路径、实际修改文件、验收标准到证据的一一映射、所有命令和退出码、正常与受控失败样例、敏感信息检查、残留风险、外部接入待办和知识库更新建议。证据放入 `docs/evidence/sprint-e3/`，只保存脱敏且必要的摘要，避免提交大体积工具缓存、完整依赖清单副本、原始请求内容或第三方后台导出。

## 13. Sprint E3 关闭标准

- 关键 HTTP、认证、数据库和 cron 路径使用同一结构化事件约定，request ID 或 run ID 可以贯穿日志与错误事件。
- 受控服务器异常可被追踪，告警目录与 Runbook 可执行，外部平台缺失部分明确标注。
- 数据库与 cron 的健康和失败可观察，公开健康接口不泄露内部信息，cron 不再依赖错误的 web 健康语义。
- 生产 bootstrap 管理员没有默认口令路径，首次改密闭环及审计有自动化证据。V1 遗留风险被明确记录。
- 登录失败治理通过边界、并发和绕过测试。多实例共享策略未落地时不能将单机限流标为生产完成。
- PR 和镜像安全扫描有正常与失败证据、处置政策和过期例外检查。真实 GitHub 或 registry 首跑由维护者补证。
- E1 全量质量门禁保持通过，E2 staging 部署、健康、cron 和回滚主路径无回归。
- DSH 完成自测后标记“待 Codex 独立验收”。生产告警、限流、账号策略和安全门禁的启用仍需维护者或项目用户完成对应配置与批准。
