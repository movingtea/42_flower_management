# Sprint E1.5–E1.8 DSH 交付简报与 E1 关闭清单（待独立验收）

2026-11-10。本简报覆盖 E1 剩余工作包：E1.5 浏览器 E2E、E1.6 PR 质量门禁、E1.7 知识同步门禁、E1.8 最小发布 Runbook，并汇总 E1 收尾门禁与关闭条件。前序工作包证据见 [E1.2/E1.4 简报](./sprint-e1-e12-e14-evidence.md) 与 [E1.3 简报](./sprint-e1-e13-evidence.md)。依据 [ADR-005](../knowledge/05-ADR/ADR-005-codex-dsh-responsibilities.md)，DSH 完成实现与自测，工程独立验收待 Codex 恢复后执行；业务规则与生产发布仍由项目用户批准。

## 开始基线

- 仓库 `CMS_and_WMS`，分支 `dev`，HEAD `99daac6`，工作区保留 E1.1–E1.4 未提交改动；未提交、未推送。
- Node v24.14.0、npm 11.11.1、Next.js 16.2.6、React 19.2.4、vitest 4.1.12、PostgreSQL 18 工具、Docker 29.9.2。
- 本轮新增依赖：仅 `@playwright/test` **1.58.0**（锁文件同步；选 1.58.0 是因为本机缓存的 Chromium 1208 与该版本匹配、可离线启动；Playwright 1.65 的浏览器下载在本机网络下不可用）。
- 本轮新增 npm scripts：`test:e2e`（`node scripts/with-v2-test-db.mjs -- npm run test:e2e:inner`）与 `test:e2e:inner`（`playwright test`）。

## E1.5 Playwright 浏览器 E2E

状态：**已交付并自测通过，待独立验收**。

### 交付物

| 文件 | 内容 |
|---|---|
| [playwright.config.ts](../flower-wms-system/playwright.config.ts) | testDir `tests/e2e`、baseURL `127.0.0.1:3100`、workers 1、串行、失败保留 trace/screenshot、HTML report、webServer 通过 `tests/e2e/start-dev-server.mjs` 启动。 |
| [tests/e2e](../flower-wms-system/tests/e2e) | 7 个 spec + helpers + 启动器：登录冒烟、主链路（serial 6 步）、补送与额外收货、库存复核与权限、取消释放预留、角色与门店权限、受控失败。 |
| [E1.1 追踪矩阵](../knowledge/specifications/test-plans/E1.1-p1-test-traceability.md) | 9 个场景回填 `tests/e2e` 位置与 2026-11-10 真实运行结果，新增「E1.5 浏览器 E2E 运行记录」章节与未覆盖缺口。 |
| `.gitignore` | 忽略 `test-results/`、`playwright-report/`、`blob-report/`、`.playwright/`。 |
| [eslint.config.mjs](../flower-wms-system/eslint.config.mjs) | ignores Playwright 生成物，避免 minified report/trace 被 lint（CI 干净 checkout 不受影响，但本地与重复运行需要）。 |

### 结果

- 全量入口：`npm run test:e2e`（应用目录，2026-11-10 13:25–13:29）→ 退出码 **0**，**20 通过 / 1 跳过 / 0 失败**，4.2 分钟（1 跳过为默认跳过的受控失败用例）。
- 数据与隔离：每次运行由 `scripts/with-v2-test-db.mjs` 创建一次性 PostgreSQL 18 集群并应用 V2 迁移与默认 seed；测试进程与 Next dev 共用同一 `V2_DATABASE_URL`；数据通过页面以唯一 marker 创建，账号为 seed 的 admin/manager/buyer/sales/florist（密码=用户名），storageState 按角色缓存；运行后无临时集群残留。
- 受控失败：`E2E_CONTROLLED_FAILURE=1 … --grep "受控失败"` → 退出码 **1**，在目标断言处失败，6.1 秒；trace、截图、error-context、HTML report 已归档到 [docs/evidence/sprint-e1/e15-artifacts](./evidence/sprint-e1/e15-artifacts/)，证明失败产物可定位。
- 环境结论（已写入配置注释与矩阵交接段）：harness 将回调 `NODE_ENV` 强制为 test，dev 端必须覆盖 `NODE_ENV=development`；Next 16 dev 必须绑定 `-H 127.0.0.1`，否则 `/_next` HMR/客户端被 `allowedDevOrigins` 拦截导致页面不 hydrate、表单退化为原生 GET；启动器每次先清 `.next/dev`，避免中断的 dev 让 `/api/auth/*` 返回 HTML 错误页（auth.js `ClientFetchError`）。未修改 `next.config.ts`、未改 `src/app/v2/**`、未新增 data-testid。
- 矩阵回填摘要：E11-PUR-02 与 E11-INV-06 升级为「已验证（服务 + 浏览器 E2E）」；E11-INV-02、E11-ORD-01、E11-PUR-01、E11-PUR-03、E11-PRD-01、E11-CST-01 补浏览器证据；E11-FUL-01、E11-AUTH-01 仍为部分；E11-CAT-01 偏差保持原样。
- 未覆盖缺口（已在矩阵登记）：V2 无独立“只读人员”角色，无法构造只读账号写入拒绝；配送重排的顾客确认/成品可交付条件/售后分流；改单补款退款与采购成本最终确认；跨店/跨租户、成员撤销、已有会话下一次写入；幂等键在浏览器层的重复提交。

