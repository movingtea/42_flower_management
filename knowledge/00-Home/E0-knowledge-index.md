---
title: E0 项目知识索引
type: index
module: project
status: draft
version: 2
owner: engineering
updated: 2026-11-09
sources:
  - "docs/flower-studio-2.0-domain-design.md"
related: []
---

# E0 项目知识索引

- 产品范围与术语 → [[E0-product-scope]]
- 业务规则 → [[E0-confirmed-stock-and-supply]]、[[E0-confirmed-inventory-decisions]]、[[E0-confirmed-operating-rules]]、[[E0-confirmed-sample-and-sku]]、[[E0-confirmed-cost]]
- V1/V2 当前归属 → [[E0-v1-v2-ownership]]
- 知识治理 → [[E0-knowledge-governance]]
- V2 工程约定（编号/抽屉/数据重置）→ [[E0-v2-engineering-conventions]]
- 已批准 ADR → [[E0-adr-register]]
- 试用反馈与技术债 → [[E0-known-gaps]]
- 规格入口 → [[E0-specifications-index]]

首批七组业务确认记录见 [[E0-business-rule-review]]。规则的适用范围、确认状态和实现验收分别记录。

## Sprint E0 关闭记录

- 关闭日期为 2026-11-09，项目用户确认关闭。交付基线为 Git 提交 `99daac6`（Sprint E0 done）。
- ADR-001 至 ADR-005 均已正式批准。库存事务、采购关联、换料与库存复核的验收证据见 [[ADR-003-inventory-invariants]]，Codex 和 DSH 的交接与独立验收证据见 [[ADR-005-codex-dsh-responsibilities]]。
- V2 已验证正式 Prisma Client、空库迁移与测试 Seed、本机与容器启动、生产初始密码保护和迁移状态检查。
- E1 承接 P1 测试追踪、隔离数据库、浏览器自动化和 PR 质量门禁。V1 退役仍按 [[ADR-001-v1-v2-transition]] 的条件执行。

