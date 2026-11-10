# Sprint E1.6 · PR 质量门禁与 E1.7 · 知识同步门禁

2026-11-09。工作区基线：Git 仓库 `CMS_and_WMS`，分支 `dev`，HEAD `99daac6`（Sprint E0 done），E1 改动保留为未提交工作区，未提交、未推送。应用为 `CMS_and_WMS/flower-wms-system`，Node 24.14.0。本文件记录 E1.6 PR 门禁与 E1.7 知识结构门禁的落地范围、规则、验证证据与待决项。凭据与连接串不在本文及附属日志中出现。

## 交付文件

| 文件 | 作用 |
|---|---|
| [.github/workflows/pr.yml](../.github/workflows/pr.yml) | 独立 PR 质量门禁 workflow（`on: pull_request`，不部署、不使用仓库 secrets） |
| [.github/pull_request_template.md](../.github/pull_request_template.md) | PR 模板：影响评估、测试证据、门禁结论与知识同步清单 |
| [scripts/check-knowledge-structure.mjs](../scripts/check-knowledge-structure.mjs) | E1.7 知识结构校验（纯 Node 内置模块，无新依赖，无网络访问） |
| [scripts/check-knowledge-structure.test.mjs](../scripts/check-knowledge-structure.test.mjs) | `node:test` 用例（17 项），覆盖有效/无效样本与全部规则 |
| [scripts/fixtures/knowledge-structure/valid](../scripts/fixtures/knowledge-structure/valid) | 有效样本树（链接、wikilink、frontmatter、ADR、规格互引、替代指向均合规） |
| [scripts/fixtures/knowledge-structure/invalid](../scripts/fixtures/knowledge-structure/invalid) | 无效样本树（每条规则至少一个反例） |
| [scripts/fixtures/knowledge-structure/invalid-exceptions.json](../scripts/fixtures/knowledge-structure/invalid-exceptions.json) | 无效样本的显式例外清单，用于证明「放行但保留 warning」 |
| 本文件 | 设计与验证记录 |

未改动 `package.json`/锁文件、应用源码、知识文档正文、`deploy.yml` 与分支保护设置。

## E1.6 · PR 质量门禁

### 触发与安全边界

- 仅 `on: pull_request`（`opened`、`synchronize`、`reopened`、`ready_for_review`、`labeled`、`unlabeled`）；不监听 `push`，不含 `workflow_dispatch`。
- 与 [deploy.yml](../.github/workflows/deploy.yml) 完全分离：PR workflow 无 ACR 登录、无镜像推送、无 SSH 部署、无 `${{ secrets.* }}`；权限仅 `contents: read`。
- 并发按 PR 号收敛（`cancel-in-progress`），避免同一 PR 重复运行。

### Job 与 check 名称

GitHub 分支保护的 required status check 取 job 的 `name`，因此下表名称即实际 check 名称。运行顺序按依赖排列；`changes` 只做路径分类，不作为必过检查。

| 顺序 | job id | 实际 check 名称 | 触发 | 执行内容 | 未适用时 |
|---|---|---|---|---|---|
| 1 | `changes` | `changed-paths` | 所有 PR | `git diff base...head` 计算路径范围并写 step summary | 不适用 |
| 2 | `knowledge-structure` | `knowledge-structure` | 所有 PR（全量扫描） | `node scripts/check-knowledge-structure.mjs --json` | 不适用（始终执行，不会被路径过滤跳过） |
| 3 | `lint` | `lint` | 所有 PR | `npm run lint`（ESLint） | 无 |
| 4 | `typecheck` | `typecheck` | 所有 PR | `npx next typegen` 生成路由类型后执行 `npx tsc --noEmit` | 无 |
| 5 | `unit` | `unit` | 所有 PR | `npm run test:unit`（vitest + 工具自检 + 无数据库单元组） | 无 |
| 6 | `build` | `build` | 所有 PR | `npm run build`（Next.js 生产构建；占位构建 env 见下文） | 无 |
| 7 | `db-regression` | `db-regression` | `prisma/`、schema/迁移/seed、`src/`、依赖或 DB harness 变更 | 空库 V2 迁移 + 一致性检查、seed tier 校验、V2 集成与冒烟、旧 V1 测试 | 显式 `NOT APPLICABLE` step summary + notice，不记为通过 |
| 8 | `e2e` | `e2e` | 页面/action/V2 域/测试/Playwright 配置变更，或 PR 带 `run-e2e` label | `npm run test:e2e`（E1.5 入口）+ 失败产物上传 | 显式 `NOT APPLICABLE` step summary + notice |
| 9 | `traceability` | `traceability` | 规则/规格/ADR/测试计划/测试或 E1 文档变更 | `node scripts/check-knowledge-structure.mjs --checks tracking` | 显式 `NOT APPLICABLE` step summary + notice |

