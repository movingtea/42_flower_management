---
title: ADR-003 库存事务、预留与流水约束
type: adr
module: inventory
status: approved
version: 9
owner: engineering
updated: 2026-11-09
approved_by: 项目用户
approved_on: 2026-11-09
approval_scope: "批准库存事务、预留与流水约束，以及关联补单与补送、整条缺料换料和库存复核的 E0 验收结论。"
sources:
  - "flower-wms-system/src/v2/services/inventory-operations.ts"
  - "flower-wms-system/src/v2/services/complete-production.ts"
  - "flower-wms-system/src/v2/services/allocate-purchase-demand.ts"
related:
  - "[[E0-adr-register]]"
  - "[[ADR-005-codex-dsh-responsibilities]]"
---

# ADR-003 库存事务、预留与流水约束

## 当前证据

库存操作和制作结转服务使用事务、行锁与幂等键。采购分配对订单、需求和采购行加锁。现有用法为核对入口，完整覆盖需由集成测试验证。

## 提案

- 以 [[E0-confirmed-stock-and-supply]] 为正式业务输入。预留与物理变动分别记账。余额、相关预留、流水及关联业务状态在同一事务内提交，失败整体回滚。库存实存禁止为负。盘点低于预留时保留实盘和原预留，标记受影响订单。
- 在事务中以固定顺序锁定竞争记录，重新校验门店、状态和可用数量。同一幂等键与相同输入返回已有结果，输入不同则报冲突。历史错误通过可追溯的调整记录处理。
- 任何会修改库存的入口须有成功、并发、重复提交、事务失败和跨店拒绝的验收证据。核对余额和对应流水，而不是只检查页面提示。

## 已确认的业务口径

用户于 2026-11-09 确认采购上限与补送、批次排序、整条缺料替换、盘点与损耗复核。正式规则见 [[E0-confirmed-inventory-decisions]]。验收时检查缺 10 支、替代料仅有 6 支或提交 6 支的请求均被拒绝，原需求与预留保留。替代料可用量达到 10 支时，仍需满足其余换料条件。

## 工程验收记录

2026-11-09，从基线提交 `1c71923` 的工作区在隔离 PostgreSQL 18 中迁移空库并初始化测试数据。10 个集成测试文件和 4 条冒烟均通过。下表记录已验证的具体行为。不同入口的证据分别归档。

| 约束 | 已验证行为 | 测试证据 |
|---|---|---|
| 实存、预留与流水 | 入库 10 支、制作耗用 5 支后实存为 5。核对入库、移库和消耗流水。盘点差额生成调整流水，零差异不产生流水。拒收和损耗各按自身边界处理。 | [核心流程](../../flower-wms-system/scripts/v2/smoke-core-flow.ts)、[盘点](../../flower-wms-system/src/v2/services/stocktake.test.ts)、[拒收](../../flower-wms-system/src/v2/services/reject-purchase-line.test.ts)、[损耗](../../flower-wms-system/src/v2/services/loss-management.test.ts) |
| 并发写入 | 两单同时请求 14 支库存时，对 10 支实存的有效预留合计为 10，缺口合计为 4。库存操作、采购分配、验收及拒收各有并发场景。 | [并发预留](../../flower-wms-system/scripts/v2/smoke-reservation.ts)、[库存操作](../../flower-wms-system/src/v2/services/inventory-operations.test.ts)、[采购分配](../../flower-wms-system/src/v2/services/allocate-purchase-demand.test.ts)、[验收](../../flower-wms-system/src/v2/services/receive-purchase-line.test.ts)、[拒收](../../flower-wms-system/src/v2/services/reject-purchase-line.test.ts) |
| 重试与冲突 | 验收和拒收以相同键重试时保留原记录，同键不同数量会报冲突。重复取消订单不再次释放库存，重复确认盘点不新增调整流水。 | [验收](../../flower-wms-system/src/v2/services/receive-purchase-line.test.ts)、[拒收](../../flower-wms-system/src/v2/services/reject-purchase-line.test.ts)、[订单生命周期](../../flower-wms-system/src/v2/services/order-lifecycle.test.ts)、[盘点](../../flower-wms-system/src/v2/services/stocktake.test.ts) |
| 事务失败 | 换料事务在生成版本和处理旧预留后失败，原版本和原预留仍在，新预留及审计未落库。改单、制作异常和盘点回滚各有独立断言。 | [换料](../../flower-wms-system/src/v2/services/substitute-order-material.test.ts)、[改单](../../flower-wms-system/src/v2/services/revise-order.test.ts)、[制作](../../flower-wms-system/src/v2/services/complete-production-actual.test.ts)、[盘点](../../flower-wms-system/src/v2/services/stocktake.test.ts) |
| 租户与门店隔离 | 跨店或跨租户的换料、取消及盘点确认被拒绝。盘点测试还验证拒绝后仍保留草稿状态。 | [换料](../../flower-wms-system/src/v2/services/substitute-order-material.test.ts)、[订单生命周期](../../flower-wms-system/src/v2/services/order-lifecycle.test.ts)、[盘点](../../flower-wms-system/src/v2/services/stocktake.test.ts) |

盘点新增了多行回滚用例，并在另一个空库单独复跑通过。末行流水键冲突时，前面已写的调整流水和两行余额修改均回滚，盘点保留草稿状态，确认审计未写入。

### 同批次并发与写入后回滚

在新建的隔离 PostgreSQL 18 中应用 7 项 V2 迁移并载入测试数据，6 个服务集成测试文件和 1 个批次分配测试文件通过。回滚用例执行真实服务和真实审计写入，随后在同一事务内主动抛错，再从事务外读取数据库核对。TypeScript 检查通过。

