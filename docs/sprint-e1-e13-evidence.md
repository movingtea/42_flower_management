# Sprint E1.3 项目 Next.js 测试 Skill · DSH 自测简报（待独立验收）

2026-11-10。交接来源见 [sprint-e-dsh-handoff.md](./sprint-e-dsh-handoff.md) 的「E1.3 · 项目 Next.js 测试 Skill」。依据 [ADR-005](../knowledge/05-ADR/ADR-005-codex-dsh-responsibilities.md)，DSH 完成 Skill 编写与走读验证，工程独立验收待 Codex 恢复后执行。业务规则未变更，未新增依赖或 npm script。

## 开始基线

- 仓库 `CMS_and_WMS`，分支 `dev`，HEAD `99daac6`；工作区沿用 E1.2／E1.4 的未提交改动（未提交、未推送）。
- 应用 `flower-wms-system`：Node v24.14.0、npm 11.11.1、Next.js 16.2.6、React 19.2.4、next-auth 5.0.0-beta.31、vitest 4.1.12。
- 依赖现状：`@testing-library/react|dom`、`jsdom`、`@vitejs/plugin-react`、`msw`、`@playwright/test`、`vitest-axe` 均**未安装**；`axe-core` 仅作为传递依赖存在。按交接要求「依赖安装由实际测试工作包按需处理」，本次没有新增依赖。
- 写入核实：`D:\My-project\flower-studio-ecosystem\.agents\skills` 可写；新 Skill 直接落在该目录，无需“审阅稿 + 安装待办”的降级路径。

## 交付物

| 文件 | 内容 |
|---|---|
| `.agents/skills/wms-nextjs-testing/SKILL.md` | 项目专用 Next.js／React 测试 Skill：测试层级选择、Next 16／React 19 对测试的影响、项目约定、命令、反模式。frontmatter 沿用现有 WMS Skill 的 `name` + `description` 结构。 |
| `.agents/skills/wms-nextjs-testing/references/examples.md` | 9 组最小仓库示例：vitest 纯逻辑、script-style 单测、Server Action 模块替身、RSC 页面映射、Route Handler、Auth.js 与 capability、隔离数据库 Prisma 服务、Playwright + a11y（计划）、MSW（计划）。每个示例都指向仓库真实文件与可执行命令。 |
| `.agents/skills/wms-nextjs-testing/references/walkthrough.md` | 用一项实际 WMS 变更走读：V2 供应商写入入口 Action 层测试。记录分层取舍、实现、真实命令与结果、剩余缺口。 |
| `flower-wms-system/src/app/v2/suppliers/actions.test.ts` | 走读落地的 Action 层测试（6 组断言）：capability、FormData 映射、service 参数、成功／失败／无权限 redirect、`NEXT_REDIRECT` 原样抛出。 |
| `CMS_and_WMS/AGENTS.md` | 任务表新增一行：页面、Client Component、Server Action、Route Handler、Auth.js、Prisma 服务测试先读本 Skill 与已安装 Next 指南。 |
| `flower-wms-system/AGENTS.md` | 应用指令补一句：Next.js／React 测试工作先加载 workspace Skill。 |

`SKILL.md` 与 references 不含 Vite、TanStack Router、FastAPI 或无关项目夹具；这三者在反模式一节被明确列为禁止引入。仓库内不存在可继承的候选 Skill（全仓除交接文档外无相关引用），因此按现有 WMS Skill 结构新写。

Skill 位于 workspace 根 `.agents/skills`，不在 `CMS_and_WMS` Git 仓库内（与既有 WMS Skill 相同），因此不进入该仓库的 git 状态和提交；交付路径为 workspace 级文件。`SKILL.md` 的 `name` 与目录名一致（`wms-nextjs-testing`），frontmatter 仅含 `name`、`description`，与现有 WMS Skill 结构一致。

## 覆盖对照（交接要求）

| 交接要求 | 落点 |
|---|---|
| Next.js 16 App Router、React 19 | Skill 的「Next.js 16 / React 19 facts」：Promise `params`/`searchParams`、`PageProps<"/path">`、async `cookies()`/`headers()`、async Server Components 不能进 Vitest。 |
| Server／Client Components | 分层规则：页面决策抽到 `_lib` 层 1 测试；异步 RSC 与浏览器语义走层 5；Client Component 交互用 Testing Library（计划）或 Playwright。 |
| Server Actions | 层 2 模式：`module.registerHooks` + `typescript` 转译 + 模块替身；断言 capability、FormData、redirect feedback、digest 重抛。走读落地实现。 |
| Route Handlers | 层 4：直接调用导出 handler，`new Request(...)` 断言状态/JSON；需要持久化断言时下移层 3。 |
| `next/navigation` | Client-only hooks 不挂载；服务端 `redirect()` 的 NEXT_REDIRECT 语义与 stub 捕获方式；async 页面 props。 |
| Auth.js 会话 | `authenticateV2Staff` 的依赖注入缝、`resolveV2Access` 能力判定、DB 会话用隔离库 + 测试账号；action 测试 stub `@/auth`、`@/v2/auth`。 |
| Prisma 服务替身 | 层 2 用最小 `{ $transaction }` 替身；明确禁止在库存、预留、成本、审计不变量上替身；层 3 用真实隔离库。 |
| Testing Library | 给出安装清单、使用条件（jsdom + plugin + `render`/`screen`/`userEvent`）与「由需要它的测试工作包安装」的边界。 |
| MSW | 计划项：用于外部 HTTP 依赖（微信、OSS、AI），mock `fetch` 边界，未安装不引入。 |
| Playwright 与可访问性 | 计划项（E1.5）：隔离库 + `db:v2:seed:test:e2e`、按可访问名称定位、失败 trace/screenshot；axe 由同一工作包引入；另列人工 a11y 检查点。 |
| 测试层级与最小示例、运行命令 | SKILL.md 层表 + 命令表；examples.md 9 组示例。 |
| 用实际 WMS 变更走读并运行示例 | 供应商写入入口 Action 层测试 + 真实运行结果（见下）。 |