## E1.6 PR 质量门禁

状态：**workflow、模板与本地验证已交付；真实 GitHub 运行与分支保护待维护者操作**。

### 交付物

- [.github/workflows/pr.yml](../.github/workflows/pr.yml)：仅 `pull_request` 触发，无部署、无 secrets、`contents: read`；`changes` 做路径分类。9 个 job：`knowledge-structure`、`lint`、`typecheck`、`unit`、`build`（必过，均无 job 级 `if`）、`db-regression`、`e2e`、`traceability`（条件执行，未适用时写显式 `NOT APPLICABLE` + notice，不记为通过）。
- [.github/pull_request_template.md](../.github/pull_request_template.md)：逐项询问业务规则、数据模型/迁移/seed、API 契约、ADR、测试计划/追踪矩阵、已知限制的影响，并要求文档链接或暂缓原因；附测试证据表与门禁清单。
- [docs/sprint-e1-ci-gates.md](./sprint-e1-ci-gates.md)：门禁设计、必过/条件检查、路径过滤、本地验证与分支保护说明。

### 本地验证

- workflow YAML：PyYAML 解析 exit 0；结构断言（触发/无 secrets/job 名称/命令/占位 env/tracking 参数/未适用结论）全部通过。
- `build` 占位 env 已实测必需：工作区副本构建 exit 0；去掉 `DATABASE_URL`/`V2_DATABASE_URL` 后 exit 1（`DATABASE_URL is not set`）。
- `db-regression` 失败语义已实测：schema 漂移时 Prisma `migrate diff --exit-code` 返回 2，harness 原样返回，非零可被 job 捕获；空库 `migrate:check` 正常返回 0。
- `traceability` 使用 `check-knowledge-structure.mjs --checks tracking`，该参数已实现并被 node:test 覆盖。
- 收尾时补充：`typecheck` job 增加 `npx next typegen` 步骤（干净 checkout 没有 `.next/types`，直接 `tsc --noEmit` 会失败），并同步更新门禁文档；本地执行 `next typegen` + `tsc --noEmit` 退出 0。
- registry：所有 job 在 `npm ci` 前强制官方 registry 并 `replace-registry-host always`，规避本机 npmmirror 的 vitest 包故障。

### 待决（维护者权限）

真实 PR 运行链接（一次全绿 + 一次受控失败及 artifact）、分支保护 required checks 启用与「失败阻止合并」验证（建议 required：`knowledge-structure`、`lint`、`typecheck`、`unit`、`build`）、CI 首跑确认 PG18/PGDG 安装、service container digest 固定、ACR/GitHub secrets。

## E1.7 知识同步门禁

状态：**校验脚本与 PR 集成已交付并自测通过**。

- [scripts/check-knowledge-structure.mjs](../scripts/check-knowledge-structure.mjs)：纯 Node 内置模块、无网络。规则：Markdown 相对链接存在性、Obsidian wikilink/heading/embed 解析、frontmatter 存在与解析、approved 文档 owner/version/updated、ADR ID 唯一与 register 互指、Feature Spec↔测试计划互引、superseded 替代指向；历史缺口与正式 AC 未建立以显式例外清单放行（带 reason/owner），输出 JSON 摘要与 0/1 退出码。
- [校验用例](../scripts/check-knowledge-structure.test.mjs) 与 [fixtures](../scripts/fixtures/knowledge-structure)：有效/无效样本覆盖全部规则。
- 结果：真实仓库全量扫描 **exit 0**（47 个 Markdown、0 error、3 条登记例外 warning）；`node --test` **17/17 通过**；无效样本 **exit 1**（16 条错误覆盖全部规则）；加入例外清单后 exit 0（16 warning）。原始日志：[e16-*](./evidence/sprint-e1/logs/)。
- 已作为 PR workflow 的 `knowledge-structure` job（每个 PR 全量扫描，不被路径过滤跳过）与 `traceability` job 接入。当前 3 条例外：正式 Feature Spec/AC 未建立 2 条、历史 superseded 文档 1 条。

