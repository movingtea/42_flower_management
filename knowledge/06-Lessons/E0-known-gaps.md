---
title: 已知限制、试用反馈与技术债
type: known-gaps
module: wms
status: draft
version: 1
owner: engineering
updated: 2026-11-09
sources:
  - "docs/flower-studio-2.0-local-run.md"
  - "docs/flower-studio-2.0-phase1-live-trial.md"
  - "flower-wms-system/prisma.v2.config.ts"
related: []
---

# 已知限制、试用反馈与技术债

- 启动文档记录 V2 确认后的 SKU 行增删需取消并重建，制作开始后涉及物料的变更需人工协调。确认最新边界后更新规则。
- 试用反馈保留采购关联入口、混合验收、拒收上限和替换花材库存提示的历史记录。逐项复测后关闭，旧状态以原记录为准。
- V2 Prisma 已使用正式 schema 和独立的 `V2_DATABASE_URL`。发布前需在目标环境准备 V2 数据库和连接，操作步骤见 [V2 运行与初始化](../../docs/flower-studio-2.0-local-run.md)。
- 本地启动文档记录过 Next 生成缓存导致的页面 404，dev 与 build 共享生成文件时应分开运行。

