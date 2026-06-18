# Batch B.1：退款取消停止自动物理回库

> 2026-06-17 — 响应 Code Review Critical：退款不应默认回补物理批次。

## 问题

`refundPaidOrder` 曾无条件调用 `restorePhysicalStockFromSaleOutInTx`，导致：

- 即使 `rollbackStock=false`，仍写入 `IN_CANCEL` 并增加 `Batch.remainingQty`
- 已制作/已损耗订单退款后物理库存虚增

## 修复

| 项 | 修复后 |
|---|---|
| `refundPaidOrder` | 不再调用 `restorePhysicalStockFromSaleOutInTx` |
| `rollbackStock` | 仅回补 `ProductSku.stock`（虚拟可售库存） |
| 物理批次 | 退款默认不动；显式回库留 Batch B.2 |
| `restorePhysicalStockFromSaleOutInTx` | 保留，标注为显式回库 helper |

## 测试

```bash
npm run test:refund-stock-policy
npm run test:order-invariants
```

## Batch B.2 预留

显式物理花材回库：读取订单 `SALE_OUT` → 运营选择 batch / 数量 → 写 `IN_CANCEL`（或新类型）→ 审计留痕 → 防重复。