## E1.8 最小发布 Runbook 与非生产演练

状态：**Runbook 与演练资源已交付，非生产 Compose 演练通过；生产发布审批与若干前提待项目用户/维护者决定**。

### 交付物

- [docs/flower-studio-2.0-release-runbook.md](./flower-studio-2.0-release-runbook.md)（760 行）：联系人/故障记录模板、发布前检查、备份与恢复、V1/V2 migration status 与迁移前后行数核对、按 SHA 部署 web+cron（与 deploy.yml 的 override 机制一致）、健康检查与核心冒烟、失败停止条件 S1–S12、应用镜像回滚、不可逆迁移清单与回滚兼容前提、ADR-001 的 V1/V2 归属与退役条件、已知风险与待决项。
- [deploy/rehearsal](../deploy/rehearsal)：隔离可复跑的 Compose override、env 模板、Dockerfile 模板、SQL 检查、PowerShell 脚本与 README。
- 证据：`docs/evidence/sprint-e1/logs/e18-*-20261110-105256.log`（9 个），run_id `20261110-105256`。

### 演练结果（exit 0，约 5.2 分钟）

隔离栈：项目 `flower-e1-8-rehearsal`、web `127.0.0.1:18080`、db `127.0.0.1:15432`、V1/V2 独立库；使用本地预构建应用镜像 + 人工 SHA 标签模拟“按提交 SHA 部署/回滚”（当前代码真实 `docker build` 因 npm 镜像故障与无 ACR/GitHub 凭据无法在本机完成，已明确记录边界）。

- 成功路径：entrypoint 应用 V1 45 / V2 7 迁移 → `/api/health` 200 → `/login` 200、`/v2` 307 → 生产初始化 → 迁移前后行数核对通过；cron 首轮瞬时 P2021/P2022 后恢复成功轮次。
- 备份/恢复：`pg_dump -Fc` V1/V2 → `pg_restore` 临时库 → 关键表行数与迁移历史差异 0。
- 增量迁移：V2 7→8 实际应用、业务行数不变；回滚旧镜像在 8 迁移 schema 上 health 200、冒烟通过（加列/加枚举值向后兼容）。
- 失败停止：V1/V2 同名目标、目标不可达（`--connect`/entrypoint P1001）、缺陷镜像健康失败（容器 Exited(1)）均停止且未继续冒烟。
- 镜像回滚：坏 SHA → 上一版 SHA，10 秒内 health 200、冒烟通过，数据库保持前滚（未回滚）。
- 清理：演练容器/卷/网络 0 残留，未触碰原有 `flower-v2-pg`；无真实连接串/密码写入证据。

### Runbook 关键发现（生产发布前需处理）

1. **高**：生产 Compose 的 db 卷挂载 `/var/lib/postgresql/data` 与 `postgres:alpine`（现为 PG18.6，`PGDATA=/var/lib/postgresql/18/docker`）不匹配，重建容器可能丢数据；需固定镜像版本或修正挂载（本次未改生产 Compose）。
2. **高**：ADR-002 的备份周期/异地保留/RPO/RTO/恢复责任人仍待项目用户确认，Runbook 只提供操作模板。
3. **中**：entrypoint 不带 `--connect` 时可能自动创建目标库；发布预检必须使用 `--connect` 且 V2 库须人工预建。
4. **中**：工作区曾有空的未跟踪 V1 迁移目录 `prisma/migrations/0008_purchase_supplements_and_inventory_review/`，已在收尾时清理；真实构建前建议再次核对。
5. **低**：cron 与 web 并行启动的首轮瞬时错误需在发布后确认成功轮次。

## E1 关闭门禁：最终干净环境复跑

2026-11-10 收尾，先做真实干净安装（官方 registry + `replace-registry-host always`，与 PR workflow 相同），再按顺序执行：

| 命令 | 退出码 | 结果 |
|---|---|---|
| `npm ci`（干净删除 node_modules 后） | 0 | 安装 626 个包（2 分钟），`@playwright/test` 1.58.0 / next 16.2.6 / vitest 4.1.12 |
| `npx next typegen` + `npx tsc --noEmit` | 0 / 0 | 路由类型生成成功，无类型诊断 |
| `npm run lint` | 0 | 0 error、15 warning（既有未使用变量/表达式告警；Playwright 生成物已加入 ESLint ignores） |
| `node scripts/check-knowledge-structure.mjs` | 0 | 47 Markdown、0 error、3 条登记例外 warning |
| `node --test scripts/check-knowledge-structure.test.mjs` | 0 | 17/17 |
| `npm run test:unit` | 0 | vitest 10/10、工具自检 34/34、unit runner 9/9 文件 |
| `npm run test:ci` | 0 | 39 条旧测试入口 + vitest 10/10 + 自检 34/34 + V2 集成 32/32 + 冒烟 4/4 |
| `npm run test:e2e` | 0 | 20 通过 / 1 跳过 / 0 失败，4.2 分钟；无临时集群残留 |
| `npm run build`（CI 占位 env） | 0 | 生产构建成功（57 秒），路由正确生成 |
| 受控失败 E2E | 1（预期） | 在目标断言处失败，trace/截图/error-context/HTML report 可定位 |

