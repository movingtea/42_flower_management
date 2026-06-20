# Universe42 / 万物肆贰 — 业务规则清单

> **文档版本**：Sprint 13（基于 Sprint 12 已合并部署）  
> **适用范围**：flower-wms-system 后端、小程序 API、CMS/WMS 业务防线  
> **真理源**：本文档 + `src/lib/business-errors.ts` + `src/services/*-pure.ts`  
> **维护原则**：已确认规则必须写入本文；实现、测试与 smoke scripts 以本文为准。  
> **多租户说明（Sprint 21）**：业务规则仍按**单店**执行；`Tenant` / `TenantMember` 仅为未来 SaaS 边界地基，不改变当前权限与数据隔离语义。

---

## 1. 文档说明

本文档固化花店电商系统的已确认业务规则，用于：

- 后端 route / service 实现边界
- 纯函数业务规则（`*-pure.ts`）
- 业务不变量测试（`*.test.ts`）
- Smoke scripts（`scripts/smoke-*.ts`）
- 架构与验收对照

**本轮范围**：后端规则、防线、测试、文档与必要小修。不包含小程序倒计时 UI、店铺设置 UI、正式微信支付、对象存储等（见 §23 变更记录）。

---

## 2. 核心原则

1. **售罄 ≠ SKU 停用 ≠ SPU 下架**：`ProductSku.stock=0` 且 `ProductSku.isActive=true` 为售罄（`SOLD_OUT`）；`ProductSku.isActive=false` 为规格停用（`SKU_INACTIVE`）；`ProductSpu.isActive=false` 为商品下架（`OFF_SHELF`）。
2. **用户行为不得自动改上下架 / 停用**：库存不足、下单失败、支付失败不得修改 `ProductSpu.isActive` 或 `ProductSku.isActive`。
3. **错误码语义分离**：库存不足、提前预订、下架、权限不足必须使用不同错误码。
4. **CMS 配置 ≠ 小程序展示**：推荐位/Banner 经前台安全过滤后才返回小程序。
5. **虚拟库存 vs 物理库存**：下单锁 `ProductSku.stock`；支付后 FIFO 扣 `Batch.remainingQty`。
6. **CRM 失败隔离**：CRM 失败不得影响支付、FIFO、`OrderCostSnapshot`。
7. **权限多层校验**：Sidebar 隐藏不是权限控制；页面与 API 必须同步校验。

---

## 3. 关键状态定义

| 字段 | 模型 | 语义 |
|---|---|---|
| `ProductSpu.isActive` | SPU | 商品整体运营上架状态 |
| `ProductSku.isActive` | SKU | 规格是否运营可售（停用 ≠ 售罄） |
| `ProductSku.stock` | SKU | 虚拟可售库存 |

### 小程序展示状态

| 状态 | 条件 | 小程序行为 |
|---|---|---|
| `AVAILABLE` | SPU 上架 + 至少一个 active SKU + active SKU 总库存 > 3 | 可购买 |
| `LOW_STOCK` | SPU 上架 + active SKU 总库存 1~3 | 显示「仅剩 X 件」，可购买 |
| `SOLD_OUT` | SPU 上架 + 存在 active SKU 但 active SKU 总 stock = 0 | 展示商品，禁用购买，文案「卖光啦！」 |
| `OFF_SHELF` | SPU `isDeleted` / `!isActive`，或**全部 SKU inactive** | **不展示** |
| `SKU_INACTIVE` | 单个 SKU `isActive=false` | 小程序不展示该 SKU；购物车/下单返回「该规格暂不可售」 |

低库存阈值默认：**3**（`LOW_STOCK_THRESHOLD`）。

### 订单状态（节选）

| 状态 | 说明 |
|---|---|
| `PENDING_PAYMENT` | 待支付，已锁虚拟库存 |
| `PAID` ~ `COMPLETED` | 已支付履约链路 |
| `CANCELLED` | 已取消（含超时关闭、用户取消、退款） |

---

## 4. 商品展示规则

