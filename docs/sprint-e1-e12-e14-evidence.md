# Sprint E1.2 与 E1.4 DSH 自测简报（待独立验收）

2026-11-09。交接来源见 [sprint-e-dsh-handoff.md](./sprint-e-dsh-handoff.md)。本简报覆盖 A 包的 E1.2「统一测试入口」和 E1.4「测试数据库标准化」剩余工作。依据 [ADR-005](../knowledge/05-ADR/ADR-005-codex-dsh-responsibilities.md)，DSH 完成实现与自测，工程独立验收待 Codex 恢复后执行。业务规则未变更，无已批准规则需要确认。

## 共同基线

- 仓库 `CMS_and_WMS`，分支 `dev`，HEAD `99daac6`（Sprint E0 done），E1 改动保留在工作区，未提交、未推送。
- 应用 `flower-wms-system`，Node v24.14.0、npm 11.11.1、PostgreSQL 18.3 工具在 PATH。
- 依赖：`vitest` 4.1.12（声明 `^4.1.12`）、`vite` 8.0.14（vitest 4 的传递依赖，锁定 8.0.14）。`package.json` 中原先与锁文件不一致的 `overrides.vite` 已移除。
- 环境备注：本机 npm 镜像 `registry.npmmirror.com` 的 vitest 包元数据/包体返回 500，干净安装改从官方 `registry.npmjs.org` 完成（`npm_config_replace_registry_host=always`，缓存放工作区外）。该现象属本机镜像故障，不影响仓库锁文件（锁内 resolved 仍为仓库既有镜像地址）。
- 日志与原始输出保存在 [docs/evidence/sprint-e1/logs](./evidence/sprint-e1/logs/)。日志中无连接串或凭据；数据库名/端口为每次运行随机生成。

## A · E1.2 统一测试入口

状态：**实现与自测完成，待独立验收**。E1.2 剩余三项全部完成。

### 变更摘要

| 文件 | 变更 |
|---|---|
| `flower-wms-system/package.json` | `vitest` 声明与锁/安装统一为 `^4.1.12`；移除 `overrides.vite`；新增 E1.4 的 seed tier、校验与数据库专项入口脚本。 |
| `flower-wms-system/package-lock.json` | 重新生成：锁根 vitest `^4.1.12`，锁定 vitest 4.1.12、vite 8.0.14。差异仅为 vitest 4/vite 8 依赖子树（780 行新增），无其他依赖版本变动。 |
| `flower-wms-system/vitest.config.ts` | 使用 vitest 4 下可用的最小配置（`include: **/*.vitest.ts`，node 环境），继承自交接工作区。 |
| `flower-wms-system/scripts/test-v2.mjs` | 单元组改为按导入分类：只有不导入 Prisma/generated client/`server-only`/DB service 的测试进入 unit；新增 `root` 参数供发现逻辑测试注入临时目录；导出 `isDatabaseFreeTestSource`。 |
| `flower-wms-system/scripts/test-v2.test.mjs` | 自检改为独立发现 + 基线必含 + 分类校验，共 34 项（含 2 项 fixture 目录测试）。 |
| `flower-wms-system/src/services/order-expiry-lifecycle.test.ts` | 三处交付日期改为运行日 +7/+8/+9 天的上海日期；金额、库存、重复关闭断言不变。 |

### e12-npm-vitest-c：依赖与最终回归

- 选定版本：**vitest 4.1.12 + vite 8.0.14**。选择依据：与仓库声明的 `^4.1.12` 一致，锁文件根声明、锁定版本、安装版本三者一致，且不含其他依赖升级。
- 干净安装：删除 `node_modules` 后真实执行 `npm ci`，退出 0，安装 623 个包（50 秒）。未修改锁文件（`npm ci` 不写锁）。
- 命令：`npx tsc --noEmit` 退出 0；`npm run test:unit` 退出 0（vitest 1 个文件 10/10 通过，工具自检 34/34 通过，unit runner 8/8 文件通过）。
- 单元测试使用 vitest 4.1.12 实际运行通过，不再依赖工作区未锁定版本。

### e12-v2-runner-a：可扩展的测试发现

- 移除了「文件总数等于 31」和固定 unit 文件清单等易碎断言，改为：
  1. **独立发现**：自检用独立实现的文件系统遍历计算预期结果，与 runner 的 discovery 结果逐一比对，验证排序、去重和范围（integration 只含 `src/`，smoke 只含 `scripts/v2/smoke-*.ts`）。
  2. **基线必含**：保留 8 个 unit、31 个 integration、4 个 smoke 基线文件作为回归护栏，但不再要求集合完全相等。
  3. **分类校验**：unit 文件逐个扫描导入，确认不依赖数据库/服务端模块；DB-backed 文件只进入 integration。
  4. **可扩展性**：新增 fixture 目录测试，在临时目录中构造合规/不合规文件，验证新增 unit、integration、smoke 文件无需修改自检即可被发现；同时断言缺目录/缺必需文件时 discovery 明确失败。
