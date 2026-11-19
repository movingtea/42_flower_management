---
title: 数据模型来源
type: source-index
module: database
status: draft
version: 1
owner: engineering
updated: 2026-11-09
sources:
  - "docs/flower-studio-2.0-schema-draft.md"
  - "docs/flower-studio-2.0-constraint-review.md"
  - "flower-wms-system/prisma/v2/migrations"
related: []
---

# 数据模型来源

数据模型设计应同时核对 Prisma 配置和实际 PostgreSQL 迁移。

## 迁移现状（2026-11-19）

V2 迁移目录 `flower-wms-system/prisma/v2/migrations` 已到 `0014_material_library_parity`：在 `Material` 上补齐 V1 FlowerWiki 的拼音索引、别名、花材角色、多颜色标签、形态、默认可用率/损耗率、损耗模式与成本更新时间，并新增 `FloralRole`、`LossMode` 两个枚举。手写迁移沿用 `0001` 起的手工 SQL + 手工索引约定，不使用 `prisma migrate dev`。业务约定见 [[E0-v2-engineering-conventions]]。

