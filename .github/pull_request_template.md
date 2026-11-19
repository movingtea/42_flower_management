# Pull Request

## 摘要

<!-- 一句话说明本 PR 的目标与范围。 -->

## 变更范围

- [ ] 应用源码 / 配置
- [ ] 数据库 schema、迁移或 seed
- [ ] 测试（单元 / 集成 / 冒烟 / E2E）
- [ ] 知识文档（knowledge/）或工程文档（docs/）
- [ ] CI / 工程化脚本
- [ ] 发布相关（Docker、Compose、部署配置）

## 影响评估（逐项必填）

对每一项选择「是 / 否」。选择「是」时必须给出知识文档、规格、ADR 或测试计划链接；选择「否」时必须说明为什么本 PR 不涉及该影响（例如仅文档格式调整、仅测试基础设施），不能留空。

| 影响项 | 是否影响 | 依据文档 / 链接 | 若无影响，说明暂缓或不适用原因 |
|---|---|---|---|
| 业务规则（已批准规则 ID） | 是 / 否 | | |
| 数据模型 / 迁移 / seed | 是 / 否 | | |
| API 契约 | 是 / 否 | | |
| ADR（新增或修订） | 是 / 否 | | |
| 测试计划 / E1.1 追踪矩阵 | 是 / 否 | | |
| 已知限制 / 风险登记 | 是 / 否 | | |

补充说明：

<!-- 例如：规则未确认、正式 AC 尚未建立、迁移不可逆、依赖外部决策等。 -->

## 测试证据

列出实际执行过的命令、退出码、通过 / 失败 / 跳过数量与日志或 CI 链接。不得粘贴连接串、密码或 token。

| 命令 | 退出码 | 通过 / 失败 / 跳过 | 日志或链接 |
|---|---|---|---|
| `npm run test:unit` | | | |
| `npm run test:legacy` / `npm run test:v2:db` | | | |
| `npm run build` | | | |
| `npm run test:e2e` | | | |

## PR 质量门禁结果

- [ ] `knowledge-structure` 通过（知识/文档变更时必须在本地或 CI 复跑）
- [ ] `lint` 通过
- [ ] `typecheck` 通过
- [ ] `unit` 通过
- [ ] `build` 通过
- [ ] `db-regression`：已执行并通过 / 显式未适用（写明 not-applicable 原因）
- [ ] `e2e`：已执行并通过 / 显式未适用（未适用可添加 `run-e2e` label 强制触发）
- [ ] `traceability`：已执行并通过 / 显式未适用

> 未执行不等于通过。条件 job 由 workflow 写出 `NOT APPLICABLE` 结论；如果本 PR 修改了相关路径，请确认对应 job 实际执行。

## 知识同步清单

- [ ] 变更涉及的规则、规格、ADR、测试计划已同步更新，或已登记暂缓原因
- [ ] 新增/修改的知识文档有可解析的 YAML frontmatter；`approved` 文档含 `owner`、`version`、`updated`
- [ ] Markdown 相对链接与 Obsidian `[[wikilink]]`、`![[embed]]` 可解析（含 `#heading`）
- [ ] ADR ID 唯一，且 `knowledge/05-ADR/E0-adr-register.md` 已登记
- [ ] 测试计划引用的 Feature Spec 路径/AC ID 存在；Feature Spec 引用对应测试计划
- [ ] `superseded` 文档已用 `superseded_by` 指向替代文档
- [ ] 历史缺失或正式 AC 未建立的事项已进入 `scripts/check-knowledge-structure.mjs` 的显式例外清单（含理由），没有静默忽略

## 风险与回滚

<!-- 迁移不可逆性、数据兼容、权限影响、回滚步骤；无风险请写无。 -->

## 审查者检查项

- [ ] 影响评估逐项有依据，未用空白或「无」替代说明
- [ ] 测试证据可复现，失败项有复现步骤与期望
- [ ] 未包含凭据、连接串或生产数据
- [ ] 如需维护者操作（分支保护、GitHub Actions 运行），已在待决项中列出