- 库存汇总**只统计 `ProductSku.isActive=true` 的 SKU**。
- 全部 SKU inactive：小程序商品列表/详情**不展示**该 SPU。
- `stock > 3`（active SKU 汇总）：正常库存，可购买。
- `1 <= stock <= 3`：低库存，显示「仅剩 X 件」。
- `stock = 0` 且 SKU 仍 active：售罄，继续展示 SPU，禁用购买。
- 售罄文案：**卖光啦！**
- SKU 停用：不展示该 SKU，**不得**显示为「卖光啦！」。
- SPU 下架：小程序不展示。
- 库存不足 ≠ SKU 停用 ≠ SPU 下架。
- 用户行为不得自动修改 `ProductSpu.isActive` / `ProductSku.isActive`。

### 单规格商品（默认 SKU）

- **SPU 不能独立售卖**；每个 SPU 底层**至少一个** `ProductSku`（存库字段 `spec_name`，默认 `"单规格"`）。
- **单规格商品**：仅 1 个 active SKU 时，CMS 展示「价格与库存」，无需手动「添加款式」；小程序**不展示**款式选择器，但下单仍传 `skuId`。
- **多规格商品**：≥2 个 SKU 时，CMS 需填写各款式品名；小程序展示款式选择器。
- 小程序 API 返回 `showSpecSelector`（`activeSkuCount > 1`）；单 SKU 时 `displaySpecName` 为空，不展示「单规格」等后台默认名。
- 不允许删除最后一个 SKU；已上架商品不允许停用最后一个启用 SKU（须先下架 SPU）。
- 实现：`src/lib/cms/single-spec-product.ts`、`ProductSkuEditorCards`、`wechat-product-mapper.ts`；库存展示状态见 `src/services/miniprogram-stock-pure.ts` → `resolveDisplayStatus`。

---

## 5. 购物车规则

- 加购/改数量必须服务端校验：SPU 上架 → SKU 存在 → **`ProductSku.isActive=true`** → `stock > 0`。
- SKU inactive 返回 **`SKU_INACTIVE`**（不得返回 `INSUFFICIENT_STOCK` 或 `PRODUCT_OFF_SHELF`）。
- 库存不足返回 `INSUFFICIENT_STOCK`，不得返回 `PRODUCT_OFF_SHELF`。
- SPU 下架返回 `PRODUCT_OFF_SHELF`。
- 购物车加载：inactive SKU 标记「该规格暂不可售」；stock=0 标记「卖光啦！」；SPU 下架标记「商品已下架」。
- 部分商品不可结算返回 `CART_ITEM_UNAVAILABLE`（购物车结算场景）。

实现：`src/lib/cart.server.ts`。

---

## 6. 下单规则

创建订单（`createWechatOrder`）顺序：

1. 校验金额、配送日期、商品行。
2. `assertSellableSpu`（SPU 下架 → `PRODUCT_OFF_SHELF`）。
3. `assertSellableSku`（SKU inactive → **`SKU_INACTIVE`**，不得扣库存、不写 CRM）。
4. 合并同 SKU 数量 → `assertOrderStockAvailable`（不足 → `INSUFFICIENT_STOCK`）。
5. `evaluateBulkPreorderRequirement`（仅对 **active SKU** 生效；违规 → `BULK_ORDER_REQUIRES_PREORDER`）。
6. 原子扣减 `ProductSku.stock`（`updateMany` where `isActive=true` AND `stock >= qty`）。
7. 创建 `PENDING_PAYMENT` 订单。
8. **成功后**才写 CRM（失败订单不写 CRM）。

红线：

- SKU inactive 不得创建订单、不得扣 stock、不得写 CRM、不得生成 `GiftOccasion` / `CustomerReminder`。
- 库存不足不得创建订单、不得扣 stock、不得写 CRM。
- 不得修改 `ProductSpu.isActive` / `ProductSku.isActive`。

---

## 7. 大批量提前预订规则

### 单 SKU 规则

| 配置项 | 默认值 | 说明 |
|---|---|---|
| `bulkOrderThreshold` | **3** | 可在 CMS SKU 编辑页修改 |
| `bulkMinLeadDays` | **1** | 可在 CMS 修改 |
| 当天大批量 | **不允许** | 命中后最早配送日 = 今天 + minLeadDays |

- 当 `quantity >= threshold` 且 `deliveryDate` 早于 `earliestDeliveryDate` → 拒绝创建订单。
- **只对 `ProductSku.isActive=true` 的 SKU 生效**；inactive SKU 提交时先返回 `SKU_INACTIVE`，不进入提前预订判断。
- 日期判断：**Asia/Shanghai**（`src/lib/datetime.ts`）。
- 前端可禁用不合法日期，**服务端必须强校验**。

