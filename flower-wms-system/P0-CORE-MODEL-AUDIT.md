# Flower Studio 2.0 P0 核心模型审计（采购 → 订单）

状态：2026-11-06 完成。范围仅为 V2 核心 WMS 的“订单缺料 → 已有采购关联 → 分次验收/降级/拒收 → 订单补货进度”；不包含 P1 正式页面迁移、供应商管理、报表、CMS/CRM/小程序。

## 1. 结论

本轮记录 **11 个 P0、10 个 P1、5 个 P2**。

- 11 个 P0 已修复，覆盖累计数量、并发锁、状态重算、租户/门店归属、审计、关联订单反馈、现有采购选择、部分降级续收、替换物料库存。
- V2-TRIAL-004/005/006/007 四个确认缺陷均已覆盖。
- P0 未通过修改 Schema 实现；采用事务锁、全 disposition 聚合、确定性幂等 ID 和审计事件，避免在存在历史脏数据时强行加数据库约束。
- P1/P2 仅记录，不在本任务实现。

严重度口径：
- P0：直接造成数量失真、跨租户/门店越权、阻断试用主流程或隐藏缺料风险。
- P1：正式页面、查询完整性、Schema 防御约束、短装处理等上线前事项。
- P2：可读性、审计查询体验或技术债。

## 2. P0 发现与处置

| ID | 发现（修复前） | 证据 | 风险 | 处置 | 状态 |
|---|---|---|---|---|---|
| P0-01 | 拒收不锁采购单/明细、不聚合历史拒收、不校验累计，拒收可超过采购数量。 | 旧 `src/v2/services/reject-purchase-line.ts` 仅创建 receipt/line，无 aggregate、锁、状态更新。 | 采购进度与关联订单风险失真。 | 新增 `src/v2/domain/purchase-progress.ts`；拒收读取全部 disposition，事务内锁 PurchaseOrder 后按 id 排序锁全部 PurchaseOrderLine；超限中文报错且不落库。 | 已修复 |
| P0-02 | 验收只把 ACCEPTED/DOWNGRADED 计入累计，拒收可绕过验收上限。 | 旧 `src/v2/services/receive-purchase-line.ts` 的 aggregate 只含两种 disposition；旧采购页只汇总这两类。 | 合格+降级+拒收可超过基础数量。 | 验收/拒收统一三种 disposition 累计；页面显示采购/合格(原等级)/降级/拒收/剩余。 | 已修复 |
| P0-03 | 验收只锁目标明细，同单不同明细并发验收时采购单状态可被旧快照覆盖。 | 旧 `src/v2/services/receive-purchase-line.ts` 仅锁 `PurchaseOrderLine id = target`。 | 状态与明细进度不一致。 | 锁顺序统一 `PurchaseOrder` → 该单全部 `PurchaseOrderLine`（id asc）；状态从全单所有行/所有 receipt 重算。 | 已修复 |
| P0-04 | 验收 action 每次随机生成幂等键，双击/重试可重复入库；拒收无幂等键。 | 旧 `src/app/v2/actions.ts` 使用 `crypto.randomUUID()`；旧拒收服务无 idempotency。 | 重复批次/库存/拒收。 | 表单隐藏 `idempotencyKey`；服务按操作+key 生成确定性 GoodsReceipt.id；同 key 重试返回既有 batch/receipt，不重复写库存或审计。 | 已修复 |
| P0-05 | 验收、拒收、采购关联均无审计事件。 | 旧三个服务均无 `auditEvent.create`；AuditEvent 模型已存在。 | 数量、操作人、状态变化不可追溯。 | 新增 `PURCHASE_LINE_RECEIVED`、`PURCHASE_LINE_REJECTED`、`PURCHASE_DEMAND_ALLOCATED`，带 tenant/store/actor 和前后快照；幂等重试不重复审计。 | 已修复 |
| P0-06 | 拒收只写采购侧，关联订单看不到拒收数量、原因和剩余动作状态。 | 旧拒收服务写 receipt 后返回；旧订单页不查 receipt。 | 员工误以为关联订单已补货。 | 拒收事务内按 allocation 找关联订单，逐单写 `ORDER_PURCHASE_REJECTED`；订单页嵌入采购行 receiptLines；采购页显示关联订单缺料状态。 | 已修复 |
| P0-07 | 分配/订单页只按 ACCEPTED/DOWNGRADED 计算 outstanding，拒收后仍显示可分配。 | 旧 `src/v2/services/allocate-purchase-demand.ts` 过滤两 disposition；旧订单页不减已验收数量。 | 对无可用数量的采购行重复承诺。 | 分配服务读取全部 disposition，返回 acceptedOriginal/downgraded/rejected/processed/remaining；订单页可分配 = expected - processed - allocated，开放采购不截断。 | 已修复 |
| P0-08 | 点击“关联已有采购单”后，缺料需求区可能无表单、无原因说明。 | 旧 `src/app/v2/orders/page.tsx` 仅在 unlinkedLines>0 时渲染 form，否则仅一句“暂无其他可分配行”。 | 无法完成缺料→已有采购关联。 | 每个缺料需求始终渲染关联区：可关联/全部已关联/到货晚/无剩余/无同物料；选项含 PO、物料、可分配量、预计到货；服务端复核租户/门店/物料/最新修订/采购状态/到货时间。 | 已修复 |
| P0-09 | 部分降级后页面只有“已到货”合计，无法看清原等级剩余、降级、拒收。 | 旧 `src/app/v2/purchases/page.tsx` 只累计 ACCEPTED+DOWNGRADED。 | 分次验收不明确，容易错收/超收。 | 每行显示采购、合格(原等级)、降级、拒收、剩余；下拉显示 ordered/processed/remaining；ACCEPTED 强制采购行物料，DOWNGRADED 才用选择物料。 | 已修复 |
| P0-10 | 人工替换选项没有当前门店可用库存，服务端也不复核。 | 旧订单页替换 select 只显示身份；旧替换服务释放旧预留后直接修订。 | 无法判断能否覆盖；并发下可能按旧库存承诺。 | 新增 `src/v2/services/material-availability.ts`：on hand - frozen - active order/sample reservations，按 batch 下限 0 聚合并按 needBy 过滤；页面显示可用量/单位/缺口并优先足量物料；服务端在批次锁后复核，库存低于替换数量时**无条件**拒绝，人工/顾客确认不能覆盖库存缺口，事务整体回滚。 | 已修复 |
| P0-11 | 采购分配关系新增/增加没有审计。 | 旧 `src/v2/services/allocate-purchase-demand.ts` 只 create/update allocation。 | 采购归因不可追溯。 | 分配服务新增必填 `actorStaffId`；仅在 changed 时写 `PURCHASE_DEMAND_ALLOCATED`，记录前后数量、订单/需求/采购行/PO/物料/剩余缺口；精确重试不重复审计。 | 已修复 |