| 场景 | 验收结果 | 证据 |
|---|---|---|
| 同批次并发扣减 | 实存 10，损耗与库存减少调整同时各扣 7，恰好一项成功，实存剩 3，只产生一条与获胜操作对应的 7 支流水。 | [损耗集成测试](../../flower-wms-system/src/v2/services/loss-management.test.ts) |
| 采购验收写入后回滚 | 收货单、验收明细、批次、余额、流水、采购状态与验收审计均恢复至操作前。同一幂等键重试成功，只保留一条明细。 | [采购验收集成测试](../../flower-wms-system/src/v2/services/receive-purchase-line.test.ts) |
| 采购拒收写入后回滚 | 收货单、拒收明细、采购状态与采购行审计均恢复至操作前。同一幂等键重试成功，只保留一条明细。 | [采购拒收集成测试](../../flower-wms-system/src/v2/services/reject-purchase-line.test.ts) |
| 损耗写入后回滚 | 实存恢复为 10，损耗单、扣减流水和审计均未留下。同一幂等键重试成功，实存变为 6。 | [损耗集成测试](../../flower-wms-system/src/v2/services/loss-management.test.ts) |

## 盘亏供应风险复验

基线曾复现实存从 10 降为 8、有效预留仍为 10 时，订单仍显示库存覆盖。经 [[ADR-005-codex-dsh-responsibilities#E0 实际交接记录|受限工作包]] 修复后，Codex 在隔离 PostgreSQL 18 中复验通过。确认盘点保留 10 支预留、生成一条 −2 调整流水，并把受影响订单标记为部分覆盖。库存仍足够时保留订单状态。已验证多库位合计、旧版本预留排除、订单锁冲突时整体回滚并可重试，以及并发取消释放预留后按新数据重新判断。相关 [盘点集成测试](../../flower-wms-system/src/v2/services/stocktake.test.ts) 和其余 9 个集成测试文件、4 条 V2 冒烟均通过。

## 已批准业务规则的验收状态

| 规则 | 已验证与待完成事项 |
|---|---|
| WMS-BR-PUR-001 采购上限与补送 | 服务与数据库验收通过。原明细订 5 支，拒收 2 支、合格 3 支后拒绝再收。关联补送 2 支、额外到货 3 支分别在原采购单下的关联明细入库，各自重试只产生一条入库流水。原明细累计仍为 5，拒收原因保留。见 [采购集成测试](../../flower-wms-system/src/v2/services/purchase-order-management.test.ts)。 |
| WMS-BR-INV-005 批次分配 | 分配测试覆盖规格不匹配、制作前到期和全冻结库存排除，已知效期优先、同效期按入库时间排序、未知效期最后按入库时间排序。见 [批次分配测试](../../flower-wms-system/src/v2/domain/stock-planning.test.ts)。 |
| WMS-BR-ORD-001 整条缺料换料 | 缺 10 支提交 6 或 11 支、替代库存不足、顾客确认等用例通过。原需求 15 支、已预留原料 5 支时替换缺口 10 支，新版本的需求与有效预留均为 15 支，其中原料 5 支、替代料 10 支。旧版本预留已释放。见 [换料集成测试](../../flower-wms-system/src/v2/services/substitute-order-material.test.ts)。 |
| WMS-BR-INV-006 库存复核 | 阈值比较使用差异绝对值。阈值为 2、普通员工将实存 5 盘为 8 时进入待复核，复核前实存仍为 5 且无调整流水。本店授权人员批准后实存变为 8，只生成一条 +3 调整流水。等于阈值仍可直接处理，盘亏复核、跨店权限及批次不明损耗回归通过。见 [盘点集成测试](../../flower-wms-system/src/v2/services/stocktake.test.ts)。 |

前轮在隔离 PostgreSQL 18 验证 8 项迁移、schema 一致性、测试数据初始化、31 个既有 V2 测试文件和 4 条冒烟，补充的采购入库用例通过。随后两个边界缺陷分别通过 Codex 独立数据库复验，订单修订与损耗回归也通过。CMS 产品路由的 `parseProductBody` 导出问题已修复，TypeScript 和相关文件 ESLint 检查通过。后续复验证据见 [V2 重构对话](thread://01a17724-aedf-7631-87c3-8e2322ac3029?hostId=local)。

### 浏览器实操验收

2026-11-09 在本机隔离的 V2 应用副本和 PostgreSQL 18 中完成。以测试账号通过页面提交，随后从数据库核对结果。

| 规则 | 浏览器实操与数据核对 |
|---|---|
| WMS-BR-PUR-001 | 在 `E0-UI-PO` 的原明细记录拒收 2 支及原因，创建关联补送 2 支、额外到货 3 支，再分别验收入库，并验收原明细剩余 3 支。采购单页面显示已处理，两个关联明细均显示原明细。数据库确认两个明细都指向 `ui-original`，各有一条入库流水。原明细累计处理 5 支，拒收 2 支及原因保留。 |
| WMS-BR-INV-006 | 阈值 2，普通采购员工把 `E0-UI-STOCK` 从实存 5 盘为 8，页面显示待复核且无审批操作。数据库确认实存仍为 5、调整流水为 0。外店经理的仓储页面看不到主店待复核单。本店经理批准后页面显示实存 8，数据库仅有一条 +3 调整流水，并记录提交人与复核人。 |
| WMS-BR-INV-006 批次不明损耗 | 普通采购员工从页面提交 1 支，进入待复核。经理选定实际批次并确认后，页面显示 1 支损耗流水，数据库确认只扣减一次，批次实存从 8 变为 7，并保留提交人与复核人。 |

三项服务与数据库验收已通过，采购关联与库存复核浏览器实操已通过。项目用户已正式批准本 ADR。