错误码：`BULK_ORDER_REQUIRES_PREORDER`  
文案：这份花礼数量较多，我们需要提前为你备花和制作，暂不支持当天送达

### 订单总数量 / 金额

- 订单总数量可额外判断大批量，**仅提示，不自动拒单**（店主决定）。
- 第一版**不按订单金额**判断大批量。

实现：`src/services/preorder-rule-pure.ts`。

---

## 8. 店铺配送设置

店铺级配置（后续 CMS 店铺设置 UI），当前纯函数预留：

| 配置项 | 默认值 |
|---|---|
| 当天配送截单 | **17:00** |
| 可选配送时段 | **10:00–20:00** |
| 开启当天配送 | 是 |
| 开启预约配送 | 是 |
| 每日订单上限 | 不限制，仅提示 |
| 不支持配送日期 | 空 |
| 人工 override | 允许 |

规则：

- 超过 17:00 后不得选当天配送。
- `sameDayEnabled=false` 时今天不可选。
- `disabledDates` 命中不可选。
- 最终可选日期 = SKU 提前天数 + 店铺配送设置。

实现：`src/services/delivery-settings-pure.ts` → `evaluateDeliveryAvailability`。

---

## 9. 支付规则

- 当前为 **mock 支付**；正式微信支付未实现。
- 支付成功：`markOrderPaidWithFifo` 同事务扣物理批次 + 生成 `SALE_OUT` + `OrderCostSnapshot`。
- 支付失败/待支付：不得扣 `Batch.remainingQty`，不得生成 `SALE_OUT` / `OrderCostSnapshot`。

---

## 10. 订单取消 / 退款 / 回补规则

### 待支付订单（15 分钟）

- 15 分钟未支付自动关闭（`closeExpiredPendingOrders`）。
- 用户可在 15 分钟内主动取消。
- 关闭/取消后：**回补 `ProductSku.stock`**。
- 不得扣 `Batch.remainingQty`，不得生成 `SALE_OUT` / `OrderCostSnapshot`。

错误码：`ORDER_EXPIRED`  
文案：订单已超时关闭，请重新下单

> 小程序订单页倒计时 UI：Round 2。

### 已支付退款

- **退款取消 ≠ 自动物理回库**（Batch B.1）。
- 已支付订单退款时：订单状态 → `CANCELLED`；**不**自动增加 `Batch.remainingQty`；**不**写入 `IN_CANCEL`；历史 `SALE_OUT` 与 `OrderCostSnapshot` 保留。
- `rollbackStock`（API 字段名保持不变）**仅**表示是否回补虚拟 SKU 可售库存（`ProductSku.stock`），与物理批次无关。
- 物理花材回库须运营在后续 Batch B.2 显式选择批次/数量（基于 `restorePhysicalStockFromSaleOutInTx` 或新服务），不得默认全量回库。

实现：`refundPaidOrder(orderId, { rollbackStock })` — 仅当 `rollbackStock=true` 时调用 `restoreOrderSkuStock`。

修复记录：`docs/batch-b1-refund-stock-fix.md`。

---

## 11. CMS 商品规则

- 上架校验 `validateProductPublishReadiness`：只提示，不自动上下架。
- 运营标签、`operationNote` 等内部字段不返回小程序。
- 用户行为不得因库存变化自动下架商品。

---

## 12. Banner 规则

### CMS

- **删除 = 软删除**：`isDeleted=true` 且 `isActive=false`；**不物理删除**数据库记录，**不删除图片文件**。
- 删除后 CMS **默认列表不展示**（`listCmsBanners` 默认过滤 `isDeleted=false`）。
- **停用 ≠ 删除**：
  - 停用（`isActive=false`，`isDeleted=false`）：临时隐藏，CMS 仍可见，可恢复启用。
  - 删除（`isDeleted=true`）：默认管理列表隐藏，历史记录保留。
- API：`DELETE /api/admin/cms/banners/[id]`，需 `cms:write`；重复删除幂等。
- 支持有效期（`startsAt` / `endsAt`）。
- 允许无跳转（`targetType=NONE`）。

### 小程序