必过检查：`knowledge-structure`、`lint`、`typecheck`、`unit`、`build`。这 5 个 job 没有 job 级 `if`，每个 PR 都会真实执行；`knowledge-structure` 即使未改动知识文件也执行全量扫描，避免「路径不匹配 → 静默跳过 → 误以为通过」。

条件检查：`db-regression`、`e2e`、`traceability`。它们始终保持 job 运行以产出显式结论：适用时执行真实命令；不适用时写 `NOT APPLICABLE` 与 `::notice`，且不宣称通过。是否把它们设为 required 由维护者决定；建议先保持非 required，避免「未适用=绿勾」被误读。

### 路径过滤策略

| 范围 | 匹配路径（正则摘要） | 影响 |
|---|---|---|
| `knowledge` | `knowledge/**`、`docs/*.md`、`docs/evidence/**/*.md`、`scripts/check-knowledge-structure*.mjs`、`scripts/fixtures/knowledge-structure/**`、`.github/workflows/pr.yml`、`.github/pull_request_template.md`、本文件 | step summary 中标注；`knowledge-structure` 始终全量执行 |
| `db` | `flower-wms-system/prisma/**`、`prisma(\.v2)?\.config\.ts`、`flower-wms-system/src/**`、`scripts/with-v2-test-db.mjs`、`scripts/test-v2.mjs`、`package(-lock).json` | 触发 `db-regression` |
| `e2e` | `src/app/**`、`src/v2/**`、`src/components/**`、`tests/e2e/**`、`playwright.config.ts`、`package(-lock).json` 或 `run-e2e` label | 触发 `e2e` |
| `tracking` | `knowledge/specifications/**`、`knowledge/02-Business/**`、`knowledge/05-ADR/**`、`*.test.ts`、`tests/e2e/**`、`docs/sprint-e1*.md`、知识脚本 | 触发 `traceability` |
| `app` | `flower-wms-system/**` | 仅写入 scope 摘要 |

设计取向是「宁可多跑，不可漏跑」：`db`、`e2e` 的范围比最小集合宽，后续可依据真实运行时长与证据收窄；不允许通过路径过滤让必过检查消失。

### 数据库 job 与 E1.4 合同

- 采用 [E1.4↔E1.6 CI PostgreSQL 隔离合同](./sprint-e1-ci-postgres-contract.md) 的模式 A（owned cluster）：job 安装 PostgreSQL 18 服务端与客户端工具（PGDG apt 源），导出 `PG_BIN=/usr/lib/postgresql/18/bin`，由 `with-v2-test-db.mjs` 每次创建独立临时集群、随机端口、随机密码并自动清理。
- 四个数据库步骤均为本地已验证入口：`node scripts/with-v2-test-db.mjs -- npm run db:v2:migrate:check`（空库迁移 + schema 一致性）、`... -- npm run db:v2:seed:check:default`（默认 seed tier 校验）、`npm run test:v2:db`（31 个 V2 测试文件 + 4 条冒烟）、`npm run test:legacy`（旧 V1 测试，含 `--legacy` 独立 V1 库）。
- 模式 B（GitHub Actions `postgres:18` service container）保留给后续 Playwright job；镜像 digest 固定与 E1.5 数据重置策略仍待决，未在本轮启用。
- 迁移或 seed 失败必然使 job 失败，不会被「未适用」逻辑吞掉。

**失败语义已实测**：`with-v2-test-db.mjs` 的 `main()` 返回回调进程退出码（`callbackResult?.code ?? 1`），入口再赋给 `process.exitCode`；任一非零都使 job 步骤失败。实测证据：

