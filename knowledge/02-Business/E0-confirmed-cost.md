---
title: 已确认规则 · 成本快照
type: business-rule
module: cost
status: approved
version: 1
owner: product
updated: 2026-11-09
sources:
  - "docs/flower-studio-2.0-domain-design.md §12 条 6、15"
related: []
---

# 已确认规则 · 成本快照

| ID | 已确认规则 |
|---|---|
| WMS-BR-CST-001 | 批次成本可暂估并显式标记。最终价格、折价和运费确认后形成最终成本。已结账订单以成本调整留痕并保留原快照。 |
| WMS-BR-CST-002 | 交付完成后自动生成结账成本快照。未最终确认的采购或配送费用标为暂估，确认后以成本调整记录差额，保留原快照。 |

