# LOP 清单（Limitation / Open Point）

> 记录已知限制、待办批次与当前状态。  
> 应用根目录：`flower-wms-system/`

---

## LOP-020 — MasterPart 通用物料母表

| 字段 | 内容 |
|---|---|
| **标题** | 非花材通用物料母表（MasterPart） |
| **状态** | **Fixed**（母表 + 采购保存 + 采购入库） |
| **批次** | Batch P2 → P3 → P4 |

### 已完成

- [x] Prisma `MasterPart` model + CRUD + WMS 管理页
- [x] 采购明细双来源（P3）：FLOWER→FlowerWiki，非 FLOWER→MasterPart
- [x] 非花材采购入库（P4）：MasterPart→Material→Batch→StockLog
- [x] `Material.masterPartId` 关联，按 MasterPart 复用/创建 Material

### 说明

- 花材 Material 继续通过 `wikiId` 关联 FlowerWiki。
- 非花材 Material 通过 `masterPartId` 关联 MasterPart，**不**写入 FlowerWiki。

---

## LOP-022 — 非花材库存消耗 / BOM

| 字段 | 内容 |
|---|---|
| **标题** | 非花材库存 FIFO 消耗与 BOM 接入 |
| **状态** | **Open** |
| **批次** | 待定（Batch P4 之后） |

### 当前边界（Batch P4 后）

- [x] 非花材采购可到货入库，进入 Material / Batch / StockLog
- [x] 库存列表可看到非花材 Material（按 `Material.name` / 单位展示）
- [ ] 订单履约 FIFO **仍仅扣花材** Batch
- [ ] Recipe / BOM **仍仅引用 FlowerWiki**
- [ ] 非花材报损未单独设计（若 Material 已有批次，现有报损页或可按 Material 操作）

---

## 相关条目（参考）

| ID | 说明 | 状态 |
|---|---|---|
| Batch P1 | 采购明细表单清理 | Done |
| Batch P3 | 非花材采购正式接入 MasterPart（保存层） | Done |
| Batch P4 | 非花材采购入库 / 库存链路 | Done |
| LOP-022 | 非花材 FIFO / BOM 消耗 | Open |