- 受控失败：回调内用带 schema 漂移的副本执行 `prisma migrate diff --exit-code`，Prisma 返回 2，harness 原样返回 2；`HARNESS_FAIL_EXIT=2`，GitHub Actions 步骤会因此失败。
- 正常路径：`node scripts/with-v2-test-db.mjs -- npm run db:v2:migrate:check` 在 owned cluster 中输出 `No difference detected.`，退出 0。
- 日志：[e16-harness-exit-semantics.log](./evidence/sprint-e1/logs/e16-harness-exit-semantics.log)（日志只含随机库名/端口，无连接串或凭据）。因此 `db:v2:migrate:check` 一旦发现迁移与 schema 不一致，job 会被捕获并失败。

### E2E 接入（依赖 E1.5）

- workflow 引用稳定入口 `npm run test:e2e`（E1.5 并行交付；当前 `package.json` 已存在该脚本，`playwright.config.ts` 与 `tests/e2e/` 由 E1.5 落地）。
- job 先 `npx playwright install --with-deps chromium`，再执行 `npm run test:e2e`；失败时上传 `test-results/`、`playwright-report/`、`blob-report/`（含 trace/screenshot）。
- E1.5 落地前，若本 PR 触碰 `e2e` 路径，该 job 暂可能因缺少 Playwright 配置而失败。这是已知临时状态；`e2e` 不作为必过检查，修复由 E1.5 完成后生效。

### npm registry 说明（必读）

本机 npm 镜像 `registry.npmmirror.com` 的 vitest 包元数据/包体返回 500，导致干净安装失败。为保证 CI 可复现，每个安装依赖的 job 在 `npm ci` 之前显式执行：

```text
npm config set registry https://registry.npmjs.org
npm config set replace-registry-host always
```

并在 workflow 级设置 `NPM_CONFIG_REGISTRY`、`NPM_CONFIG_REPLACE_REGISTRY_HOST` 作为兜底。`replace-registry-host always` 会把锁文件中既有镜像 host 重写到官方源，不需要修改 `package-lock.json`。该问题是本机镜像故障，不是仓库锁文件缺陷；锁文件保持原样。

### 生产构建的环境变量（本地已实测）

`next build` 在 Collecting page data 阶段会加载路由模块，而 `src/lib/prisma.ts`、`src/v2/db.ts` 在模块加载时读取 `DATABASE_URL`/`V2_DATABASE_URL` 并创建 client，缺失时直接抛错。因此 `build` job 必须注入占位构建环境变量（与 Dockerfile builder 阶段一致，不是真实数据库或凭据）：

```text
DATABASE_URL=postgresql://build:build@127.0.0.1:5432/build?schema=public
V2_DATABASE_URL=postgresql://build:build@127.0.0.1:5432/build_v2?schema=public
AUTH_SECRET=ci-build-placeholder-not-a-secret
NEXTAUTH_SECRET=ci-build-placeholder-not-a-secret
NEXTAUTH_URL=http://127.0.0.1:3000
AUTH_TRUST_HOST=true
NEXT_PUBLIC_API_URL=http://localhost:3000
NEXT_PUBLIC_ASSET_BASE_URL=http://localhost:3000
```

本地验证方式：E1.5 并行任务当时正在使用应用目录的 `next dev`/Playwright，为避免 `.next` 生成文件互相干扰，构建在**工作区完整副本**（源码 + 物理复制的 `node_modules`，并移除 `.env`/`.env.local` 以匹配 CI checkout）中执行；CI 中则直接在应用目录构建。

| 场景 | 退出码 | 耗时 | 结果 | 日志 |
|---|---|---|---|---|
| 仅占位 env（无 `.env`） | 0 | 101.5s（Turbopack 编译 28.5s，TypeScript 53s） | 19 个静态页面生成成功，未连接数据库 | [e16-build-local.log](./evidence/sprint-e1/logs/e16-build-local.log) |
| 去掉 `DATABASE_URL`/`V2_DATABASE_URL` | 1 | 95s | Collecting page data 阶段报 `Error: DATABASE_URL is not set`（`/api/admin/audit-logs`） | [e16-build-env-needed.log](./evidence/sprint-e1/logs/e16-build-env-needed.log) |

结论：占位 env 是必需的；已写入 `build` job，且构建期若真的查询数据库会显式失败，不会回退到开发或生产库。

### 分支保护配置（需维护者操作，本地无法完成）

本地没有 GitHub 仓库权限，无法推送分支、创建 PR 或修改分支保护。维护者需在 GitHub 仓库中执行：

