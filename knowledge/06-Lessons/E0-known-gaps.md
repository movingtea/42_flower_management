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
- 2026-11-19 物料母表已按 V1 FlowerWiki 补齐：迁移 `0014_material_library_parity` 增加拼音简拼、别名、花材角色、多颜色标签、形态、默认可用率/损耗率、损耗模式、成本更新时间；AI 补全扩展为颜色/形态/供货季/角色/别名建议；新增无引用硬删除与行内改标准成本。实现约定见 [[E0-v2-engineering-conventions]]。
- 2026-11-19 起物料/供应商/包装方案等业务编号由系统生成，界面不再手填；列表拆分“编号/名称”。测试数据仍可通过服务层显式传编号。约定见 [[E0-v2-engineering-conventions]]。
- 仍待处理（打样相关，不阻塞）：完成/取消后留在制作区的可复用物料不会自动进入普通库存或下一个计划；样品成本未写 `CostEntry`；样品图片上传未开放。
- 仍待处理（物料与选择器）：V2 表单内的物料/配方/分类仍是原生 `<select>`，没有统一的可搜索选择器（差距矩阵 F06，属 Sprint 5 CMS 迁移范围）；V1 `FlowerWiki` 历史数据未回填到 V2，旧库记录仍只存在于 V1。
- 2026-11-19 浏览器 E2E 已在当前环境真实跑通（此前沙箱限制 `spawn EPERM` 已解除）：全量 23 通过 / 2 失败 / 1 跳过，失败仅 `smoke.spec.ts` 的标题层级断言（Sprint 2 把“经营概览”从 h1 改为 `V2ModulePage` 的 h2，测试未同步），已修正断言；main-chain 6/6 覆盖抽屉新增/编辑、自动编号与完整订单链路。

