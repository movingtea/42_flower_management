---
title: ADR-005 Codex、DSH 工作分工与独立验收
type: adr
module: engineering
status: approved
version: 3
owner: engineering
updated: 2026-11-09
approved_by: 项目用户
approved_on: 2026-11-09
approval_scope: "批准 Codex 与 DSH 的分工、限定范围交接及独立验收流程。实际工作包验收证据已归档。"
sources:
  - "AGENTS.md"
  - "knowledge/04-Engineering/E0-knowledge-governance.md"
related:
  - "[[E0-adr-register]]"
  - "[[ADR-003-inventory-invariants]]"
---

# ADR-005 Codex、DSH 工作分工与独立验收

## 提案

- Codex 定义需求、规格、设计、验收标准及可修改路径，提供已批准规则和待决边界。不同工作包明确文件所有权、依赖和集成顺序。
- DSH 在划定范围内实现，报告修改文件、验证命令、退出状态、剩余风险和知识修订建议。遇到规格冲突或需要修改约定范围时，提交证据供 Codex 判断。
- Codex 独立审阅差异、复跑关键检查，按验收标准接受或给出具体返工项。DSH 自测记录作为输入。用户保留业务规则、生产切换与发布的批准权。
- E0.5 可按 Prisma 和部署拆分工作。部署验收依赖正式 Prisma 命令。E1 可复用同一交接方式接入 CI。

## 验证

以一个受限工作包验证交接内容和独立验收证据。需要生产访问、扩展写入范围或更改已批准规则时，按对应权限单独处理。

### E0 实际交接记录

- 工作包 `e0-adr005-stocktake-risk`，基线 `1c71923` 及原工作区改动。DSH 会话 `session-b1e6d64c-237f-431a-ac0b-f53a54e46b62`。
- Codex 依据 `WMS-BR-INV-003` 和 [[ADR-003-inventory-invariants]] 定义验收。实存从 10 降到 8 时保留 10 支原预留、生成一条 −2 调整流水，并把受影响订单从库存覆盖改为部分覆盖。批次各库位实存合计足够时保留原状态。
- DSH 可修改 `flower-wms-system/src/v2/services/stocktake.ts` 和 `flower-wms-system/src/v2/services/stocktake.test.ts`。保留原有多行回滚用例，沿用盘点确认事务、门店权限及幂等约束。

| 阶段 | 结果与证据 |
|---|---|
| DSH 实现 | 在盘点事务中按批次汇总各库位实存与当前版本的有效订单预留，更新受影响订单并把缺口与订单 ID 写入确认审计。增加受影响、库存充足、门店和租户隔离、历史预留等回归用例。 |
| Codex 审查与返工 | 初次执行停在工具调用，终止后沿原会话继续。第一轮返工消除盘点与制作之间的锁等待环，并排除旧版本预留。第二轮返工在获得订单锁后重新读取预留，覆盖并发取消先行释放预留的情况。 |
| DSH 自测 | 两轮返工均报告目标文件 ESLint、TypeScript 和差异空白检查通过。PostgreSQL 验证由 Codex 独立执行。 |
| Codex 独立验收 | 审阅两份允许修改的文件，确认保留原有多行回滚用例。在隔离 PostgreSQL 18 中迁移并载入测试数据，10 个集成测试文件及 4 条 V2 冒烟通过。确认实存 10→8、预留仍为 10、一条 −2 调整流水、受影响订单改为部分覆盖。库存充足、旧版本预留、锁冲突回滚和重试、并发取消后的重新判断均通过。 |

代码证据见 [盘点确认服务](../../flower-wms-system/src/v2/services/stocktake.ts) 和 [盘点集成测试](../../flower-wms-system/src/v2/services/stocktake.test.ts)。工程验收与正式 ADR 审批均已完成。