1. 推送包含 `dev` 与 E1 改动的分支，创建一次 PR，确认 workflow 触发。
2. Settings → Branches → 对 `dev`（及 `main`/`master` 策略）添加 Branch protection rule 或 ruleset。
3. 勾选 **Require status checks to pass before merging**，将 required checks 设为：`knowledge-structure`、`lint`、`typecheck`、`unit`、`build`。勾选 **Require branches to be up to date before merging**。
4. `db-regression`、`e2e`、`traceability` 先保持非 required；若团队接受「未适用成功」语义，再逐步纳入。
5. 保留 `deploy.yml` 仅由 `master` push 触发的现状，不要在 PR 上启用部署。

分支保护启用并验证前，不得宣称「失败阻止合并」已通过。见待决项。

## E1.7 · 知识结构校验

### 规则与错误码

脚本默认扫描 `knowledge/**/*.md` 与 `docs/**/*.md`（相对仓库根），仅使用 `node:fs`、`node:path`、`node:url` 等内置模块，不读网络。所有失败带错误码、文件、行号与说明。

| 错误码 | 检查内容 | 说明 |
|---|---|---|
| `LINK_MISSING` | Markdown 相对链接（含 docs ↔ knowledge 互链） | 目标文件或目录必须存在；跳过 `http(s)`、`thread:`、`mailto:`、纯锚点等外部目标；代码块内示例链接不计 |
| `WIKILINK_UNRESOLVED` | Obsidian `[[wikilink]]` / `![[embed]]` | 必须解析到 `knowledge/` 下笔记；图片/附件按路径存在性校验；Obsidian 表格转义 `\|` 与 `#heading` 均支持 |
| `WIKILINK_HEADING_MISSING` | `[[note#heading]]` | 目标笔记必须含对应 ATX 标题或 `^block-id` |
| `WIKILINK_AMBIGUOUS` | 同名笔记 | 只告警，不误判失败 |
| `FM_MISSING` / `FM_PARSE_ERROR` | YAML frontmatter | 知识笔记必须有 frontmatter；轻量严格解析器拒绝重复键、错误缩进、未闭合引号 |
| `FM_REQUIRED_KEY` / `FM_INVALID_STATUS` / `FM_INVALID_FIELD` | frontmatter 字段 | 必填 `title`、`type`、`status`；`status` 限于 `draft/under-review/approved/superseded/archived`；`version` 整数、`updated` 为 `YYYY-MM-DD` |
| `APPROVED_METADATA_MISSING` | approved 文档元数据 | 必须含 `owner`、`version`、`updated` |
| `ADR_ID_DUPLICATE` / `ADR_REGISTER_MISSING` / `ADR_FILE_MISSING` | ADR ID 唯一与互指 | 扫描 `knowledge/05-ADR` 文件名与 ADR register 表格行；register 与文件必须一一对应 |
| `FEATURE_SPECS_ABSENT` / `TEST_PLAN_SPEC_MISSING` / `TEST_PLAN_SPEC_UNRESOLVED` / `TEST_PLAN_AC_UNKNOWN` / `FEATURE_SPEC_TEST_PLAN_MISSING` | Feature Spec ↔ 测试计划互引 | 测试计划必须引用存在的 Feature Spec；引用的 `AC-*`/`FS-*` ID 必须由规格定义；Feature Spec 必须回引测试计划 |
| `SUPERSEDED_WITHOUT_REPLACEMENT` / `SUPERSEDED_TARGET_MISSING` | superseded 替代指向 | 必须有 `superseded_by`/`replaced_by` 且目标可解析 |
| `UNUSED_EXCEPTION` | 例外清单维护 | 已失效的例外仍以 warning 提示，避免清单腐化 |

### 例外清单（显式、可维护、带理由）

历史缺失与「正式 AC 未建立」不静默忽略，而是登记在脚本的 `KNOWN_EXCEPTIONS` 常量（仓库默认）。每条含 `code`、`target`、`reason`、`owner`、`registered`；命中后原错误转为 `EXCEPTION_APPLIED` warning 并写入 JSON 摘要。fixtures 测试证明：同样的无效样本在例外覆盖后退出 0 并保留 16 条 warning。

