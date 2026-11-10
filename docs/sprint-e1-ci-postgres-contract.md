---
title: E1.4 与 E1.6 的 CI PostgreSQL 隔离合同
type: engineering-contract
module: quality
status: draft
version: 1
owner: engineering
updated: 2026-11-09
sources:
  - "docs/sprint-e-dsh-handoff.md"
  - "flower-wms-system/scripts/with-v2-test-db.mjs"
  - "flower-wms-system/scripts/test-v2.mjs"
  - "flower-wms-system/prisma/v2/seed.ts"
related:
  - "[[ADR-005-codex-dsh-responsibilities]]"
  - "[[E0-adr-register]]"
---

# E1.4 与 E1.6 的 CI PostgreSQL 隔离合同

E1.4 负责隔离数据库、测试数据分层和专项证据；E1.6 负责 PR 质量门禁。本文件固定两者的接口，避免 CI 绕过本地验收前提。工作包归属：E1.4 已在本地实现并由 DSH 自测，E1.6 的 workflow 由 C 包落地，本文件待 Codex 独立验收后转为 approved。

## E1.4 已交付的接口

- **owned cluster 入口** `node scripts/with-v2-test-db.mjs [--legacy] -- <node|npm> [args...]`：每次运行用 `mkdtemp` 创建独立 PostgreSQL 集群，随机 loopback 端口（拒绝 5432），每次运行随机密码，执行 V2 迁移、一致性检查和测试 Seed 后运行一次回调，随后停止实例并删除目录。调用方不能提供数据库 URL，也不能回退到开发者或生产连接。
- **数据库模式校验** `scripts/test-v2.mjs`：数据库模式要求 `WMS_TEST_DB_MANAGED=1`，`V2_DATABASE_URL` 必须为 `127.0.0.1`、显式非 5432 端口、库名匹配 `wms_<16+ 位小写十六进制>_test`、不带 query/fragment。查询/跳过都会使门禁失败。错误信息只描述变量与期望，不回显 URL 或凭据。
- **测试数据分层** `tsx prisma/v2/seed.ts test [--tiers=...]`：tiers 为 `minimum`、`roles`、`p1-scenarios`、`e2e-fixtures`，按依赖顺序应用，默认 `minimum+roles` 与既有 `db:v2:seed:test` 行为一致。E1.5 的浏览器夹具使用 `roles,e2e-fixtures`。
- **专项证据**：并发隔离、数据库不可用、迁移失败、中断退出由 `scripts/v2-test-db-harness-specials.test.mjs` 覆盖（E1.4 自测证据见交接简报）。

## 模式 A（默认）：CI 使用 owned cluster

与本地验收完全一致，优先用于 unit、旧测试回归、V2 集成与冒烟、空库迁移检查。

- runner 安装 PostgreSQL 18 服务端与客户端工具（`initdb`、`pg_ctl`、`createdb`、`psql`），加入 PATH；无法加入 PATH 时用 `PG_BIN` 指向工具目录。
- job 直接调用 `npm run test:unit`、`npm run test:legacy`、`npm run test:v2:db`、`npm run test:ci`，由 harness 自建并清理集群。
- 要求：job 用户可 `initdb`，临时目录可写；每个 job 的集群互不共享。
- 并发安全：端口由 harness 在运行时分配并校验，不写死端口；同一 runner 上的并行 job 不会复用集群目录。

## 模式 B：GitHub Actions service container

适用于需要 Docker service 或希望缩短 job 启动时间的 PR 检查，尤其是后续 E1.5 的 Playwright job。

- **镜像与端口**：`services.postgres.image` 固定 `postgres:18`（正式落地时固定 digest）；`ports: ['55432:5432']`。必须映射到非 5432 的宿主机端口，因为 `validateManagedDbEnv` 拒绝 5432。health check 使用 `pg_isready`。
- **库名**：每个 job 使用唯一库名，例如
  `wms_$(printf '%s' "$GITHUB_RUN_ID-$GITHUB_JOB-$GITHUB_RUN_ATTEMPT" | sha256sum | cut -c1-16)_test`。
  需要旧测试时另建 `wms_<同一 hex>_legacy_test`，V2 与 V1 库名必须不同。
- **环境变量**：`WMS_TEST_DB_MANAGED=1`、`V2_DATABASE_URL=postgresql://postgres:<job 随机密码>@127.0.0.1:55432/<v2 库>`，需要旧测试时再设 `DATABASE_URL=.../<legacy 库>`。连接串只放 env，日志和报告不得输出。密码每 job 生成，不复用。
- **步骤顺序**：创建数据库 → `npm run db:v2:migrate:deploy` → `npm run db:v2:migrate:check` → `npm run db:v2:seed:test`（E2E job 改为 `tsx prisma/v2/seed.ts test --tiers=roles,e2e-fixtures`）→ 运行测试。旧测试需要的 V1 库用当前 schema 执行 `prisma db push --config prisma.config.ts` 初始化，不跑 V1 历史迁移链（历史迁移在本机空迁移目录复跑会报 P3015，见 E1.1 交接记录）。
- **禁止**：模式 B 下运行 `test:ci`、`test:legacy`、`test:v2:db`（它们会尝试自建集群并要求 PG 工具）；禁止跨 job 复用同一数据库；禁止对共享或生产库执行 force reset。
- **隔离**：每个 job 独立容器、独立库名；E2E 与 integration 不得共享库；同一 job 内测试串行（V2 runner 逐文件串行，harness 每次只运行一个回调）。

## 必过检查与模式映射

E1.6 负责在 workflow 中落地并列出实际必过检查名称；分支保护启用后才可声明“失败阻止合并”。

| 检查内容 | 触发范围（建议） | 模式 |
|---|---|---|
| 知识结构校验、Markdown/wikilink/YAML/ADR 引用 | 知识或 docs 变更 | 无需数据库 |
| ESLint、TypeScript、单元测试、生产构建 | 全部 PR | 无数据库或模式 A |
| V2 集成 + 冒烟 | `prisma/`、`src/v2/`、`src/app/v2/`、seed、迁移变更 | A 或 B |
| 旧测试回归（`test:all` + 订单过期） | `src/services/`、`src/lib/`、`prisma/` 相关变更 | A 或 B（B 需 V1 push） |
| 空库迁移与一致性检查 | 迁移文件、schema、Prisma 配置变更 | A 或 B |
| 全量 `test:ci` | 发布分支或 nightly | A |
| 关键 E2E | E1.5 落地后 | B |
| 数据库专项（并发/失败/中断） | harness 或 DB 入口变更、nightly | 模式 A |

路径过滤器不得让必过检查被绕过：必过检查由分支保护绑定，未适用项要显式记录为未适用，不能记为通过。模式 B 中迁移或 Seed 失败必须使 job 失败。

## 未决项

- service container 镜像 digest 固定、PG 18 与 runner 镜像的兼容性由 E1.6 落地时验证。
- PR workflow 文件名与必过检查名称待 C 包落地后回填本表。
- 失败日志、trace 和报告的 artifact 保留期。
- E1.5 浏览器 job 的 E2E 数据重置策略（新库 + 重新应用 tier，不使用跨 job 复用）。
