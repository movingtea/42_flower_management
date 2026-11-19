---
title: 已确认规则 · 供应与库存
type: business-rule
module: inventory
status: approved
version: 1
owner: product
updated: 2026-11-09
sources:
  - "docs/flower-studio-2.0-domain-design.md §12 条 1–3、5"
related: []
---

# 已确认规则 · 供应与库存

| ID | 已确认规则 |
|---|---|
| WMS-BR-INV-001 | 依赖在途供应的预约订单须分配已确认的在途数量。相同数量不可重复承诺，采购建议不算供应保障。 |
| WMS-BR-INV-002 | 待支付锁定按配方展开后的关键物料需求计算，并设截止时间。支付成功时在同一事务释放临时锁定并创建正式预留。 |
| WMS-BR-INV-003 | 实盘数量少于已预留量时保留盘点事实，标记受影响订单，由员工重新分配或补购。调整记录原因和复核信息，保留既有预留。 |
| WMS-BR-INV-004 | 制作区整卷耗材区分未开封和在用。用尽时确认整卷消耗并定期盘点，不按订单计量或分摊用量。 |

批准依据为来源中标记「已确认」的条目。预约与待支付规则适用相应渠道，当前阶段交付范围见 [[E0-product-scope]]。

