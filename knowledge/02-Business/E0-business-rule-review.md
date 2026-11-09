---
title: E0 业务规则确认记录
type: business-rule
module: wms
status: superseded
version: 3
owner: product
updated: 2026-11-09
sources:
  - "docs/flower-studio-2.0-domain-design.md §§3–10"
  - "docs/flower-studio-2.0-phase1-live-trial.md V2-TRIAL-005 至 007"
  - "docs/flower-studio-2.0-local-run.md"
related:
  - "[[E0-confirmed-inventory-decisions]]"
  - "[[E0-confirmed-operating-rules]]"
---

# E0 业务规则确认记录

用户已确认首批七组业务口径。此页保留原编号和确认结果，正式规则以对应的已批准文档为准。

| ID | 确认范围 | 正式规则 |
|---|---|---|
| WMS-RV-001 | 物料身份与基础库存单位 | [[E0-confirmed-operating-rules]] 中的 WMS-BR-MAT-001。 |
| WMS-RV-002 | 默认 SKU、配方勘误和版本生效 | [[E0-confirmed-operating-rules]] 中的 WMS-BR-CAT-001。 |
| WMS-RV-003 | 采购验收上限和补送路径 | 已确认。见 [[E0-confirmed-inventory-decisions]] 中的 WMS-BR-PUR-001。 |
| WMS-RV-004 | 批次选择和库存复核 | 已确认。见 [[E0-confirmed-inventory-decisions]] 中的 WMS-BR-INV-005、006。 |
| WMS-RV-005 | 换料及订单变更边界 | [[E0-confirmed-inventory-decisions]] 中的 WMS-BR-ORD-001、[[E0-confirmed-operating-rules]] 中的 WMS-BR-ORD-002。 |
| WMS-RV-006 | 配送失败、重排权限与售后分流 | [[E0-confirmed-operating-rules]] 中的 WMS-BR-FUL-001。 |
| WMS-RV-007 | 库存复核、角色权限、跨店访问与停用 | [[E0-confirmed-inventory-decisions]] 中的 WMS-BR-INV-006、[[E0-confirmed-operating-rules]] 中的 WMS-BR-AUTH-001。 |