- 只返回 `isActive=true` 且 `isDeleted=false` 且在有效期内的 Banner。
- 停用 / 软删除 / 过期 / 未开始 均不返回。
- 按 `sortOrder` 排序，`createdAt`/`id` 兜底。
- 图片 URL 不得含 localhost。
- 不返回后台备注与内部字段。

实现：`src/services/banner-rules-pure.ts` → `filterHomeBannersForMiniprogram`。

---

## 13. 推荐位规则

推荐位是**人工运营配置**，不是自动推荐算法。

### CMS

- 售罄商品**不自动**从推荐位配置删除。
- 售罄**不自动**停用 item 或下架商品。

### 小程序

- 只返回 active slot + active item + 上架商品。
- 售罄判断：**只统计 `ProductSku.isActive=true` 的 SKU 库存**；active SKU 总库存为 0 → 不返回。
- 全部 SKU inactive → 不返回（CMS 配置保留，展示原因「所有规格已停用，前台不展示」）。
- 至少一个 active SKU 且 active SKU 总库存 > 0 可展示。
- 缺主图不返回。
- 过滤后 items 为空 → **不返回整个 slot**。
- **不自动补位**。
- 不返回 `operationNote`、成本、毛利、产品决策 warning。
- 排序：`slot.sortOrder` → `item.sortOrder` → `createdAt`/`id`。

实现：`src/services/recommendation-rules-pure.ts` → `filterRecommendationSlotsForMiniprogram`。

---

## 14. 首页场景入口规则

- CMS 可配置 `CmsHomeSceneEntry`；无 active 配置时使用默认 6 个 fallback。
- 与推荐位商品配置边界分离。
- Fallback：`buildFallbackMiniProgramEntries()`。

---

## 15. 图片 URL 规则

- 数据库存 **OSS objectKey**（如 `universe42/products/sku/xxx.webp`）；**不得**存完整 OSS public URL、localhost、`/uploads`。
- 小程序 API（Batch C）：`/api/miniprogram/*` 成功响应经 `jsonWechatSuccess` → mapper 层 `miniprogram-image-dto` + 兜底 `imageUrlFormatter`，**image src 字段必须输出完整 HTTPS OSS URL**。
- 客户端 `normalizeImageUrl` 仅作防御性兜底，不是主转换层。
- **禁止**返回裸 objectKey、localhost、`/uploads`、`https://www.universe42.studio/universe42/...` 给小程序 `<image src>`。
- `iconKey` 等逻辑 key 不得误转 OSS URL。

实现：`src/lib/miniprogram-image-dto.ts`、`src/lib/image-url.ts`、`src/utils/imageUrlFormatter.ts`。

---

## 16. CRM 规则

- 暂不直接触达客户（无订阅消息 / 短信）。
- 系统内提醒仅后台运营提醒。
- 提醒超过 **1 天**未处理视为过期（`isSystemReminderExpired`）。
- CRM 失败只记日志，不影响支付/FIFO/成本快照。
- 订单创建失败不得写 CRM。

实现：`src/services/crm-pure.ts`、`src/services/crm.ts`。

---

## 17. 报表与成本规则

- 销售报表默认**排除已退款订单**；退款单独列示。
- 退款不得删除 `OrderCostSnapshot`；不得重算历史采购成本。
- 退款分析与正常销售分开展示。

---

## 18. 权限规则

| 角色 | 边界 |
|---|---|
| `STORE_ADMIN` | 全店最高业务权限；可管理店员与用户组 |
| `WAREHOUSE_MANAGER` | 库存、采购、仓储；默认不管理 CMS 营销 / CRM / 用户角色 |
| `FLORIST` | 订单履约、物料母表、配方、包装；默认不管理采购单 / CRM / 报表 / 用户 |
| `IT_ADMIN` | 系统技术维护、用户角色；**不得访问业务数据** |

权限 key（复用现有）：`staff:manage`、`business:read`/`write`、`wms:read`/`write`、`cms:read`/`write`、`orders:write`、`loss:audit`。

红线：API 权限不得弱于页面权限；`IT_ADMIN` 不得访问业务 API。

实现：`src/lib/rbac.ts`、`src/lib/api-auth.ts`、`src/proxy.ts`。

---

## 19. 错误码规则

### 小程序错误码

