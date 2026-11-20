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

## 5. 花材/耗材双页面与花材三级分类（2026-11-19）

- 页面拆分：`/v2/materials` 为花材母表（`MaterialKind.FLOWER`、`FOLIAGE`），新增 `/v2/consumables` 为耗材母表（`PACKAGING`、`CONSUMABLE`、`OTHER`）。两页共用 `src/app/v2/materials/_components/` 的查询、表格、抽屉与行内表单，`page.tsx` 只传 scope 配置；仍只有一个 `Material` 数据模型，配方、库存、采购不受影响。
- 返回路径：两页共用 `src/app/v2/materials/actions.ts`。表单提交 hidden `returnTo`，服务端用 `MATERIAL_RETURN_TO_PATHS` 白名单限定 `/v2/materials` 与 `/v2/consumables`，非法值回落花材母表，禁止开放重定向。
- 三级分类：花材按 `Material.flowerVariety`（种类，如玫瑰）→ `Material.color`（颜色，如粉色）→ `Material.flowerProductName`（商品名，如玛格丽特）维护，表单与列表筛选都按此顺序级联。两个新增字段可空、仅 FLOWER/FOLIAGE 保留，商品名非空时必须有种类；存量数据不强制回填。颜色仍复用既有 `color` 字段，`colorTags` 仅作辅助标签、不参与三级筛选。
- 名称选填：花材的 `Material.name` 允许留空，服务端按“种类 · 颜色 · 商品名”自动生成（如 `玫瑰 · 粉色 · 玛格丽特`），仍允许手填覆盖；耗材没有三级分类，名称保持必填。数据库列保持非空，不做删列迁移。
- 打样复用建议：`sample-planning` 以“三级全同优先、其次种类+颜色相同”作为推荐样品的排序信号，并写入 `candidateSnapshot.suggestedSampleReasons`；分类匹配只影响排序与提示，不改变实际复用量、成本与预留（WMS-BR-SMP-001/002/003）。旧快照无该字段时页面不显示徽标。
- 已放弃/待评审：花材编辑隐藏品牌/型号字段，历史上若有值会在保存时清空（V1 FlowerWiki 无此字段，暂无生产数据）；花材三级分类目前是自由文本 + 级联联想，未建字典表，是否需要规范化分类树待业务确认。

