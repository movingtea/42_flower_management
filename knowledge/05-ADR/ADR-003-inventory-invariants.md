---
title: ADR-003 库存事务、预留与流水约束
type: adr
module: inventory
status: under-review
version: 1
owner: engineering
updated: 2026-11-09
sources:
  - "flower-wms-system/src/v2/services/inventory-operations.ts"
  - "flower-wms-system/src/v2/services/complete-production.ts"
  - "flower-wms-system/src/v2/services/allocate-purchase-demand.ts"
related:
  - "[[E0-adr-register]]"
---

# ADR-003 库存事务、预留与流水约束

## 当前证据

库存操作和制作结转服务使用事务、行锁与幂等键。采购分配对订单、需求和采购行加锁。现有用法为核对入口，完整覆盖需由集成测试验证。

## 提案

- 以 [[E0-confirmed-stock-and-supply]] 为正式业务输入。预留与物理变动分别记账。余额、相关预留、流水及关联业务状态在同一事务内提交，失败整体回滚。库存实存禁止为负。盘点低于预留时保留实盘和原预留，标记受影响订单。
- 在事务中以固定顺序锁定竞争记录，重新校验门店、状态和可用数量。同一幂等键与相同输入返回已有结果，输入不同则报冲突。历史错误通过可追溯的调整记录处理。
- 任何会修改库存的入口须有成功、并发、重复提交、事务失败和跨店拒绝的验收证据。核对余额和对应流水，而不是只检查页面提示。

## 待决

[[E0-business-rule-review]] 中的 WMS-RV-003、004、005、007 分别影响采购超收、批次优先级、部分替换和复核权限。对应测试先保留场景，预期行为待业务确认。

