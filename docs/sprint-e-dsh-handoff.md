# Flower WMS Sprint E · DSH 交接

2026-11-09。交接范围为更新后 Sprint E 的 E0 和 E1。E0 已关闭，本次执行 E1 剩余项。原计划见 Codex 聊天「V2 重构」，执行记录见「V2工程化」。

## 接手前先对齐工作区

- 在 `D:/My-project/flower-studio-ecosystem` 工作。Git 仓库是 `CMS_and_WMS`，应用是 `CMS_and_WMS/flower-wms-system`。先读根目录、仓库和应用三级 `AGENTS.md`，然后读 [知识索引](../knowledge/00-Home/E0-knowledge-index.md)、[E1.1 追踪矩阵](../knowledge/specifications/test-plans/E1.1-p1-test-traceability.md)、[ADR-003](../knowledge/05-ADR/ADR-003-inventory-invariants.md) 和 [ADR-005](../knowledge/05-ADR/ADR-005-codex-dsh-responsibilities.md)。
- 用 `git -C CMS_and_WMS status --short --branch`、`git -C CMS_and_WMS log -5 --oneline` 和 diff 记录实际基线。交接盘点时分支为 `dev`，HEAD 为 E0 提交 `99daac6`。E1 改动仍在工作区。接手时优先核对其他会话的最新结果，已有验收证据的任务直接继承。
- 2026-11-09，项目用户要求停止本轮 E1.2／E1.4 联调，剩余实现和自测交给 DSH。Codex 已停止执行和复跑，并向原 DSH 任务发出取消请求。交接记录时尚未收到全部确认。沿用未提交差异，开始写入前核实原任务和返工会话均已停止，避免并发修改。保留 `.obsidian/workspace.json`、E0 知识索引和 E1.1 文档现有改动。
- 每个工作包开始前列出具体文件，按下文范围执行。业务规则、生产发布和切换由项目用户批准。依据 ADR-005，DSH 可以完成实现、自测和证据归档，工程独立验收待 Codex 恢复后执行。分支保护或其他仓库设置变更由有权限的维护者办理。

## 状态与执行顺序

| 工作项 | 交接状态 | 下一步 |
| --- | --- | --- |
| E0 知识基线与 V2 正式化 | 已关闭，`99daac6`，ADR-001～005 已批准 | 以该基线为参照 |
| E1.1 P1 测试策略与追踪矩阵 | 已交付 20 条场景。历史独立复跑在 PostgreSQL 18 上通过 8 项迁移、测试 Seed、31 个 V2 测试文件和 4 条冒烟 | E2E 和 CI 落地后回填证据，正式 AC 与阶段边界保留待核定 |
| E1.2 统一测试入口 | 工作区曾跑通 `test:ci`，但交接时 Vitest 声明与锁文件不一致，自检与旧夹具还有收尾 | 修复锁文件、发现自检及日期，干净安装后复跑 |
| E1.3 Next.js 测试 Skill | 待交付 | 可与 E1.2／E1.4 并行 |
| E1.4 测试数据库标准化 | 本地 V1/V2 隔离库、V2 空库迁移与 Seed、回调失败清理已验证 | 补中断、迁移失败和并发隔离的专项证据，完成分层数据，与 E1.6 对齐 CI 合同 |
| E1.5 浏览器 E2E | 有 E0 人工验收和 E1.1 场景，Playwright 待实现 | 用稳定的隔离库和测试数据实现 |
| E1.6 PR 质量门禁 | 已有部署 workflow，独立 PR 门禁待建 | 可先搭框架，最后接通稳定的测试入口和 E1.7 |
| E1.7 知识同步门禁 | 有治理规则，自动结构检查及 PR 声明待实现 | 可与 E1.5 并行 |
| E1.8 最小发布 Runbook | 待编写并在非生产环境演练 | 可先写手册，稳定后演练 |

并行安排沿用原计划。A 负责测试运行器和数据库，B 负责 Playwright 和 E2E 数据，C 负责 CI、知识门禁及 Runbook。A 先拥有应用的 `package.json`、锁文件和 DB 启动入口。B 准备好 Playwright 后串行接入包配置。C 通过稳定的 npm 入口调用。E1.3 可单独完成。

## A · E1.2 与 E1.4

范围为应用下的 `package.json`、`package-lock.json`、`vitest.config.ts`、`scripts/test-v2{,.test}.mjs`、`scripts/with-v2-test-db{,.test}.mjs`、`src/v2/domain/stock-planning.vitest.ts`。复核现有 `src/services/order-expiry-lifecycle.test.ts` 夹具差异。分层数据如需新增文件，先明确与 B 的文件所有权。沿用既有 Prisma 迁移和测试 Seed。