- 结果：`node --test scripts/test-v2.test.mjs scripts/with-v2-test-db.test.mjs` 通过 34/34（其中 harness 自检 19 项）。
- 门禁失败语义：必测文件空集由自检的 `zero discovered files fail` 覆盖；数据库不可用由 E1.4 专项覆盖；runner 对数据库断言输出 skip 时仍按失败处理（本次未改动该语义）。

### e12-legacy-fixture-d：旧订单过期夹具日期

- `deliveryDate` 由固定 `2026-12-25/26/27` 改为 `shanghaiDateAfter(7/8/9)`（`Intl.DateTimeFormat` + `Asia/Shanghai`），运行日为 2026-11-09 时生成 2026-11-16/17/18。
- 保留全金额、库存回补、重复关闭拒绝断言。`npm run test:legacy` 退出 0，38 个旧测试脚本 + 订单过期测试全部通过（共 39 条旧入口命令）。
- 记录：输出包含既有 `pg` 并行查询弃用提示（`client.query() ... deprecated`），与本轮改动无关，按交接要求随结果记录。

## A · E1.4 测试数据库标准化

状态：**专项与分层实现、官方隔离入口自测完成，待独立验收**。与 E1.6 的 CI 合同见 [sprint-e1-ci-postgres-contract.md](./sprint-e1-ci-postgres-contract.md)（E1.6 落地前为 draft）。

### 变更摘要

| 文件 | 变更 |
|---|---|
| `flower-wms-system/scripts/with-v2-test-db.mjs` | 仅导出 `main(argv)` 以便中断路径测试，entrypoint 行为不变（无参数=2、`--help`=0、未知参数=2）。 |
| `flower-wms-system/scripts/v2-test-db-harness-specials.test.mjs` | 新增 4 项数据库专项用例（524 行）。 |
| `flower-wms-system/prisma/v2/seed.ts` | 改为 CLI 解析/安全校验/编排；默认行为、URL 与模式校验、production 引导语义保持不变。 |
| `flower-wms-system/prisma/v2/seed/` | 新增 `contract`、`types`、`accounts`、`minimum`、`roles`、`p1-scenarios`、`e2e-fixtures`、`orchestrator`、`production` 模块。 |
| `flower-wms-system/scripts/check-v2-seed-tiers.ts` | 新增只读 seed tier 校验脚本（放 `scripts/`，避免被 smoke 自动发现）。 |
| `flower-wms-system/README.md` | 补充隔离数据库入口与 V2 测试数据分层使用说明。 |
| `docs/sprint-e1-ci-postgres-contract.md` | 新增 E1.4↔E1.6 CI PostgreSQL 隔离合同（draft）。 |

### e14-postgres-harness-b：数据库专项证据

`node --test scripts/v2-test-db-harness-specials.test.mjs` 退出 0，4/4 通过，约 64 秒。

| 专项 | 断言与结果 |
|---|---|
| 并发隔离 | 两个 harness 并发运行，端口 51917/51918、数据库名互不相同，均退出 0；运行前后 `os.tmpdir` 无新增 `wms-v2-test-pg-*`。 |
| 数据库不可用 | `PG_BIN` 指向空目录时快速失败，退出 1，错误包含 `PG_BIN does not contain initdb.exe.`，无集群残留。 |
| 迁移失败 | 通过临时 `NODE_OPTIONS=--require` preload 仅让 `prisma migrate deploy` 失败（exit 42）；harness 退出 1，错误包含 `npm run db:v2:migrate:deploy failed`，输出无原始 URL/PGPASSWORD，集群已清理。 |
| 中断退出 | provisioning 完成后回调启动，包装进程 `process.emit("SIGINT")`，handler 返回 130 且集群目录被删除。 |

限制说明：Windows 下无法用 `child.kill` 向子进程投递 SIGINT（会被强制终止而跳过 handler），因此中断用例验证的是同一信号 handler 控制流，不是操作系统信号投递本身。该限制写入用例注释。

### e14 数据分层：minimum / roles / P1 scenarios / E2E fixtures

CLI 契约：

- 模式仍为 `test` / `dev` / `reset-test` / `production`；`db:v2:seed:test` 默认 `minimum,roles`，与历史数据一致。
- `--tiers=` 仅 `test`/`reset-test` 接受；取值 `minimum`、`roles`、`p1-scenarios`、`e2e-fixtures`；依赖自动补齐（roles⊇minimum，p1⊇roles，e2e⊇p1）；应用顺序固定。
- `dev` 仍只建 admin；`production` 拒绝 `--tiers`，引导逻辑与幂等提示不变。
- `p1-scenarios`：固定编码（`P1-SUP-001`、`P1-MAT-ROSE`、`P1-MAT-WRAP`、`P1-SPU-BOUQUET`、`P1-SKU-BOUQUET-M`、已发布配方 v1、`P1-BATCH-ROSE-001`），无 `Date.now()`/随机值，不创建订单/采购/预留等事务数据。
- `e2e-fixtures`：独立 `E2E` 门店与库位、五个 `e2e-*` 合成账号及成员关系、E2E 库存批次，并包含 P1 参考数据；重置语义为新迁移库重新应用 tier。