## 走读验证结果（真实运行）

变更内容：为 V2 供应商三个写入 Server Action 补 Action 层测试，关闭 E1.1 `E11-AUTH-01` 中「单个写入入口的只读角色拒绝」缺少 Action 层证据的缺口；不改变产品行为。分层选择：纯逻辑层无法覆盖（变更在 `"use server"` 动作里），孤立数据库层对本断言过重，Route Handler 不适用，Playwright 未安装且非必需，因此选择层 2（Action 模块替身）。

| 命令 | 退出码 | 结果 |
|---|---|---|
| `npx tsx src/app/v2/suppliers/actions.test.ts` | 0 | `v2 supplier action tests passed`（6 组断言） |
| `npx tsc --noEmit` | 0 | 无诊断 |
| `npm run test:unit` | 0 | vitest 10/10、工具自检 34/34、unit runner **9/9** 文件（新文件被 DB-free 分类自动发现） |
| `node scripts/test-v2.mjs unit --list` | 0 | 9 个文件，含 `src/app/v2/suppliers/actions.test.ts` |
| `node scripts/test-v2.mjs integration --list` | 0 | 32 个文件，含新文件 |
| `npm run test:integration:v2` | 0 | 32/32 个测试文件通过（隔离 PostgreSQL）；运行后无临时集群残留 |
| `node --test scripts/test-v2.test.mjs scripts/with-v2-test-db.test.mjs` | 0 | 34/34（包含独立发现与分类自检，无需为新文件改自检） |
| `npm run test:ci` | 0 | 最终树全量：39 条旧测试命令 + vitest 10/10 + 自检 34/34 + 32 个集成文件 + 4 条冒烟，无临时集群残留 |

原始日志：[docs/evidence/sprint-e1/logs](./evidence/sprint-e1/logs/) 下 `e13-*`（`e13-typecheck.log` 为空输出，即无诊断）。说明：E1.2 简报中的 unit 8／integration 31 是当时基线；E1.3 新增测试文件后分别为 9／32，属预期发现行为。

## 运行方式与 Skill 生效

- Skill 通过 workspace `.agents/skills` 自动发现；当前会话的 Skill 目录在会话开始时加载，因此本会话目录里看不到新条目，**下一次会话或重载后** `wms-nextjs-testing` 才会出现在可用 Skill 列表中。建议验收时重载会话确认。
- Skill 未绑定新的 npm script：示例直接使用 `npx tsx`、`npx vitest run` 和既有 `test:unit`／`test:integration:v2`／`test:smoke:v2`／`test:ci`／`test:db:harness-specials`。

## 待决项与风险

1. **独立验收**：Skill 内容与走读证据待 Codex 复核，尤其「分层规则是否覆盖所有 V2 写入入口」和「计划依赖的安装边界」。
2. **尚未安装的测试依赖**：Testing Library、jsdom、@vitejs/plugin-react、MSW、Playwright、axe 均留待 E1.5 或相应测试工作包安装并配置；本 Skill 明确禁止在文档包中新增。
3. **供应商服务层缺口**：本次走读只覆盖 Action 契约；`src/v2/services/master-data.ts` 的租户范围、审计与重复编码等事务不变量仍缺层 3 测试，建议并入 E1.1 权限／数据范围工作包或 E1.5。
4. **浏览器与可访问性证据**：供应商表单的浏览器交互、只读角色按钮可见性和正式 axe 检查要等 E1.5 的 Playwright 接入。
5. **候选 Skill 来源**：仓库内没有可继承的候选 Skill 文件（交接所述 Vite/TanStack/FastAPI 示例不在仓库中），因此按现有 WMS Skill 结构全新编写；若验收者手中有原候选稿，可对比命名与描述风格。

## 清理与未改动项

- 未新增依赖、未修改 `package.json`／`package-lock.json`／`vitest.config.ts`；未提交 git、未推送。
- 运行后无临时数据库集群残留；未删除或修改其他包的文件。
- 未变更业务规则、数据模型、API 契约或 ADR。

## 知识修订建议

- [E1.1 P1 追踪矩阵](../knowledge/specifications/test-plans/E1.1-p1-test-traceability.md)：`E11-AUTH-01` 可登记供应商写入入口的 Action 层证据（部分覆盖，服务层与浏览器仍缺），并在「复跑与后续交接」补充新 Skill 与命令行。
- 交接文档 E1.3 行可回填：Skill 已交付，走读通过，等待会话重载确认目录发现与 Codex 验收；计划依赖由 E1.5 工作包安装。
- 建议在知识治理中记录：Skill 目录位于 workspace 根 `.agents/skills`，修改后需重载会话才能被 Skill 目录收录；`AGENTS.md` 已加入任务路由。