### 交接时已验证

- 修复了测试库 URL 参数冲突。`npm run test:v2:db` 在临时 PostgreSQL 18.3 实际通过 31 个 V2 测试文件和 4 条冒烟。
- `test:legacy` 已通过 `--legacy` 使用独立 V1 测试库。原 `test:all` 与修正金额、库存和重复关闭断言后的订单过期测试均实跑通过。V1 测试库用当前 schema 的 `prisma db push` 初始化。V1 历史迁移复跑曾因本机空迁移目录报 P3015，未把 V1 历史迁移列为通过。
- `npm run test:ci` 曾退出 0，覆盖旧测试、10 个 Vitest 用例、32 项工具自检、31 个 V2 测试文件和 4 条冒烟。当次实际运行 Vitest 3.2.7，属于已安装依赖的工作区运行证据。交接时无法据此认定锁定依赖已可复现。
- 失败回调返回 27 时，入口保留退出码 27。通过数据库报告的 `data_directory` 核实该实例目录已删除。并行执行的 V1 过期与 V2 回归使用了不同端口和库名。

### DSH 剩余工作

原会话分别为 A `session-bb215a5b-1b90-451a-a7d6-218205377589`、B `session-ac3167aa-1f8e-40fd-b1fc-17c0499b7a21`、C `session-b8ce1eca-28c8-49d4-8fa2-217bb2d2e35e`、D `session-59b34efe-3b95-4c92-ba7b-81fc65ebc388`。接手时先对照工作区和会话终态复核下列观察。

1. **依赖与最终回归**（`e12-npm-vitest-c`）。交接时 `package.json` 声明 `^4.1.12`，锁文件根声明为 `^3.2.7`，锁定和本机安装版本均为 3.2.7。选定与仓库兼容的版本，使声明、锁与安装一致，避免无关依赖版本变动。完成真实的干净 `npm ci` 后复跑 `test:unit` 和 `test:ci`，保存结果。
2. **可扩展的测试发现**（`e12-v2-runner-a`）。`scripts/test-v2.test.mjs` 仍断言文件总数等于 31，且对部分分组采用固定文件清单。改用基线必含文件或独立发现结果验证排序、去重和分类。新增合规测试文件时，自检应继续通过。单元组只纳入明确无需数据库的测试。
3. **旧订单过期夹具日期**（`e12-legacy-fixture-d`）。`src/services/order-expiry-lifecycle.test.ts` 的三处交付日期仍固定为 2026-12-25 至 27。改为以运行日为基准的未来上海日期，保留金额、库存和重复关闭断言，再在独立 V1 库复跑。
4. **数据库专项与后续接入**（`e14-postgres-harness-b`）。用专项用例核对并发隔离、数据库不可用、迁移失败和中断退出。完成 minimum、roles、P1 scenarios、E2E fixtures 的数据分层，并与 E1.6 确定 CI PostgreSQL service container 的隔离方式。

在应用目录验收，使用项目锁定的 Node 和依赖。数据库命令通过已审核的隔离入口执行。

```text
node --test scripts/test-v2.test.mjs scripts/with-v2-test-db.test.mjs
npm run test:unit
npm run test:legacy
npm run test:integration:v2
npm run test:smoke:v2
npm run test:v2:db
npm run test:ci
```

记录通过、失败及跳过数量。必测文件空集、数据库不可用、必测数据库断言跳过均应使门禁失败。Windows 可通过 `PG_BIN` 指定 PostgreSQL 工具目录。现有 `pg` 并行查询弃用提示随最终结果记录。最终依赖和代码定稿后，以干净安装的复跑作为交付证据。

## E1.3 · 项目 Next.js 测试 Skill

在工作区 `.agents/skills` 下拟定项目专用 Skill，沿用现有 WMS Skill 结构。先核实目录可写，若当前执行环境限制该目录，交付审阅稿并记录安装待办。读应用目录 `node_modules/next/dist/docs/` 的相关版本指南和现有测试后再写。

覆盖 Next.js 16 App Router、React 19 的 Server/Client Components、Server Actions、Route Handlers、`next/navigation`、Auth.js 会话、Prisma 服务替身、Testing Library、MSW、Playwright 与可访问性检查。给出测试层级、最小仓库示例和运行命令。可从 `src/v2/auth-source.test.ts`、`src/v2/navigation.test.ts`、`src/v2/services/receive-purchase-line.test.ts` 和 Vitest 样例取材。候选 Skill 的 Vite、TanStack Router、FastAPI 及无关夹具应剔除。用一项实际 WMS 变更走读指南，验证能选对测试层并运行示例。依赖安装由实际测试工作包按需处理。