官方隔离入口证据（每例先应用两次再校验，证明幂等）：

| tiers | 应用次数 | checker | 结果 |
|---|---|---|---|
| `minimum,roles`（默认） | 2 | 66 checks OK，p1/e2e 缺失 | 退出 0 |
| `roles` | 2 | 66 checks OK | 退出 0 |
| `roles,p1-scenarios` | 2 | 89 checks OK | 退出 0 |
| `roles,e2e-fixtures` | 2 | 147 checks OK | 退出 0 |

- `minimum` 单独验证：harness 在回调前总会先应用默认 seed（minimum+roles），因此 `--tiers=minimum` 的严格「roles 缺失」checker 断言不适用于该入口；tier 应用本身成功（输出 `Applied seed tiers: minimum`），minimum 的 22 项断言已包含在上述 `roles` 闭包的 66 项检查中。该行为是 harness 的默认 seed 契约，不是分层缺陷。原始日志见 [seed-tier-minimum-not-applicable.log](./evidence/sprint-e1/logs/seed-tier-minimum-not-applicable.log)。
- 回归：默认 seed 未被破坏，31 个 V2 测试文件 + 4 条冒烟全部通过（`npm run test:v2:db` 退出 0；`npm run test:ci` 内同样通过）。
- `tsc --noEmit` 覆盖 seed 分层代码，退出 0。

## 汇总：命令、退出码与数量

| 命令 | 退出码 | 通过 / 失败 / 跳过 |
|---|---|---|
| `npm ci`（干净删除 node_modules 后） | 0 | 安装 623 包 |
| `npx tsc --noEmit` | 0 | 无诊断 |
| `npm run test:unit` | 0 | vitest 10/10、自检 34/34、unit 8/8 文件 |
| `npm run test:integration:v2` | 0 | 31/31 文件 |
| `npm run test:smoke:v2` | 0 | 4/4 冒烟 |
| `npm run test:legacy` | 0 | 38 个旧测试脚本 + 订单过期测试 39/39 |
| `npm run test:v2:db` | 0 | 31 文件 + 4 冒烟 |
| `npm run test:ci` | 0 | 39 legacy 入口 + vitest 10 + 自检 34 + 31 文件 + 4 冒烟 |
| `npm run test:db:harness-specials` | 0 | 4/4 专项 |
| seed tier 官方复跑（4 组 × 2 次应用 + checker） | 0 | 66/66、89/89、147/147 checks |

## 临时资源清理

- 所有数据库测试使用每次运行独立的临时集群；运行后 `os.tmpdir` 无 `wms-v2-test-pg-*` 残留，无测试数据库残留。
- 干净安装使用的 `node_modules` 旧备份、临时验证驱动脚本、工作区 npm 缓存已删除。
- 未提交 git、未推送、未修改分支保护或其他仓库设置。

## 待决项与风险

1. **独立验收**：本简报为 DSH 自测，工程验收待 Codex 恢复后执行。E1 关闭仍需 E1.5、E1.6、E1.7、E1.8 的交付。
2. **E1.6 CI 合同**：service container 镜像 digest、workflow 名称与必过检查名称、失败工件保留期待 C 包落地；当前合同为 draft。
3. **E1.5 接入**：E2E 门店/库位/账号编码当前为建议值，Playwright 接入时需确认按 `LocationKind` 还是 code 查询；E2E 账号口令常量仅可用于本地迁移的临时测试库。
4. **minimum 单独入口**：严格「最小集」验证需要新迁移且未执行默认 seed 的库；如需 CI 覆盖，建议由 E1.6 用模式 B 直接执行 `db:v2:seed:test:minimum` 后校验，而不是复用 harness 默认 seed。
5. **已知且未处理的事项**：`pg` 并行查询弃用提示；V1 历史迁移链在本机空迁移目录复跑 P3015（交接已记录，未列为通过）；本机 npm 镜像 vitest 包不可用需要官方 registry。
6. **本轮未改动**：业务规则、数据模型、API 契约、ADR。测试 seed 分层是测试基础设施变更，不影响生产初始化路径（production 模式拒绝 `--tiers`，默认 test seed 数据保持原样）。

## 知识修订建议

- [E1.1 P1 追踪矩阵](../knowledge/specifications/test-plans/E1.1-p1-test-traceability.md)「复跑与后续交接」：登记统一入口命令、seed tier 编码（P1-*）和 E1.4 自测证据链接，供 E1.5 复用。
- 交接文档 E1.2/E1.4 状态行可回填：E1.2 四项已完成；E1.4 专项与分层完成、CI 合同 draft、等待 E1.6 落地。
- 建议在知识治理中记录：测试数据为初始化而非 teardown；E2E 合成账号口令常量只用于临时测试库。以上为提案，需 Codex 审阅后更新。
