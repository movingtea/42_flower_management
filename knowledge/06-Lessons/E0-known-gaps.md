---
title: 已知限制、试用反馈与技术债
type: known-gaps
module: wms
status: draft
version: 2
owner: engineering
updated: 2026-11-19
sources:
  - "docs/flower-studio-2.0-local-run.md"
  - "docs/flower-studio-2.0-phase1-live-trial.md"
  - "flower-wms-system/prisma.v2.config.ts"
related: []
---

# 已知限制、试用反馈与技术债

- Sprint 4 收口已关闭原打样三项限制：暂停/恢复（`SamplePlanState.PAUSED`，暂停释放未领用预留、恢复重新检查现货）、未开始直接完成（同事务补齐预留、领用与制作区流转）、顾客订单优先后的风险计划原地重算（释放旧预留、关闭未开始执行、重新计算并再次批准）。实现与验收见 [Sprint 4 证据](../../docs/stage-artifacts/sprints/sprint-4-evidence.md)。
- 仍待处理：完成/取消后留在制作区的可复用物料不会自动进入普通库存或下一个计划；样品成本未写 `CostEntry`；样品图片上传未开放。以上均需后续确认，不阻塞当前打样流程。
- 启动文档记录 V2 确认后的 SKU 行增删需取消并重建，制作开始后涉及物料的变更需人工协调。确认最新边界后更新规则。
- 试用反馈保留采购关联入口、混合验收、拒收上限和替换花材库存提示的历史记录。逐项复测后关闭，旧状态以原记录为准。
- V2 Prisma 已使用正式 schema 和独立的 `V2_DATABASE_URL`。发布前需在目标环境准备 V2 数据库和连接，操作步骤见 [V2 运行与初始化](../../docs/flower-studio-2.0-local-run.md)。
- 本地启动文档记录过 Next 生成缓存导致的页面 404，dev 与 build 共享生成文件时应分开运行。

