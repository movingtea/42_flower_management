# LOP 清单（Limitation / Open Point）

> 记录已知限制、待办批次与当前状态。  
> 应用根目录：`flower-wms-system/`

---

## LOP-020 — MasterPart 通用物料母表

| 字段 | 内容 |
|---|---|
| **标题** | 非花材通用物料母表（MasterPart） |
| **状态** | **Partially Fixed**（采购保存层 Fixed；库存入库层待后续） |
| **批次** | Batch P2（母表本身）→ Batch P3（采购单接入） |

### 已完成（Batch P2）

- [x] Prisma `MasterPart` model + migration `add_master_parts`
- [x] CRUD API：`/api/admin/master-parts`
- [x] WMS 管理页：`/wms/master-parts`（列表 / 搜索 / 筛选 / 新增 / 编辑 / 停用）
- [x] 创建时 `tenantId = "universe42"`（`withTenant`）
- [x] 权限：`wms:read` / `wms:write`
- [x] 纯函数测试 + 权限矩阵条目

### 已完成（Batch P3 — 采购保存层）

- [x] `PurchaseOrderLine` 增加 `itemType`（默认 `FLOWER`）、`masterPartId`
- [x] `flowerWikiId` 改为 nullable；花材必填、非花材为空
- [x] 非花材采购保存正式关联 MasterPart（`MasterPart.type` 须与 `itemType` 一致）
- [x] 移除按 `FlowerWiki.chineseName` 匹配非花材的临时方案
- [x] 采购单新增 / 编辑 / 查看支持混合明细；历史明细兼容为 `FLOWER`

### 未完成（留待后续批次）

- [ ] 非花材采购 **到货入库** / 库存 / FIFO 链路接入 MasterPart（当前 receive 对非花材行拒绝入库）

### 说明

- **FlowerWiki** 继续仅表示花材母表，仅用于 `itemType = FLOWER` 的采购明细。
- **MasterPart** 表示辅料、包装材料、工具、其他耗材，用于非花材采购明细。
- Batch P3 **不修改** Material / Batch / StockLog schema 与 FIFO 主流程。

---

## 相关条目（参考）

| ID | 说明 | 状态 |
|---|---|---|
| Batch P1 | 采购明细表单清理（品类、可用率 100%、隐藏供应商品名等） | Done |
| Batch P3 | 非花材采购正式接入 MasterPart（保存层） | Done |
| Batch P4（待定） | 非花材采购入库 / 库存链路 | Planned |