| Code | 默认文案 |
|---|---|
| `AUTH_REQUIRED` | 请先登录 |
| `PRODUCT_NOT_FOUND` | 商品不存在 |
| `PRODUCT_OFF_SHELF` | 商品已下架 |
| `SKU_NOT_FOUND` | 规格不存在 |
| `SKU_INACTIVE` | 该规格暂不可售 |
| `INSUFFICIENT_STOCK` | 库存不足，当前仅剩 X 件 |
| `INVALID_QUANTITY` | 购买数量不正确 |
| `PRICE_CHANGED` | 商品价格有变化，请重新确认 |
| `INVALID_DELIVERY_DATE` | 请选择有效配送日期 |
| `BULK_ORDER_REQUIRES_PREORDER` | 这份花礼数量较多…暂不支持当天送达 |
| `DELIVERY_SLOT_UNAVAILABLE` | 该配送时段暂不可选 |
| `CART_ITEM_UNAVAILABLE` | 部分商品暂不可结算，请重新确认 |
| `ORDER_NOT_FOUND` | 订单不存在 |
| `ORDER_INVALID_STATE` | 当前订单状态无法操作 |
| `ORDER_EXPIRED` | 订单已超时关闭，请重新下单 |

### 后台错误码

| Code | 默认文案 |
|---|---|
| `PERMISSION_DENIED` | 你没有权限执行此操作 |
| `VALIDATION_ERROR` | 请检查填写内容 |
| `ENTITY_NOT_FOUND` | 数据不存在或已被删除 |
| `DUPLICATE_KEY` | 该 key 已被使用 |
| `INVALID_STATE_TRANSITION` | 当前状态不允许此操作 |
| `BUSINESS_RULE_VIOLATION` | 操作不符合业务规则 |

### 错误码红线

- 库存不足 → `INSUFFICIENT_STOCK`，不得 `PRODUCT_OFF_SHELF`。
- 提前预订 → `BULK_ORDER_REQUIRES_PREORDER`，不得 `INSUFFICIENT_STOCK`。
- 权限不足 → `PERMISSION_DENIED`。
- 小程序 API 不得暴露 stack trace。

统一响应格式（兼容 `success`/`error` 字段）：

```json
{
  "ok": false,
  "success": false,
  "code": "INSUFFICIENT_STOCK",
  "message": "库存不足，当前仅剩 2 件",
  "error": "库存不足，当前仅剩 2 件"
}
```

实现：`src/lib/business-errors.ts`。

---

## 20. 业务不变量

| # | 不变量 |
|---|---|
| 1 | 库存不足不得创建订单 |
| 2 | 库存不足不得扣 `ProductSku.stock` |
| 3 | 库存不足不得写 CRM |
| 4 | 库存不足不得生成 `GiftOccasion` / `CustomerReminder` |
| 5 | 库存不足不得改上下架状态 |
| 6 | `ProductSku.stock` 不得扣成负数 |
| 7 | `stock=0` → `SOLD_OUT`，非 `OFF_SHELF` |
| 8 | 下架 → `OFF_SHELF`，非 `SOLD_OUT` |
| 9 | 创建订单成功扣 `ProductSku.stock` |
| 10 | 支付成功扣 `Batch.remainingQty` |
| 11 | 支付失败不扣 `Batch.remainingQty` |
| 12 | 支付成功生成 `SALE_OUT` + `OrderCostSnapshot` |
| 13 | 待支付取消/超时回补 `ProductSku.stock` |
| 14 | 待支付取消不扣 Batch、不生成 SALE_OUT |
| 15 | 已支付退款默认不回填物理库存 |
| 16 | 推荐位不返回售罄商品；过滤为空不返回 slot |
| 17 | Banner inactive/软删/过期不返回小程序 |
| 18 | 小程序 API 不返回 localhost / 敏感字段 |
| 19 | `IT_ADMIN` 不得访问业务数据 |

测试：`src/services/order-invariants-pure.ts` 及各 `*-invariants.test.ts`。

---

## 21. 人工确认项

