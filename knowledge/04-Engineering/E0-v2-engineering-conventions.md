---
title: V2 工程约定 · 编号、抽屉与数据重置
type: engineering-convention
module: platform
status: draft
version: 1
owner: engineering
updated: 2026-11-19
sources:
  - "flower-wms-system/src/v2/domain/identifiers.ts"
  - "flower-wms-system/src/app/v2/_components/V2Drawer.tsx"
  - "flower-wms-system/scripts/v2/reset-business-data.mjs"
  - "docs/flower-studio-2.0-local-run.md"
related:
  - "[[E0-known-gaps]]"
  - "[[E0-v1-v2-ownership]]"
---

# V2 工程约定 · 编号、抽屉与数据重置

本页记录 2026-11-19 物料母表补齐与界面统一时确定的工程约定。约定不改变已批准业务规则；业务口径仍以 [[E0-confirmed-operating-rules]] 等 approved 文档为准。

## 1. 业务编号由系统生成

- 规则：门店员工不手工填写业务编号。编号在服务端创建时生成，编辑时忽略界面传入的编号。
- 格式：`<前缀>-<UTC 日期 YYYYMMDD>-<8 位随机码>`，实现见 `src/v2/domain/identifiers.ts` 的 `generateDatedIdentifier` 与 `generateEntropy`。
- 已自动生成的对象与入口：物料 `MAT`、供应商 `SUP`、包装方案 `PKG`、采购单 `PO`、商品 `PRD`、SKU `SKU`、样品 `SMP`、库存批次 `BATCH`；盘点单、损耗单、收货单与收退款幂等键由服务端确定性生成。
- 例外（保持人工输入）：员工登录名 `StaffUser.username`；租户 `Tenant.slug`、门店 `Store.code`、库位 `InventoryLocation.code` 仅在 seed / 生产初始化脚本中出现，界面不提供创建入口。
- 兼容边界：服务层仍接受显式编号（导入、接口与测试使用）；界面不传编号。`updateMaterialMaster` 对编号输入为静默忽略，不再报“编码不能修改”。
- 测试约定：E2E 通过反馈横幅读取系统生成的编号（`material 已创建，编号 …`），不再假设编号由测试指定。

## 2. 新增/编辑统一使用右侧抽屉

- 组件：`src/app/v2/_components/V2Drawer.tsx` 的 `V2DrawerForm`，从右侧滑出，固定页脚“取消/保存”，支持遮罩与 Escape 关闭、body 锁滚和焦点恢复。
- 用法：页面传入 `triggerLabel`、`title`、`action`（现有 server action）与服务端渲染的表单字段；抽屉不复制业务逻辑。
- 关闭时机：server action 以 `redirect(?message=…)` 结束时，组件监听查询串变化自动关闭，避免保存后残留旧面板。
- 覆盖范围：物料、供应商、商品/SKU、配方草稿/发布/停用、包装方案、样品/打样计划、原材料分类、采购草稿、批次不明损耗等新增/编辑入口；行内业务操作（验收、拒收、补单、盘点、制作转移等）保持原布局。

## 3. V2 数据库业务数据重置

- 脚本：`flower-wms-system/scripts/v2/reset-business-data.mjs`。
- 保留：`Tenant`、`Store`、`InventoryLocation`、`StoreSettings`、`StaffUser`、`TenantMember`、`StoreMember` 与 `_prisma_migrations`；清空其余 66 张业务表，并删除没有成员归属的测试租户/门店。
- 安全：仅允许本地 `_test` / `_dev` 库（`--force` 可覆盖）；执行前写入 `pg_dump` 自定义格式备份到 `.runtime/db-backups/`，并校验 `pg_restore --list` 可读；输出保留行数与回滚命令。
- 命令：`node --env-file=.env.local scripts/v2/reset-business-data.mjs`（`--dry-run` 只统计）。V1 数据库不在脚本作用范围。

## 4. 验证记录（2026-11-19）

- `npx tsc --noEmit`、`npm run lint`、`npm run test:unit`、`npm run build`、`npm run db:v2:migrate:check` 全部通过。
- Playwright E2E 可真实运行：`main-chain.spec.ts` 6/6 通过；全量 23 通过 / 2 失败 / 1 跳过，失败为既有 smoke 标题层级断言（已修正），修正后 smoke 复跑通过。
- 业务数据重置已在本机 `flower_v2_test` 执行：备份写入 `.runtime/db-backups/`，业务表清空、6 个用户与 1 租户/1 门店/2 库位/门店设置保留。