### 修复后的关键不变量

1. `ACCEPTED + DOWNGRADED + REJECTED <= expectedBaseQty`，由同一采购单锁内校验。
2. 采购状态由全单所有行、全部 disposition 重算；全拒收为 RECEIVED，但页面明确显示拒收和订单仍缺料。
3. 验收/拒收幂等键重试返回既有结果，不重复库存、receipt line 或审计。
4. 所有变更校验 tenant/store；验收新增 tenantId/actorStaffId，拒收新增 tenantId/storeId/actorStaffId。
5. 锁顺序：验收/拒收 `PurchaseOrder -> 全部 PurchaseOrderLine (id asc)`；分配 `Order -> Requirement -> PurchaseOrder -> PurchaseLine`，兼容 order-first。
6. 采购分配只做归因，不写库存预留、不改变订单供应状态。
7. 替换必须人工填写原因；顾客可感知 grade/color/specification 变化还需顾客确认；但**任何确认都不能覆盖替换库存不足**。库存不足时事务整体回滚，不产生新修订、预留或审计。

## 3. P1 发现（记录，不实现）

| ID | 发现 | 证据 | 风险/影响 | 建议与处置 |
|---|---|---|---|---|
| P1-01 | 历史采购单 `take:50`、订单页 `take:30`，正式查询可能截断历史。 | `src/app/v2/purchases/page.tsx` closedPurchases；`src/app/v2/orders/page.tsx` orders。 | 旧订单/历史采购不出现在正式列表。 | 正式页面加筛选/分页；本任务只保证开放采购和当前缺料区不截断。 |
| P1-02 | 无“短装关闭/等待供应商补货”状态与操作。 | `prisma/schema.v2.draft.prisma` PurchaseState 无对应状态。 | 短装只能以拒收表达，供应商补货无闭环。 | 与供应商补货一起 P1 建模，避免用拒收伪造 RECEIVED 语义。 |
| P1-03 | GoodsReceiptLine 无 DB CHECK（quantity>0、REJECTED 原因、acceptedMaterialId、finalUnitCost>=0）；PurchaseOrderLine 数量/价格约束也缺。 | `prisma/schema.v2.draft.prisma`、`prisma/v2/migrations/0001_initial/migration.sql`。 | 绕过服务直写数据库可产生非法行。 | 先清理历史非法行再加约束；本任务不删除/改写历史数据。 |
| P1-04 | GoodsReceipt.storeId 与 PurchaseOrder.storeId 只能靠服务校验，无复合外键。 | Schema 关系定义。 | 直接写入可使收货门店与采购门店不一致。 | 增加复合唯一/外键或触发器。 |
| P1-05 | GoodsReceipt 无显式 idempotencyKey 字段；当前用确定性主键实现。 | `prisma/schema.v2.draft.prisma`；`receive-purchase-line.ts`/`reject-purchase-line.ts` 的 receiptIdFor。 | Schema 语义不直观，外部写入无标准幂等键。 | 后续加 nullable unique 字段并迁移服务。 |
| P1-06 | PurchaseOrderLine、GoodsReceiptLine、PurchaseDemandAllocation 缺 createdAt/updatedAt。 | 三个模型字段定义。 | 无法直接按行/分配时间审计。 | P1 补时间戳，不回填假时间。 |
| P1-07 | 拒收后 allocation 仍保留，无“失效分配”状态/自动释放。 | PurchaseDemandAllocation 无状态；拒收只写审计。 | 归因历史与失效归因无法区分。 | 明确 allocation 为归因历史；如需失效语义，新增显式状态/重建服务并审计，不能静默改历史。 |
| P1-08 | recheckSupplyAfterReceipt 在 receipt 提交后执行，失败只 console.error。 | `src/v2/services/recheck-supply.ts`。 | 收货成功但关联订单未及时重检。 | 增加可重试任务/失败队列；当前 receipt 成功、订单可手工再次确认。 |
| P1-09 | createPurchase 无幂等键/审计，双击可能重复 PO。 | `src/app/v2/actions.ts` createPurchase。 | 重复采购承诺。 | 与多明细采购一起 P1 加请求幂等与审计。 |
| P1-10 | 可用库存不含 AvailabilityHold；该模型当前未接入 V2 库存服务。 | `src/v2/services/material-availability.ts`、`src/v2/domain/stock-planning.ts`。 | 预支付临时锁定未反映在替换可用量。 | 预支付锁定接入库存时统一，不伪造已扣减。 |