| 错误码 | 目标 | 理由 |
|---|---|---|
| `FEATURE_SPECS_ABSENT` | `knowledge/specifications/features` | 正式 Feature Spec 与 AC 编号尚未建立；E1.1 交接已登记该缺口，当前规格入口仍为来源索引 |
| `TEST_PLAN_SPEC_MISSING` | `knowledge/specifications/test-plans/E1.1-p1-test-traceability.md` | 正式 AC 待建立，矩阵暂以已批准规则 ID/ADR 条款作来源锚点；Feature Spec 建立后回填并删除例外 |
| `SUPERSEDED_WITHOUT_REPLACEMENT` | `knowledge/02-Business/E0-business-rule-review.md` | 历史文档未设 `superseded_by`；正文与 `related` 已指向已批准的 `E0-confirmed-inventory-decisions`、`E0-confirmed-operating-rules` |

### CLI 与机器可读输出

```text
node scripts/check-knowledge-structure.mjs [--root <dir>] [--checks links,wikilinks,frontmatter,adr,specs,superseded]
    [--exceptions <file.json>] [--json] [--summary-file <file>] [--no-github-summary]
```

- 退出码：无未豁免错误为 `0`，否则为 `1`；参数/例外清单错误也返回 `1`（JSON 摘要含 `SETUP_ERROR`）。
- `--json`：只输出一行 JSON；默认模式在人类可读输出之后追加 `KNOWLEDGE_STRUCTURE_RESULT {...}` 机器行。
- 摘要字段：`tool`、`version`、`root`、`checks`、`status`、`counts`（文件/链接/ADR/规格/测试计划等）、`errors`、`warnings`、`exceptions`、`unusedExceptions`。
- 设置 `GITHUB_STEP_SUMMARY` 时自动追加 Markdown 结论（CI 用）；`--summary-file` 可写本地文件。CI 另将 JSON 上传为 artifact。

### 本地验证证据

日志位于 [docs/evidence/sprint-e1/logs](./evidence/sprint-e1/logs/)。命令均在 `CMS_and_WMS` 下执行。

| 命令 | 退出码 | 结果 | 日志 |
|---|---|---|---|
| `node --test scripts/check-knowledge-structure.test.mjs` | 0 | 17/17 通过 | [e16-knowledge-node-test.log](./evidence/sprint-e1/logs/e16-knowledge-node-test.log) |
| `node scripts/check-knowledge-structure.mjs`（真实仓库基线全量，2026-11-10 快照，含 E1.8 Runbook） | 0 | 45 个 Markdown、0 error、3 条豁免 warning | [e16-knowledge-valid.log](./evidence/sprint-e1/logs/e16-knowledge-valid.log) |
| `node scripts/check-knowledge-structure.mjs --root scripts/fixtures/knowledge-structure/invalid` | 1 | 受控失败：16 条错误覆盖全部规则 | [e16-knowledge-invalid.log](./evidence/sprint-e1/logs/e16-knowledge-invalid.log) |
| 同上 + `--exceptions scripts/fixtures/knowledge-structure/invalid-exceptions.json` | 0 | 16 条例外全部转为 warning，0 error | [e16-knowledge-exceptions.log](./evidence/sprint-e1/logs/e16-knowledge-exceptions.log) |
| `python -c "import yaml; yaml.safe_load(open('.github/workflows/pr.yml', encoding='utf-8'))"` | 0 | PyYAML 语法解析通过 | [e16-workflow-yaml-parse.log](./evidence/sprint-e1/logs/e16-workflow-yaml-parse.log) |
| PyYAML 结构断言（job/触发/命令/文件存在性，临时脚本，含 build env 与 tracking 参数断言） | 0 | 全部通过 | [e16-workflow-validation.log](./evidence/sprint-e1/logs/e16-workflow-validation.log) |
| harness 退出码语义（受控 schema 漂移 + 正常迁移一致性） | 0 / 2 | 受控失败返回 2；正常路径 `No difference detected.` 返回 0 | [e16-harness-exit-semantics.log](./evidence/sprint-e1/logs/e16-harness-exit-semantics.log) |
| `npm run build`（工作区副本，仅占位 env） | 0 | 101.5s，19 个静态页面 | [e16-build-local.log](./evidence/sprint-e1/logs/e16-build-local.log) |
| `npm run build`（去掉 DB 占位 env 的对照） | 1 | 95s，`DATABASE_URL is not set` | [e16-build-env-needed.log](./evidence/sprint-e1/logs/e16-build-env-needed.log) |
| `npm run lint`（基线复核） | 0 | 0 error、13 warning（既有未使用变量） | [e16-lint-baseline.log](./evidence/sprint-e1/logs/e16-lint-baseline.log) |