## B · E1.5 Playwright

范围为应用下拟新增的 `playwright.config.ts`、`tests/e2e/` 和必要的测试数据或启动入口。与 A 确认隔离库贯穿测试进程和应用进程，再串行接入 `test:e2e` 与包配置。测试数据可重复生成，浏览器数据与角色隔离，使用合成账号。

- 主链路覆盖管理员登录、创建物料和供应商、订单缺料关联采购、分次原级／降级验收、订单确认与预留、制作实耗与损耗、配送失败与人工重排、完成交付及实际成本。
- 独立用例覆盖取消后释放预留、只读角色写入拒绝。按 E1.1 优先将补送与额外收货、整条缺料换料、库存复核及其权限转成自动化，复用 ADR-003 的人工验收数据与断言。
- 以可访问名称或已有稳定标识定位，等候可观测状态。权限用例同时核对服务端拒绝或数据状态。记录失败 trace、截图和报告，至少用一次受控失败证明产物可定位。服务层数据库测试继续运行。
- 逐项在 E1.1 矩阵回填场景 ID、测试位置和真实运行结果。默认 SKU 停用顺序、配送重排的顾客确认／成品可交付条件／售后分流，以及细粒度权限仍按矩阵登记。涉及改业务行为或定义未明确的预期时拆独立业务工作包，先提交规则依据，继续执行不受影响的场景。

## C · E1.6 与 E1.7

范围为独立 PR workflow、PR 模板、轻量知识校验脚本及相应验证用例。以 [.github/workflows/deploy.yml](../.github/workflows/deploy.yml) 为部署现状参照，PR 检查独立触发，使用测试资源。

- E1.6 落地知识检查、ESLint、TypeScript、单元、旧测试、V2 集成与冒烟、空库迁移、生产构建、关键 E2E、追踪检查。普通 PR 跑 lint／typecheck／unit／build，数据库或核心规则变更触发对应迁移、集成或 E2E，知识文件变更进入结构校验。可先全部执行，再凭证据优化触发范围。区分未适用、已执行通过和失败，确保路径条件无法绕过必过检查。
- CI 用干净环境复跑，记录至少一次通过与一次受控失败的日志和链接，验证失败时的报告可取得。列出实际必过检查名称。由维护者启用并验证分支保护后，才能把「失败阻止合并」标为已通过。
- E1.7 的 PR 模板逐项说明是否影响业务规则、数据模型、API 契约、ADR、测试计划或已知限制。有影响时给出相应文档，或注明暂缓原因。自动检查 Markdown 相对链接和 Obsidian wikilink、YAML 元数据、approved 文档的 owner/version/updated、ADR ID 唯一性、Feature Spec 与测试计划的引用、superseded 文档的替代指向。对历史缺失和正式 AC 尚未建立的条目保留可追踪的例外。用有效和无效样本验证结构规则，并人工复核业务内容。

## C · E1.8 最小发布 Runbook

参照 [部署流程](../.github/workflows/deploy.yml)、[Dockerfile](../Dockerfile)、[Compose 示例](../docker-compose.example.yml) 和 [V2 本地运行文档](flower-studio-2.0-local-run.md)。在 `docs/` 写单机 Docker Compose 发布手册。覆盖联系人及故障记录、备份与恢复检查、V1/V2 migration status、迁移和前后数据核对、按提交 SHA 部署 web 和 cron、健康检查、核心冒烟、失败停止条件和应用镜像回滚。列明不可逆迁移与回滚镜像的兼容前提。沿用 ADR-001 的 V1/V2 归属和退役条件。

用非生产 Compose 和隔离数据库逐条验证命令，演练成功路径、失败停止、应用镜像回滚。记录镜像 SHA、命令退出状态、健康和冒烟证据，以及实际验证到的恢复边界。

## 交付给验收者

每包提交一份简报，列出工作项与状态、开始基线、文件与变更摘要、执行命令和退出码、场景或规则 ID、通过／失败／跳过数量、日志或 CI 链接、临时资源清理结果、待决项和知识修订建议。失败项给出复现步骤与期望，继续完成可独立推进的任务。报告中对连接串和凭据脱敏。

E1 关闭需有干净环境的 `npm run test:ci` 通过证据，现有 V1/V2 测试保留，隔离库自动创建与清理，核心 E2E 和失败产物可复查，空库迁移可验证，分支保护能阻止失败 PR 合并，规则与验收证据可追溯，Runbook 已完成非生产演练。DSH 自测通过后标记「待独立验收」，把剩余业务决策和权限操作单列。