| 项 | 结论 |
|---|---|
| 推荐位是否展示 stock=0 | **不允许**（小程序过滤） |
| 推荐位售罄是否自动隐藏 | 小程序隐藏，CMS 配置保留 |
| 推荐位售罄判断口径 | 商品所有 SKU 总库存 |
| 过滤后为空 | 隐藏整个推荐位模块 |
| 是否自动补位 | **不补位** |
| 未绑定 Recipe 商品上架 | 不建议（warning） |
| 推荐位是否强制主图 | **是** |
| 待支付倒计时 UI | Round 2 |
| 店铺配送设置 CMS UI | 后续 sprint |
| Banner `startsAt`/`endsAt` DB 字段 | 纯函数已支持，DB 待迁移 |

---

## 22. 测试覆盖要求

### 纯函数测试

```bash
npm run test:preorder-rule
npm run test:delivery-settings
npm run test:recommendation-rules
npm run test:banner-rules
npm run test:order-invariants
npm run test:stock-invariants
npm run test:permission-invariants
npm run test:crm-invariants
npm run test:image-url-invariants
npm run test:all   # 全量
```

### Smoke scripts

```bash
npm run smoke:stock-boundary        # 需 DATABASE_URL
npm run smoke:preorder-rule
npm run smoke:cms-home-content
npm run smoke:image-url
npm run smoke:permission-matrix     # 无需 DB
npm run smoke:crm-order-sync
npm run smoke:miniprogram-order-flow
npm run smoke:recommendation-rules  # 无需 DB
```

测试数据前缀：`SMOKE_TEST_*` / `E2E_TEST`；勿在生产环境裸跑。

---

## 23. 验收清单

- [x] `docs/business-rules.md` 已新增
- [x] 统一错误码 `src/lib/business-errors.ts`
- [x] 纯函数：`preorder-rule`、`delivery-settings`、`recommendation-rules`、`banner-rules`、`order-invariants`
- [x] 推荐位售罄过滤、空 slot 隐藏
- [x] Banner localhost 过滤
- [x] 待支付 15 分钟关闭服务 `closeExpiredPendingOrders`
- [x] 退款默认不回填库存
- [x] CRM 提醒 1 天过期判定
- [x] IT_ADMIN 业务 API 阻断
- [x] 不变量测试 + smoke scripts
- [x] Sprint 13：`ProductSku.isActive`、SKU 停用 vs 售罄语义、CMS SKU 启用开关
- [ ] 小程序订单倒计时 UI（Round 2）
- [ ] 店铺配送设置 CMS UI（后续）
- [ ] Banner 有效期 DB 字段（后续）

---

## 25. 主数据：FlowerWiki 与 MasterPart（Batch P2）

| 母表 | 模型 | 适用范围 | 说明 |
|---|---|---|---|
| 花材母表 | `FlowerWiki` | 鲜切花、叶材、枝材、需养护指南的花材 | 含醒花 / 养护 / 剪根 / 营养液等花材专属字段 |
| 通用物料母表 | `MasterPart` | 辅料、包装材料、工具、其他耗材 | `type` 为 `SUPPLY` / `PACKAGING` / `TOOL` / `OTHER`；**不含 FLOWER** |

**当前边界（Batch P2）：**

- MasterPart 已提供 CRUD API 与 WMS 管理页 `/wms/master-parts`。
- 新建 MasterPart 写入 `tenantId = "universe42"`（Sprint 23-A `withTenant`）。
- **采购单保存逻辑尚未接入 MasterPart**；非花材采购仍使用 Batch P1 临时方案（按物料名称匹配 `FlowerWiki.chineseName`）。
- 非花材采购正式接入 MasterPart 将在 **Batch P3** 处理。

---

## 24. 变更记录

| 日期 | 版本 | 说明 |
|---|---|---|
| 2026-06-11 | Sprint 12 R1 | 初版：业务规则文档、错误码、纯函数防线、不变量测试、smoke scripts |
| 2026-06-11 | Sprint 13 | `ProductSku.isActive`：SKU 停用 vs 售罄 vs SPU 下架语义补齐；CMS SKU 启用开关；推荐位/购物车/下单 active SKU 过滤 |
| 2026-06-11 | Sprint 13 fix | CMS Banner 删除修复：`listCmsBanners` 默认过滤 `isDeleted`；软删除幂等；删除按钮 loading/确认文案 |
| 2026-06-17 | Batch P2 | 新增 `MasterPart` 通用物料母表；FlowerWiki 仅表示花材；采购单尚未接入 MasterPart |
