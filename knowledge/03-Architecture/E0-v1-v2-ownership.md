---
title: V1/V2 功能归属与证据
type: architecture
module: platform
status: draft
version: 2
owner: engineering
updated: 2026-11-19
sources:
  - "docs/flower-studio-2.0-v1-v2-gap-matrix.md"
  - "docs/flower-studio-2.0-local-run.md"
  - "flower-wms-system/src/app"
related: []
---

# V1/V2 功能归属与证据

| 能力 | 工作入口与当前证据 | 验证边界 |
|---|---|---|
| V2 工作台与员工 | `/v2`、`/v2/staff` 存在。启动文档记录 V2 登录与业务使用 V2 数据库。 | 账号生命周期和完整角色矩阵待回归。 |
| WMS 主数据 | V2 有 materials、suppliers、catalog、recipes、packaging-kits；物料、商品/SKU 图片走 V2 上传、预览和失败占位。2026-11-19 物料母表已补齐 V1 FlowerWiki 知识字段（角色/多颜色/形态/别名/拼音/默认损耗模式），业务编号改为系统生成；同日按 V1 双入口模式拆为花材母表 `/v2/materials`（花材/叶材）与耗材母表 `/v2/consumables`（包装/耗材/其他），共用 `Material` 模型，并增加花材三级分类（种类/颜色/商品名，名称可留空自动生成）。 | 旧 V1 页面和字段逐项对照；V1 FlowerWiki 历史数据未回填，三级分类需补录。 |
| 采购、库存与履约 | V2 有 purchase-orders、inventory、operations、orders。 | 核心交易、异常及权限验收待 Sprint 0 记录。 |
| 既有后台与非 P1 能力 | 仓库仍有 V1 `/wms`、`/admin`、`/cms`、API。CRM、CMS、小程序和完整报表采用逐项迁移。 | 保留历史矩阵以追溯，切换和退役见 [[E0-adr-register]]。 |

历史矩阵为 2026-11-06 静态快照。此表补充当前可见入口。业务支持范围及通过状态以回归证据为准。

2026-11-19 补充：物料母表已按 V1 FlowerWiki 补齐并统一为右侧抽屉编辑，物料/供应商/包装方案编号由系统生成；同日将统一物料页拆为花材母表与耗材母表两个入口（共用 `Material` 模型），增加花材三级分类（种类→颜色→商品名）、花材名称留空自动生成与打样分类复用建议。工程约定见 [[E0-v2-engineering-conventions]]。

V1 下线以 V2 逐项覆盖 V1 全部功能并通过验收为门槛。按差距矩阵记录每项 V1 能力的 V2 入口或等效流程及验收结果，补齐快照遗漏。P1 WMS 通过只代表第一阶段达标。退役标准见 [[ADR-001-v1-v2-transition]]。