说明：PyYAML 按 YAML 1.1 会把未加引号的顶层 `on` 解析为布尔键 `True`，这是预期行为，不影响 GitHub 解析；结构断言脚本同时兼容 `on` 与 `True` 两种键名。结构断言脚本为一次性本地验证（未新增仓库文件，避免超出本任务写入范围），输出已归档；可复现的最小语法校验即上表的一行 `python -c` 命令。

`--checks tracking` 不是空引用：`normalizeChecks` 将别名 `tracking` 映射为 `specs` 检查子集，`node:test` 用例 `tracking check subset only reports Feature Spec / test plan traceability` 同时验证有效样本通过、无效样本只报 `TEST_PLAN_*`/`FEATURE_SPEC_*` 错误，workflow 引用的参数有实现与测试覆盖。

`node --test` 覆盖：有效样本全绿；无效样本命中 `LINK_MISSING`、`WIKILINK_UNRESOLVED`、`WIKILINK_HEADING_MISSING`、`FM_MISSING`、`FM_PARSE_ERROR`、`APPROVED_METADATA_MISSING`、`ADR_ID_DUPLICATE`、`ADR_FILE_MISSING`、`SUPERSEDED_WITHOUT_REPLACEMENT`、`FEATURE_SPEC_TEST_PLAN_MISSING`、`TEST_PLAN_SPEC_MISSING`、`TEST_PLAN_SPEC_UNRESOLVED`、`TEST_PLAN_AC_UNKNOWN`；例外清单全部命中且无未使用项；`--checks tracking` 子集只报追踪类错误；frontmatter 解析器单元断言；输出确定性；失效例外告警；脚本仅 import Node 内置模块（无网络/无第三方依赖）。

### 在本地运行知识门禁

```text
node scripts/check-knowledge-structure.mjs            # 全量
node scripts/check-knowledge-structure.mjs --json     # 机器可读
node --test scripts/check-knowledge-structure.test.mjs
```

新增或修改知识文档后：优先修复真实问题；确属历史缺失或正式 AC 未建立时，在 `KNOWN_EXCEPTIONS` 增加条目（必须写理由与 owner），并在 PR 模板「知识同步清单」说明。

## 待决项（需维护者 / 后续 Sprint 处理）

1. **真实 GitHub Actions 运行**：本地无法推送 PR，尚无运行链接。维护者推送分支并创建 PR 后需取得：一次全绿运行链接、一次受控失败运行链接（例如故意破坏知识链接或让 unit 失败），确认失败结论与日志/artifact 可取得。E1 关闭前必须补齐。
2. **分支保护**：required checks 未在 GitHub 上启用；在维护者完成配置并验证「失败阻止合并」前，E1.6 只能标记为「本地自测通过，待独立验收」。
3. **E2E 依赖 E1.5**：`playwright.config.ts`、`tests/e2e/` 与 `npm run test:e2e` 的实际可跑性由 E1.5 交付；在此之前 `e2e` job 对匹配路径的 PR 可能失败，保持非 required。
4. **数据库 job 首次真实运行**：PG18 PGDG 安装、`PG_BIN` 与 owned-cluster 在 GitHub runner 上的耗时/兼容性需一次真实运行确认；合同中的 service container digest 固定仍待决。
5. **CI 首跑确认**：生产构建已在工作区副本用占位 env 实测通过（exit 0，101.5s，19 个静态页面；去掉 DB 占位 env 的对照失败），CI 中仍需在应用目录首跑确认 runner 环境一致；`npx tsc --noEmit` 以 PR 首跑为准（本地 E1.2 干净安装证据为 0）。
6. **知识基线会随 E1.5 回填 E1.1 文档而更新**：本文件记录的是 2026-11-09 工作区快照；E1.5 合并后应重新执行知识门禁，保证 0 error 与例外清单仍成立。
7. **Action 版本固定**：当前使用 `actions/checkout@v5`、`actions/setup-node@v4`、`actions/upload-artifact@v4` 主版本；如需 SHA 固定由维护者按仓库策略调整。

## 报告边界

本文与日志只包含命令、退出码、数量与相对路径；不含数据库连接串、密码、token 或生产数据。数据库测试使用每次运行随机生成的临时集群，由 harness 自动清理。