## 4. P2 发现（记录，不实现）

| ID | 发现 | 证据 | 风险/影响 | 建议与处置 |
|---|---|---|---|---|
| P2-01 | 订单表状态列仍显示英文枚举。 | `src/app/v2/orders/page.tsx` 状态 td。 | 可读性不足。 | 正式页面统一中文标签。 |
| P2-02 | 替换是静态服务端 select，选中后不能即时刷新可用库存；已用选项展示+服务端复核缓解。 | `src/app/v2/orders/page.tsx` 替换表单。 | 选择体验一般，但不会绕过服务端校验。 | P1 页面化做客户端选择器/异步库存。 |
| P2-03 | 页面无组件级/E2E 测试；当前为纯 helper + action 测试。 | `src/app/v2/_lib/purchase-ui.test.ts`、`src/app/v2/order-ui.test.ts`。 | 页面回归覆盖不足。 | 页面稳定后补 Playwright/组件测试。 |
| P2-04 | 审计事件无查询页面。 | AuditEvent 模型存在，V2 无审计列表。 | 追溯需查库或看业务页局部记录。 | 按差距矩阵 A07 后置。 |
| P2-05 | 供应商列表 take:100，供应商多时仍可能隐藏选项。 | `src/app/v2/purchases/page.tsx` suppliers。 | 大型供应商目录选择不完整。 | 正式供应商管理/搜索时替换。 |

## 5. 四个确认缺陷对应

| 缺陷 | P0 | 结果 |
|---|---|---|
| V2-TRIAL-004 已有采购关联空白 | P0-07/P0-08 | 缺料区始终有明确状态和可用选择器；选项带 PO/物料/可分配量/预计到货；非法选择服务端再次拒绝。 |
| V2-TRIAL-005 部分降级后原等级无法续收 | P0-02/P0-09 | 一行可多次验收；五类数量分列；ACCEPTED 自动使用采购物料；累计不超 expected。 |
| V2-TRIAL-006 拒收不展示且可超采购量 | P0-01/P0-05/P0-06 | 拒收有锁、累计上限、状态重算、采购/订单审计和页面记录；超量不落库；关联订单显示仍缺料。 |
| V2-TRIAL-007 替换物料无可用库存 | P0-10 | 选项显示门店可用量/单位/缺口；服务端按 needBy 批次复核；库存不足无条件拒绝并回滚，人工/顾客确认不能覆盖。 |

## 6. 验证证据

已通过：
- 纯规则：`purchase-progress.test.ts`、`material-availability.test.ts`、`stock-planning.test.ts`、`purchase-ui.test.ts`、`order-ui.test.ts`、`purchase-pure.test.ts`。
- DB-backed：`receive-purchase-line.test.ts`、`reject-purchase-line.test.ts`、`allocate-purchase-demand.test.ts`、`substitute-order-material.test.ts`。
- 替换专项：`substitute-order-material.test.ts` 验证“需 10 支、仅 4 支可用 + customerConfirmed=true”仍被拒绝；无新修订、无替换预留、无替换审计，原采购分配保留。
- `npx tsc --noEmit --incremental false` 通过，无 `.next/dev/types/validator.ts` 基线错误。
- ESLint 对全部改动源文件通过。

环境说明：
- `npm run test:purchase` 在沙箱内因 tsx/esbuild 命名管道限制报 `spawn EPERM`，属执行环境失败；同一测试文件用 Node 类型剥离 + 进程内解析器执行，结果为 `purchase-pure tests passed`。DB 测试同样用该方式实际执行，未跳过。
- 未执行默认种子库 smoke，避免写入/污染默认租户数据；未做浏览器 E2E（P1）。

## 7. 未修改范围

未修改 V1、CMS/CRM/小程序、生成 Prisma client、依赖、lockfile、`.env*`、`.next`、迁移历史。未删除或改写现有业务数据。