日志：[e1-final-*.log](./evidence/sprint-e1/logs/)（npm ci、typegen、typecheck、lint、knowledge、unit、test:ci、test:e2e、build）。

### 交接关闭条件对照

| 关闭条件（交接文档） | 当前状态 |
|---|---|
| 干净环境 `npm run test:ci` 通过 | ✅ 干净 `npm ci` 后 exit 0 |
| 现有 V1/V2 测试保留 | ✅ 39 条旧测试入口 + 32 个 V2 测试文件 + 4 条冒烟全部通过 |
| 隔离库自动创建与清理 | ✅ harness 运行后无临时集群/数据库残留 |
| 核心 E2E 与失败产物可复查 | ✅ 20 通过/1 跳过；受控失败 trace/screenshot/report 已归档 |
| 空库迁移可验证 | ✅ harness 每次空库应用 8 项迁移 + 一致性检查；PR workflow 有 `migrate:check` step |
| 分支保护阻止失败合并 | ❌ 待维护者启用并验证（required check 名称已列出） |
| 规则与验收证据可追溯 | ◐ E1.1 矩阵已回填 E2E 结果与缺口；正式 Feature Spec/AC 仍待建立 |
| Runbook 完成非生产演练 | ✅ Compose 演练通过（成功/失败停止/回滚/备份恢复/清理）；生产前提待决 |
| 标记「待独立验收」并单列业务决策/权限操作 | ✅ 见下节 |

**E1 结论：DSH 范围内实现与自测完成，E1 整体标记「待独立验收」。** 分支保护、真实 CI 运行、生产发布与下列业务决策不属于 DSH 可独立完成的范围。

## 剩余业务决策与权限操作（需项目用户/维护者）

1. **分支保护与真实 CI**（维护者）：推送 `dev` 分支与 PR，取得一次全绿 + 一次受控失败的 GitHub 运行链接；启用 required checks（`knowledge-structure`/`lint`/`typecheck`/`unit`/`build`）并验证失败阻止合并；配置 PG18 runner/首跑确认。
2. **生产发布前提**：修正或固定生产 Compose 的 PostgreSQL 卷/镜像（E1.8 发现 1）；确认 ADR-002 的备份周期、异地保留、RPO/RTO 与恢复责任人（发现 2）；确认不可逆迁移（V2 0001/0008）与回滚策略；ACR/GitHub secrets 与真实镜像构建。
3. **业务规则待定**：默认 SKU 停用顺序（E11-CAT-01 偏差）；配送重排的顾客确认、成品可交付条件与售后分流；细粒度权限（V2 无独立只读角色、跨店/成员撤销/已有会话写入）；正式 Feature Spec/AC 编号建立后回填矩阵并删除知识例外。
4. **后续测试补强**：供应商 master-data 服务层事务不变量（层 3）测试；E1.5 未覆盖的浏览器分支；E1.6 service container digest 固定与 CI 首跑调优。

## 清理与未改动项

- 未提交、未推送；未修改生产 Dockerfile / docker-compose.example.yml / deploy.yml / 生产 Compose。
- 临时数据库集群、演练容器/卷/网络、Playwright 生成物均已按需清理；`test-results/` 与 `playwright-report/` 在 .gitignore 中，受控失败产物单独归档。
- 未变更业务规则、数据模型、API 契约或 ADR；E1.1 矩阵只补充测试位置与真实结果。

## 知识修订建议

- [E1.1 P1 追踪矩阵](../knowledge/specifications/test-plans/E1.1-p1-test-traceability.md) 已回填 E1.5；正式 Feature Spec/AC 建立后需回填 AC ID 并删除 2 条知识例外。
- 交接文档 E1.5–E1.8 状态可回填：E1.5/E1.6/E1.7/E1.8 实现与自测完成，E1 整体待独立验收；分支保护与真实 CI 为维护者待办。
- 建议在 ADR 或运行文档中登记 E1.8 发现的 Compose 卷/镜像不匹配与 ADR-002 备份决策；二者涉及生产发布，需项目用户批准后更新。
- 建议在知识治理中记录：Playwright 生成物必须被 lint/构建忽略；CI typecheck 需先 `next typegen`；E2E 使用一次性数据库与合成账号。
