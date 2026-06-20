# LOP 清单（Limitation / Open Point）

> 记录已知限制、待办批次与当前状态。  
> 应用根目录：`flower-wms-system/`

---

## LOP-020 — MasterPart 通用物料母表

| 字段 | 内容 |
|---|---|
| **标题** | 非花材通用物料母表（MasterPart） |
| **状态** | **Partially Fixed** |
| **批次** | Batch P2（母表本身）→ Batch P3（采购单接入） |

### 已完成（Batch P2）

- [x] Prisma `MasterPart` model + migration `add_master_parts`
- [x] CRUD API：`/api/admin/master-parts`
- [x] WMS 管理页：`/wms/master-parts`（列表 / 搜索 / 筛选 / 新增 / 编辑 / 停用）
- [x] 创建时 `tenantId = "universe42"`（`withTenant`）
- [x] 权限：`wms:read` / `wms:write`
- [x] 纯函数测试 + 权限矩阵条目

### 未完成（留待 Batch P3）

- [ ] `PurchaseOrderLine` 增加 `masterPartId`（或等价关联）
- [ ] 非花材采购保存正式关联 MasterPart
- [ ] 移除按 `FlowerWiki.chineseName` 匹配非花材的临时方案
- [ ] 库存 / 入库链路接入 MasterPart（若需要）

### 说明

- **FlowerWiki** 继续仅表示花材母表。
- **MasterPart** 表示辅料、包装材料、工具、其他耗材。
- Batch P2 只建立母表，**不修改采购单保存逻辑**。

---

## 相关条目（参考）

| ID | 说明 | 状态 |
|---|---|---|
| Batch P1 | 采购明细表单清理（品类、可用率 100%、隐藏供应商品名等） | Done |
| Batch P3 | 非花材采购正式接入 MasterPart | Planned |
