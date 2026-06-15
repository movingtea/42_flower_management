# Multi-Tenant SaaS Readiness Audit

> **Sprint 20 — 多租户 SaaS 改造准备审计**  
> **审计日期**：2026-06-15  
> **代码基线**：`flower-wms-system/` @ `master`（单店 Universe42 / 万物肆贰）  
> **范围**：只读审计与改造计划；**未修改** schema、业务代码、小程序、Docker、OSS 逻辑。

---

## 1. Executive Summary

当前系统是**强单店假设**的 WMS + CMS + 微信小程序一体化平台：全库共享一套商品、库存、订单、CRM、CMS 配置与后台 RBAC，**不存在 `tenantId` / `storeId` 字段**，Prisma 查询与 cron-worker 均为全局扫描。

| 维度 | 当前状态 | SaaS 就绪度 |
|---|---|---|
| 数据模型 | 35 个 Prisma model，0 个租户字段 | ❌ 未就绪 |
| Unique 约束 | 15+ 全局唯一字段/组合 | ❌ 需租户化 |
| Service / API | 全部业务查询无 tenant 过滤 | ❌ 高风险 |
| 权限 | `StaffUser.role` 全局枚举，无店铺边界 | ❌ 未就绪 |
| 配置 | `AppConfig` 全局 key | ❌ 需租户化 |
| OSS | `universe42/{module}/...`，无 tenant 前缀 | ⚠️ 可渐进改造 |
| 小程序 | 单 baseUrl、单 appId、无 store 参数 | ⚠️ 方案 A 优先 |
| 支付 | 全局 env + 占位 callback | ⚠️ 需预留模型 |
| Cron | 全局 `closeExpiredPendingOrders` + 库存投影 | ❌ 跨租户风险 |
| AuditLog | 无 `tenantId` | ❌ 未就绪 |
| 部署 | 单机 Docker Compose，无 Redis，DB 在容器内 | ⚠️ 早期可单机多租户，规模化需 RDS/Redis |

**结论**：可在不破坏单店运行的前提下，按 **10 阶段迁移路线** 渐进改造。推荐 **方案 A（一个平台小程序 + storeSlug/scene 进店）**；支付早期可采用 **模式 B（商户自收款）** 或平台统一收款 + 分账（后期）。

**本轮交付**：本文档 + `ARCHITECTURE.md` / `README.md` 摘要；**无 schema / 代码 / migration 变更**。

---

## 2. Current Architecture Assumptions

### 2.1 已确认的强单店假设

1. **唯一店铺**：全库只有一套 `ProductSpu` / `Supplier` / `Order` / `Banner` / 推荐位。
2. **全局配置**：`AppConfig.key` 全局唯一（`STORE_DELIVERY_SETTINGS`、`GLOBAL_NOTICE`、`HOME_POPUP` 等）。
3. **全局 OSS 前缀**：`ALIYUN_OSS_OBJECT_PREFIX=universe42`，`buildObjectKey()` 不含 tenant。
4. **全局微信**：`WECHAT_MINI_APP_ID` / `SECRET` 单套；`User.openId` 全局 `@unique`。
5. **全局员工角色**：`StaffUser.role` 直接绑定五档 `Role` 枚举，无 `TenantMember`。
6. **购物车客户端化**：无 `Cart` / `CartItem` 表；`wx.setStorageSync('cart')` 无店铺维度。
7. **订单无店铺归属**：`Order` 仅 `userId`，cron 关闭待支付订单时 `findMany` 无 tenant 过滤。
8. **库存投影全局**：`syncPhysicalStockToVirtual()` 扫描全部在线 SKU。
9. **报表 / CRM / 数据质量**：所有聚合查询跨全库。
10. **Migration 多实例风险**：`docker-entrypoint.sh` 每个 `flower-web` 实例启动时 `prisma migrate deploy`（横向扩展时可能竞态）。

### 2.2 架构文档已声明的边界

`ARCHITECTURE.md` §1 / §14 红线 #17 已写明：**「当前不是多租户 SaaS，新增业务代码不得假设 tenant 隔离已存在。」**

### 2.3 与用户清单的差异（真实 schema）

| 用户清单中的名称 | 实际状态 |
|---|---|
| `Product` | → `ProductSpu` |
| `StockAdjustment` | → `StockLog` type `ADJUSTMENT` |
| `PackagingPlan` / `PackagingItem` | → `PackagingKit`（无物理子项表） |
| `Cart` / `CartItem` | **不存在**（小程序本地 storage） |
| `Payment` / `Refund` | **不存在**（状态在 `Order` 字段） |
| `Address` | **不存在**（订单快照 + `User.defaultAddress`） |
| `Role` / `Permission` / `UserRole` | `Role` 为 **enum**，挂在 `StaffUser` |
| `UploadAsset` | **不存在**（图片存各业务表 `imageUrl` objectKey） |
| `FeatureFlag` / `CronJobLog` / `DataQualityIssue` | **不存在**（运行时计算或日志输出） |
| `MarketingPopup` | → `AppConfig` key `HOME_POPUP` + `Banner` 表 |
| `RichText` | 商品 `description` / 营销 JSON，无独立表 |

---

## 3. Tenant Model Proposal

### 3.1 核心实体（目标）

```text
Tenant
  ├── id (cuid/uuid)
  ├── slug (URL / 小程序 scene，tenant-scoped unique)
  ├── name, status (ACTIVE | SUSPENDED | TRIAL)
  ├── planId (可选，SaaS 计费)
  ├── wechatMiniAppId (方案 B 时)
  └── settings JSON / 关联 TenantConfig

TenantMember
  ├── tenantId + staffUserId (@@unique)
  ├── role (租户内角色，映射现有 Role 或 TenantRole)
  └── isDefault (用户默认店铺)

PlatformAdmin (或 StaffUser.isPlatformAdmin)
  ├── staffUserId
  └── platformRole (SUPER_ADMIN | SUPPORT | BILLING)

User (小程序，平台级身份)
  └── TenantCustomer (可选中间表：userId + tenantId → Customer)
```

### 3.2 `tenantId` vs `storeId`

| 策略 | 说明 |
|---|---|
| **MVP（推荐）** | 一租户 = 一花店；仅 `tenantId`，不引入 `storeId` |
| **扩展** | 连锁品牌多门店时：`tenantId` + `storeId`；WMS 库存可按 store 分仓 |
| **显式 tenantId** | 所有业务表必须**显式**存 `tenantId`，不可仅靠 `Order → Customer` 链路推导（防跨租户 ID 枚举、报表漏过滤） |

### 3.3 租户上下文传递

| 入口 | 建议解析顺序 |
|---|---|
| 后台 CMS/WMS | Session JWT：`currentTenantId`（`TenantMember` 校验） |
| 小程序 API | Header `X-Tenant-Id` 或 `X-Store-Slug`；scene / query `store` |
| 微信支付回调 | `orderNo` 前缀 / metadata / 子商户号 → `tenantId` |
| Cron-worker | 按 `Tenant` 表分片循环，或 `WHERE tenantId = ?` |

---

## 4. Prisma Model Audit

| Model | 当前用途 | 数据级别 | 是否需要 tenantId | 是否需要 tenant-scoped unique | 改造风险 | 备注 |
|---|---|---|---|---|---|---|
| **Tenant**（未来） | 租户 / 花店主档 | platform | — | `slug` 平台唯一 | 低 | 新表；Sprint A |
| **TenantMember**（未来） | 员工 ↔ 租户 | auth-global | tenantId（FK） | `@@unique([tenantId, staffUserId])` | 中 | 替代 StaffUser 直接挂 Role |
| **PlatformAdmin**（未来） | 平台运维 | platform | — | `staffUserId` unique | 低 | 可合并为 StaffUser 标志位 |
| ProductCategory | 商城分类树 | tenant | **是** | name 同级可选 unique | 中 | 含 parentId 树 |
| ProductCategoryRelation | SPU↔分类 | shared-but-scoped | **是**（或经 SPU） | `@@unique([tenantId,spuId,categoryId])` | 中 | 建议与 SPU 同 tenant |
| MaterialCategory | WMS 原料分类 | tenant | **是** | name tenant 内唯一 | 低 | |
| MaterialCategoryRelation | 原料↔分类 | shared-but-scoped | **是** | 组合 unique | 低 | |
| Supplier | 供应商 | tenant | **是** | **name** tenant 内 | 中 | 当前仅 index name |
| PurchaseOrder | 采购单 | tenant | **是** | **purchaseNo** 见 §5 | 高 | 入库链路长 |
| PurchaseOrderLine | 采购明细 | shared-but-scoped | **是**（或经 PO） | inboundBatchId 保持全局 unique OK | 高 | |
| ProductSpu | 商城 SPU | tenant | **是** | name/slug 若引入 | 高 | 核心 CMS |
| ProductSku | SKU / 库存 | tenant | **是** | **skuCode** tenant 内 | 高 | 下单扣 stock |
| CmsRecommendationSlot | 推荐位 | tenant | **是** | **key** tenant 内 | 高 | 当前全局 `@unique key` |
| CmsRecommendationItem | 推荐商品 | shared-but-scoped | **是** | — | 中 | 经 slot 隔离 |
| CmsHomeSceneEntry | 首页场景入口 | tenant | **是** | — | 中 | |
| Banner | 首页轮播 | tenant | **是** | — | 中 | |
| Material | 仓储原材料 | tenant | **是** | **materialCode** tenant 内 | 高 | FIFO 根节点 |
| Recipe | 标准配方 | tenant | **是** | **recipeCode** tenant 内 | 高 | |
| PackagingKit | 包装方案 | tenant | **是** | **name** tenant 内 | 中 | |
| RecipeLine | 配方明细 | shared-but-scoped | **是**（或经 Recipe） | `@@unique([recipeId,flowerWikiId])` 保持 | 中 | |
| Batch | 物理批次 | tenant | **是** | **batchNo** tenant 内 | 高 | |
| StockLog | 库存流水 | tenant | **是** | — | 高 | 报表依赖 |
| StockLossRecord | 报损留痕 | tenant | **是** | stockLogId 保持 | 中 | |
| FlowerWiki | 花材母表 | **待定** | 可选 / 是 | **englishName** 见 §5 | 中 | 可平台共享库 + 租户覆盖成本 |
| StaffUser | 后台账号 | auth-global | 否（平台） | username 平台唯一 | 中 | 通过 TenantMember 关联租户 |
| StaffAuditLog | 密码重置审计 | audit | 可选 tenantId | — | 低 | 平台级也可 |
| User | 小程序微信用户 | auth-global | 否 | **openId** 见 §5 | 高 | 需 `(appId,openId)` 或 unionId 策略 |
| Order | 小程序订单 | tenant | **是** | **orderNo** 见 §5 | **极高** | 无 tenant 字段 |
| OrderItem | 订单行 | shared-but-scoped | **是**（或经 Order） | — | 高 | |
| OrderCostSnapshot | 订单毛利 | shared-but-scoped | **是**（或经 Order） | orderId unique 保持 | 高 | |
| Customer | CRM 购买人 | tenant | **是** | phone / openId tenant 内 | **极高** | miniProgramUserId 全局 unique 有问题 |
| Recipient | 收花人 | tenant | **是** | phone tenant 内（同客户下） | 高 | |
| CustomerRecipientRelation | 购买人↔收花人 | shared-but-scoped | **是** | `@@unique` 加 tenant | 中 | |
| GiftOccasion | 礼赠场景 | tenant | **是** | — | 中 | |
| CustomerReminder | 复购提醒 | tenant | **是** | — | 中 | cron 扫描需过滤 |
| AppConfig | 全局 KV 配置 | config | **是**（或拆 TenantConfig） | **key** → `@@unique([tenantId,key])` | 高 | 配送/公告/弹窗 |
| AuditLog | 业务操作审计 | audit | **是** | — | 高 | 无 tenantId |
| **Cart / CartItem** | — | — | N/A | — | — | **不存在**；小程序本地 storage |
| **Payment / Refund** | — | — | N/A | — | — | **不存在**；未来 `PaymentProviderConfig` |
| **UploadAsset** | — | — | N/A | — | — | **不存在**；可选 Sprint F 新增 |

### 4.1 FlowerWiki 策略建议

| 选项 | 适用 |
|---|---|
| A. 平台共享母表 + 租户 `FlowerWikiTenantCost` 覆盖标准成本 | 多店共用花材百科、各店成本不同 |
| B. 每租户独立 `FlowerWiki` + tenantId | 完全隔离，迁移简单 |

**推荐 Phase 1–7**：选项 B（全部挂默认 tenant）；后期再抽平台共享库。

### 4.2 必须显式 tenantId 的表（核心清单）

`ProductSpu`, `ProductSku`, `ProductCategory`, `Order`, `Customer`, `Supplier`, `Material`, `Batch`, `StockLog`, `Recipe`, `PurchaseOrder`, `Banner`, `CmsRecommendationSlot`, `CmsHomeSceneEntry`, `AppConfig`（或等价）, `AuditLog`

---

## 5. Unique Constraint Audit

| Constraint | 当前唯一范围 | SaaS 后建议唯一范围 | 是否需要迁移 | 风险 |
|---|---|---|---|---|
| `ProductSku.skuCode` | 全局 | **tenant 内** `@@unique([tenantId, skuCode])` | 是 | 高 — 第二家店无法复用编码规则 |
| `CmsRecommendationSlot.key` | 全局 | **tenant 内** | 是 | 高 — `HOME_MAIN` 等 key 冲突 |
| `Material.materialCode` | 全局 | **tenant 内** | 是 | 高 |
| `Recipe.recipeCode` | 全局 | **tenant 内** | 是 | 中 |
| `Supplier.name` | 无 unique（仅 index） | **tenant 内 unique**（建议新增） | 是 | 中 — 同名供应商混淆 |
| `PackagingKit.name` | 无 unique | **tenant 内 unique**（建议） | 可选 | 低 |
| `ProductSpu.name` | 无 unique | **tenant 内**（运营层校验即可） | 可选 | 低 |
| `PurchaseOrder.purchaseNo` | 全局 | **tenant 内** 或 平台全局 + 租户前缀 `PO-{tenantSlug}-...` | 是 | 中 |
| `Batch.batchNo` | 全局（nullable） | **tenant 内** | 是 | 中 |
| `Order.orderNo` | 全局 | **推荐平台全局** `ORD-{tenantSlug}-...` 或 `@@unique([tenantId, orderNo])` | 是 | 高 — 支付回调靠 orderNo |
| `User.openId` | 全局 | **`@@unique([wechatAppId, openId])`** 或 tenant 绑定 appId | 是 | **极高** — 多小程序必改 |
| `Customer.miniProgramUserId` | 全局 | **`@@unique([tenantId, miniProgramUserId])`** | 是 | 高 |
| `Customer.phone` | 无 unique（index） | **tenant 内**（CRM 合并规则） | 建议 | 中 |
| `StaffUser.username` | 全局 | **保持平台全局** | 否 | 低 — 一账号多店 |
| `FlowerWiki.englishName` | 全局 | 平台共享则保持；tenant 隔离则 **tenant 内** | 视策略 | 中 |
| `AppConfig.key` | 全局 | **`@@unique([tenantId, key])`** | 是 | 高 |
| `PurchaseOrderLine.inboundBatchId` | 全局 | 保持（Batch ID 已 tenant 隔离） | 否 | 低 |
| `OrderCostSnapshot.orderId` | 全局 | 保持 | 否 | 低 |
| `StockLossRecord.stockLogId` | 全局 | 保持 | 否 | 低 |
| `RecipeLine @@unique([recipeId, flowerWikiId])` | recipe 内 | 保持（recipe 已 tenant 隔离） | 否 | 低 |
| `ProductCategoryRelation @@unique([spuId, productCategoryId])` | 组合 | 保持（SPU 已 tenant 隔离） | 否 | 低 |
| `CustomerRecipientRelation @@unique([customerId, recipientId])` | 组合 | 保持 | 否 | 低 |
| 支付流水号（未来） | — | **tenant 或平台全局** | 新表 | 高 |
| 系统配置 key（env） | 单套 env | 迁入 `PaymentProviderConfig` 等 | 是 | 高 |

### 5.1 OrderNo 建议

**推荐**：`ORD-{tenantSlug}-{yyyyMMdd}-{random}`，数据库 **`orderNo` 保持平台全局 `@unique`**（支付回调简单）。同时 `Order.tenantId` 必填并索引。

---

## 6. Service / API Tenant Boundary Audit

> 统计：`src/services/*` 约 120+ 处 Prisma 写读；`src/app/api/*` 约 30+ 处。以下按**模块**列出高风险代表；**全部**业务查询未来需 `tenantId` 过滤。

| 文件 | 函数 / API | 当前查询对象 | 是否需要 tenantId | 当前风险 | 建议改造方式 |
|---|---|---|---|---|---|
| `order-lifecycle.ts` | `createWechatOrder` | Order, ProductSku, CRM | **是** | **high** | 从请求上下文取 tenant；所有 SKU/库存校验加 `tenantId` |
| `order-lifecycle.ts` | `closeExpiredPendingOrders` | Order 全局 `PENDING_PAYMENT` | **是** | **high** | cron 按 tenant 分片或 `where: { tenantId }` |
| `order-fifo.ts` | `markOrderPaidWithFifo` | Batch, StockLog, Order | **是** | **high** | 事务内校验 order.tenantId 与 batch 同租户 |
| `miniprogram-products.ts` | 商品列表 | ProductSpu 全库 | **是** | **high** | `where: { tenantId, isActive, ... }` |
| `cms-product-operations.ts` | 推荐位 CRUD / 查询 | CmsRecommendationSlot | **是** | **high** | slot key 租户内生成 |
| `cms-banners.ts` | Banner 列表 / 小程序过滤 | Banner | **是** | **high** | |
| `cms-home-scene-entries.ts` | 场景入口 | CmsHomeSceneEntry | **是** | **high** | |
| `crm.ts` | 客户列表 / 订单沉淀 | Customer, Order | **是** | **high** | Customer 按 tenant；禁止跨店合并 |
| `purchase.ts` | 供应商 / 采购单 | Supplier, PurchaseOrder | **是** | **high** | |
| `wms-stock.ts` / `fifo.ts` | 入库 / 报损 / FIFO | Material, Batch | **是** | **high** | |
| `inventory-sync.ts` | `syncPhysicalStockToVirtual` | 全部在线 SKU | **是** | **high** | 按 tenant 循环或过滤 |
| `business-report.ts` | 全部报表 | Order, StockLog, Batch | **是** | **high** | 报表 API 强制 tenantId |
| `product-decision.ts` | 产品决策 | Order, ProductSku | **是** | **high** | |
| `data-quality.ts` | 数据质量扫描 | 全库多表 | **是** | **medium** | 按 tenant 扫描 |
| `setup-checklist.ts` | 试运营检查 | 全库聚合 | **是** | **medium** | |
| `audit-log.ts` | `listAuditLogs` | AuditLog 全库 | **是** | **high** | 写入/查询带 tenantId |
| `store-delivery-settings.ts` | 配送配置 | AppConfig 全局 key | **是** | **high** | `@@unique([tenantId, key])` |
| `wiki.ts` | FlowerWiki CRUD | FlowerWiki | 视策略 | **medium** | |
| `recipe.ts` | 配方 CRUD | Recipe | **是** | **high** | |
| `auth.ts` | 后台登录 | StaffUser | 否 | **low** | 登录后加载 TenantMember |
| `api/wechat/auth/login` | 小程序登录 | User upsert by openId | **间接** | **high** | 绑定 appId；Customer 按 tenant 创建 |
| `api/wechat/orders/callback` | 支付回调 | Order by orderNo | **是** | **high** | 从 orderNo / 商户号解析 tenant |
| `api/miniprogram/*` | 商品 / 订单 / 购物车校验 | 各业务表 | **是** | **high** | 中间件注入 `tenantContext` |
| `api/admin/*` | 全部后台 API | 各业务表 | **是** | **high** | `requirePermission` + `requireTenant` |
| `cron-inventory-daemon.ts` | tick | 全局任务 | **是** | **high** | 租户分片 + 分布式锁 |
| `lib/cart.server.ts` | 购物车校验 API | ProductSku | **是** | **high** | |
| `actions/staff-users.ts` | 员工管理 | StaffUser | 否/部分 | **medium** | 平台管理员 vs 租户管理员 |
| `system-health.ts` | 健康检查 | staffUser.count | 否 | **low** | 平台级 |

### 6.1 高风险 API 清单（优先改造）

1. `POST /api/miniprogram/orders/create`
2. `POST /api/miniprogram/orders/mock-pay`
3. `GET /api/miniprogram/products`、`/products/[id]`
4. `GET /api/miniprogram/homepage`、`/home-banners`、`/recommendations`、`/home-scene-entries`
5. `POST /api/miniprogram/cart`
6. `GET /api/admin/orders/*`、`/api/admin/reports/*`
7. `POST /api/admin/wms/stock-in`、`/stock-loss`
8. `POST /api/wechat/orders/callback`
9. `closeExpiredPendingOrders`（cron）

---

## 7. Auth / RBAC Audit

### 7.1 现状回答

| 问题 | 现状 |
|---|---|
| User 与 Role 关系 | **小程序 `User`** 无 Role；**后台 `StaffUser.role`** 为 `Role` 枚举字段 |
| 角色是否全局 | **是**，五档全局：`IT_ADMIN` / `STORE_ADMIN` / `WAREHOUSE_MANAGER` / `FLORIST` / `STORE_OPERATOR` |
| 是否缺少 tenant 边界 | **是**，`requirePermission` 只校验 role，无 tenantId |
| 是否需要 TenantMember | **需要** |
| 是否需要 Platform Admin | **需要**（或 `IT_ADMIN` 升格 + 业务隔离） |
| IT Admin 是否应拆分 | **建议**：`PLATFORM_ADMIN`（跨租户运维） vs `TENANT_IT_ADMIN`（单店技术） |
| 普通店铺用户如何限制 | 未来：`TenantMember` + 每次查询 `tenantId = session.currentTenantId` |
| 平台管理员跨租户审计 | `AuditLog` 加 `tenantId` + `actorScope: PLATFORM \| TENANT` |
| 用户多店切换 | 后台 UI 店铺切换器；session 存 `currentTenantId` |
| session 应保存什么 | `staffUserId`, `currentTenantId`, `tenantRole`, `platformRole?` |

### 7.2 目标模型

```text
User (StaffUser) — 平台账号，username 全局唯一
TenantMember — tenantId + staffUserId + role
Permission — 可保持字符串 key（business:read 等），挂在 role 映射表
PlatformAdmin — staffUserId + platformRole（可选独立表）
```

### 7.3 最小改造 vs 最终方案

| 阶段 | 最小改造 | 最终目标 |
|---|---|---|
| Auth | StaffUser 不变；增加 `TenantMember`；默认租户 ID 硬编码在 env | 完整多租户 session + 店铺切换 |
| 权限 | `hasPermission(role, perm)` + `assertTenantMember(tenantId)` | Tenant 级 role override + 平台角色 |
| IT_ADMIN | 保持业务盲区 | 仅 `PlatformAdmin` 可跨租户读审计 |

---

## 8. Tenant-Scoped Settings Audit

| 配置项 | 当前存储方式 | SaaS 后归属 | 建议模型 / 表 | 风险 |
|---|---|---|---|---|
| 配送设置 | `AppConfig` `STORE_DELIVERY_SETTINGS` | tenant | `AppConfig` + `tenantId` 或 `TenantSettings` | 高 |
| 截单时间 | 配送 JSON 内 | tenant | 同上 | 高 |
| 配送时段 | 同上 | tenant | 同上 | 高 |
| dailyOrderLimit | 同上 | tenant | 同上 | 中 |
| bulkOrderThreshold | `ProductSku` 字段 | tenant（数据行已隔离） | ProductSku | 低 |
| bulkMinLeadDays | ProductSku | tenant | ProductSku | 低 |
| 低库存阈值 | `Material.safetyStockThreshold` | tenant | Material | 中 |
| 订单自动关闭时间 | 代码常量 15min | tenant 可配置（后期） | `TenantSettings` | 低 |
| CRM 提醒过期 | 代码 1 天 | tenant | 常量或配置 | 低 |
| Banner | `banners` 表 | tenant | Banner | 高 |
| 推荐位 | `cms_recommendation_slots` | tenant | CmsRecommendationSlot | 高 |
| 首页场景入口 | `cms_home_scene_entries` | tenant | CmsHomeSceneEntry | 高 |
| 小程序品牌信息 | 硬编码 / 42_mp config | tenant | `TenantBranding` JSON | 中 |
| 客服电话 | 未集中配置 | tenant | TenantSettings | 低 |
| 售后说明 | 商品/营销文案 | tenant | CMS | 低 |
| OSS objectKey prefix | env `ALIYUN_OSS_OBJECT_PREFIX` | tenant 段 | `tenants/{tenantId}/...` | 高 |
| 微信小程序 appId | env 全局 | tenant（方案 B）或平台（方案 A） | `TenantWechatConfig` | 高 |
| 微信支付 mchId | 未实现 | tenant | `PaymentProviderConfig` | 高 |
| 订阅消息模板 | 未实现 | tenant | `TenantNotificationTemplate` | 中 |
| 短信配置 | 未实现 | tenant | `TenantSmsConfig` | 中 |
| 套餐 / 功能开关 | 未实现 | platform → tenant | `TenantPlan` / `FeatureFlag` | 中 |
| 全局公告 / 弹窗 | `AppConfig` GLOBAL_NOTICE / HOME_POPUP | tenant | AppConfig | 高 |
| FREE_SHIPPING_THRESHOLD | 代码常量 99 | tenant | TenantSettings | 中 |

---

## 9. OSS / Asset Storage Audit

### 9.1 当前 objectKey 规则

- 生成：`src/lib/storage/object-key.ts` → `buildObjectKey(module, ext)`
- 格式：`{objectPrefix}/{module-path}/{YYYY}/{MM}/{uuid}.ext`
- 默认 prefix：`universe42`（env `ALIYUN_OSS_OBJECT_PREFIX`）
- **不含 tenant / store**
- 数据库：各表 `imageUrl` 存 **objectKey**；展示时 `toPublicImageUrl()`
- Legacy：`ENABLE_LEGACY_UPLOADS=false`；`/uploads` 与 localhost 已阻断

### 9.2 多租户目标路径

```text
tenants/{tenantId}/products/spu/YYYY/MM/{uuid}.webp
tenants/{tenantId}/products/sku/YYYY/MM/{uuid}.webp
tenants/{tenantId}/banners/YYYY/MM/{uuid}.webp
tenants/{tenantId}/recommendations/YYYY/MM/{uuid}.webp
tenants/{tenantId}/home-scenes/YYYY/MM/{uuid}.webp
tenants/{tenantId}/cms/YYYY/MM/{uuid}.webp
```

### 9.3 建议

| 问题 | 建议 |
|---|---|
| 是否立即迁移现有 objectKey | **否** — 默认 tenant 保留 `universe42/...`；新租户用新前缀 |
| 是否新增 tenant-aware 生成 | **是** — `buildObjectKey(module, ext, { tenantId })`（Sprint F） |
| 历史图片 | 只读兼容；`toPublicImageUrl` 不区分；删除时按 objectKey 原样 |
| 是否需要 UploadAsset 表 | **可选** — 利于审计与孤儿清理；非 MVP 必须 |
| OSS 删除 | **延后** — 软删业务记录后再异步清理 |
| CDN | 单 CDN 域名可服务多 prefix；注意缓存 key 含完整 path |

---

## 10. Mini Program Multi-Store Audit

### 10.1 强单店假设检查

| 检查项 | 现状 | 风险 |
|---|---|---|
| 首页默认唯一店铺 | 是 — 无 store 参数 | 高 |
| 商品列表无 store 参数 | 是 | 高 |
| 商品详情无 store 参数 | 是 | 高 |
| 购物车全局 storage | 是 — `cart` 无 tenant 维度 | 高 |
| 订单按用户全局 | 是 — `Order` 无 tenantId | 高 |
| 分享链接无 storeSlug | 是 | 中 |
| 小程序配置全局 | `42_mp/miniprogram/config/index.ts` 硬编码 baseUrl | 高 |
| API base URL 全局 | `apiMiniprogramBaseUrl` 单值 | 高 |
| appId 单一 | 服务端 env 单套 | 高（方案 B） |
| 支付配置单一 | 未实现 | 高 |

### 10.2 方案比较

| | 方案 A：平台单小程序 | 方案 B：每店独立小程序 |
|---|---|---|
| 进店 | `scene=storeSlug` / 二维码参数 | 各自 appId |
| 购物车 | storage key 加 `tenantId` 前缀 | 天然隔离 |
| 支付 | 平台收款或子商户 | 各店 mchId |
| 运维 | **低** | 高（N 套审核/发布） |
| 与当前代码契合度 | **高** — 主要改 API + storage | 需每租户 appId 配置 |

**推荐：优先方案 A**。连锁独立品牌强需求时再支持方案 B（`Tenant.wechatMiniAppId`）。

---

## 11. Payment Multi-Tenant Readiness

### 11.1 模式对比

| | 模式 A：平台统一收款 | 模式 B：商户自收款 |
|---|---|---|
| mchId | 平台一个 | 每 tenant 一个 |
| 资金 | 平台账户；需分账 | 直达花店 |
| 回调 | 靠 `orderNo` / attach 字段 | 靠子商户号 / appId |
| 合规 | 需服务商资质 | 各店自行申请 |
| 当前契合 | 占位 callback 易扩展 | 花店 SaaS 常见 |

**推荐**：B2B 花店 SaaS 长期 **模式 B** 更自然；平台抽佣可用分账或订阅费。

### 11.2 未来模型 `PaymentProviderConfig`

```prisma
// 示意，本轮未实现
model PaymentProviderConfig {
  id            String   @id @default(cuid())
  tenantId      String
  provider      String   // WECHAT_PAY
  appId         String
  mchId         String
  certSecretRef String?  // 密钥引用，不落库明文
  callbackSecret String?
  status        String
  @@unique([tenantId, provider])
}
```

### 11.3 要点

1. **不能放全局 env**：`mchId`、API 证书、回调密钥、各店 appId（方案 B）
2. **回调识别 tenant**：`orderNo` 前缀 / `PaymentProviderConfig.mchId` 反查 / attach JSON
3. **订单号**：含 `tenantSlug` 或并行索引 `Order.tenantId`
4. **退款**：按 `Order.tenantId` 加载对应 `PaymentProviderConfig`
5. **最小预留**：`Order.tenantId` + 空表 / migration 占位；callback 路由解析 tenant

---

## 12. Cron / Worker Audit

| 任务 | 当前实现 | SaaS 风险 | 建议多租户改造 |
|---|---|---|---|
| `syncPhysicalStockToVirtual` | 全局扫描 SKU | 跨租户写 stock | `for (tenant of tenants)` 或 `where: { tenantId }` |
| `closeExpiredPendingOrders` | 全局 `PENDING_PAYMENT` take 200 | **关闭他店订单** | 每租户独立查询 + 索引 `(tenantId, status, createdAt)` |
| CRM 提醒过期 | 展示层 `isSystemReminderExpired` | 低（无 cron 发送） | 未来 cron 加 tenantId |
| 低库存检查 | 报表/数据质量只读 | 误报他店 | tenant 过滤 |
| 每日订单统计 | 报表 API 实时聚合 | 跨租户汇总 | API 层 tenantId |
| 数据质量扫描 | `data-quality.ts` 全库 | 泄漏他店问题详情 | 按 tenant 运行 |
| 未来账单生成 | 未实现 | — | `tenantId` + 幂等键 |
| 订阅消息 / 短信 | 未实现 | — | 每租户模板与配额 |

### 12.1 分布式与锁

- **当前**：单 `flower-cron-worker` 实例，无 Redis
- **多实例风险**：重复执行库存投影 / 重复关闭订单（幂等部分可缓解）
- **建议**：引入 Redis `SET NX` 锁：`cron:inventory-sync:{tenantId}`；或每租户消息队列

### 12.2 CronJobLog

- **当前不存在**；建议新增 `CronJobLog(tenantId?, jobName, status, startedAt, metadata)` 便于 SaaS 运维。

---

## 13. AuditLog / Compliance Audit

### 13.1 当前缺口

| 要求 | 现状 |
|---|---|
| 业务日志有 tenantId | ❌ 无 |
| 平台管理员跨租户操作记 actor role | ⚠️ 有 `actorRole` 字符串，无 platform/tenant  scope |
| resourceType / resourceId | ✅ `entityType` / `entityId` |
| 日志不泄漏他店数据 | ❌ `listAuditLogs` 无 tenant 过滤 |
| 店铺只看本店 | ❌ |
| 平台按权限跨店查看 | ❌ |

### 13.2 建议模型扩展

```text
AuditLog
  + tenantId String?   // null 表示平台级操作
  + actorScope TENANT | PLATFORM
  + resourceType, resourceId（已有）
```

平台管理员跨租户操作：`tenantId` = 目标租户，`actorScope` = PLATFORM，`metadata.impersonation` = true。

---

## 14. Deployment / Infrastructure Audit

### 14.1 检查清单

| 项 | 现状 | SaaS 备注 |
|---|---|---|
| web 无状态 | ✅ Next standalone，会话 JWT | 可横向扩展 |
| 图片不依赖本地 uploads | ✅ OSS | 多租户共享 bucket 不同 prefix |
| PostgreSQL 在 Docker 中 | ✅ `postgres_data` volume | 规模化 → **阿里云 RDS** |
| Redis | ❌ 缺失 | 会话/锁/队列需要 |
| cron-worker 独立 | ✅ `flower-cron-worker` | 需租户分片 |
| Docker 日志轮转 | ✅ json-file 10m×3 | 够用 |
| 数据库备份 | ❌ 无自动化脚本 | 需 RDS 备份或 pg_dump cron |
| healthcheck | ✅ web `/login`, db `pg_isready` | 够用 |
| 监控 / 告警 | ❌ 仅 system-health 页面 | 需 APM / 磁盘告警 |
| 多 web 实例 | ⚠️ 可行但未验证 | 需 SLB |
| migration 重复执行 | ⚠️ 每实例 `migrate deploy` | 单实例 migrate 或 init container |
| env 租户化配置 | ❌ 微信/OSS 全局 | 逐步迁入 DB |

### 14.2 单机部署风险

- 磁盘满导致 DB 不可用（Sprint 15 已记录）
- 单点 PostgreSQL
- cron 与 web 抢资源
- 无备份恢复演练

### 14.3 SaaS 早期部署建议

1. **Phase 1–4**：仍可单机 Compose + 默认 tenant
2. **Phase 5+**：RDS + 单 cron 实例 + Redis（锁）
3. **规模化**：SLB + 多 web + 对象存储 CDN + 只读副本（报表）

---

## 15. Migration Roadmap

| Phase | 内容 | 风险 | 回滚 |
|---|---|---|---|
| **1** | 新增 `Tenant` / `TenantMember` 模型 | 低 | 删除新表 |
| **2** | 创建默认 tenant（universe42） | 低 | 删 tenant 行 |
| **3** | 业务表加 **nullable** `tenantId` | 中 | migration down |
| **4** | 回填全部现有数据 → 默认 tenant | **高** — 漏表导致 NULL | 脚本可重跑；校验报告 |
| **5** | Service/API 查询加 `tenantId`（中间件注入） | **高** — 漏网跨租户 | feature flag 强制过滤 |
| **6** | 校验无 NULL `tenantId` | 中 | — |
| **7** | `tenantId` NOT NULL | 中 | 需 Phase 6 通过 |
| **8** | unique 约束改 tenant-scoped | **高** — 需停写或维护窗口 | 保留旧索引直到验证 |
| **9** | TenantMember + 店铺切换 UI | 中 | session 回退单 tenant |
| **10** | 小程序多店（storeSlug + storage 隔离） | **高** | 小程序版本回退 |

---

## 16. Risk Register

| Risk | Severity | Area | Description | Recommendation |
|---|---|---|---|---|
| Prisma 查询缺少 tenantId | **Critical** | Data | 所有业务 service 全局 `findMany` | Phase 5 统一 `tenantScope()` 包装 Prisma |
| unique 约束全局唯一 | **High** | Schema | skuCode、slot.key、openId 等 | Phase 8 分批 migration |
| 用户角色无 tenant 边界 | **High** | Auth | StaffUser 全局 Role | 引入 TenantMember |
| 小程序订单无 store 归属 | **Critical** | Order | Order 无 tenantId | Phase 3–5 订单链路优先 |
| 支付配置全局化 | **High** | Payment | env 单套微信 | PaymentProviderConfig |
| OSS objectKey 无 tenant 前缀 | **Medium** | Storage | 共用 universe42 prefix | 新租户新路径；旧数据兼容 |
| cron-worker 全局执行 | **High** | Worker | 可关闭/同步他店订单 | 按 tenant 分片 + 锁 |
| AuditLog 缺 tenantId | **High** | Compliance | 日志跨店可见 | 写入时带 tenantId |
| RDS / Redis 缺失 | **Medium** | Infra | 单机 PG、无分布式锁 | SaaS 正式运营前补齐 |
| 多实例 migration 风险 | **Medium** | Deploy | 每 web migrate deploy | 仅一实例执行 migration |
| 数据迁移回填风险 | **High** | Migration | 漏回填导致 NULL tenantId | 自动化校验 + 报表 |
| 平台管理员越权风险 | **High** | Auth | IT_ADMIN 无 tenant 审计 | PlatformAdmin + AuditLog scope |
| 购物车本地 storage 无店铺维度 | **High** | Mini Program | 换店购物车串单 | `cart:{tenantId}` key |
| Customer 全局 miniProgramUserId | **High** | CRM | 一用户只能绑一个 Customer | 改 tenant 级 unique |
| 报表跨租户聚合 | **High** | Reports | business-report 全库 | API 强制 tenantId |

---

## 17. Recommended Sprint Plan

### Sprint A：Tenant 基础模型与默认租户

- **目标**：`Tenant` + `TenantMember` 表；seed 默认租户 `universe42`
- **模块**：`prisma/schema.prisma`, `prisma/seed.ts`
- **风险**：低
- **验收**：默认租户存在；现有 StaffUser 有 TenantMember；业务无行为变化

### Sprint B：业务表 tenantId nullable + 默认数据回填

- **目标**：核心表加 `tenantId` nullable；脚本回填
- **模块**：schema migration, `scripts/backfill-tenant-id.ts`
- **风险**：回填遗漏
- **验收**：`SELECT COUNT(*) WHERE tenant_id IS NULL = 0`（核心表）

### Sprint C：Auth / TenantMember / 当前店铺上下文

- **目标**：session `currentTenantId`；`requireTenant()` 中间件
- **模块**：`auth.config.ts`, `api-auth.ts`, 店铺切换 UI
- **风险**：中
- **验收**：后台 API 拒绝无 tenant 上下文（feature flag 下）

### Sprint D：Service / API tenantId 查询隔离

- **目标**：订单 / 商品 / WMS / CRM / 报表全部过滤
- **模块**：`src/services/*`, `src/app/api/*`
- **风险**：高 — 漏改
- **验收**：smoke + 双 tenant 集成测试无交叉读写

### Sprint E：unique 约束租户化

- **目标**：skuCode、slot.key、AppConfig 等
- **模块**：schema migration
- **风险**：高 — 需维护窗口
- **验收**：两租户可创建相同 slot key / sku code

### Sprint F：OSS objectKey tenant prefix

- **目标**：`buildObjectKey({ tenantId })`；新上传走 `tenants/{id}/...`
- **模块**：`src/lib/storage/object-key.ts`
- **风险**：低
- **验收**：test:storage 覆盖；旧 key 仍可展示

### Sprint G：小程序多店入口与 storeSlug

- **目标**：scene / query 解析 tenant；storage 隔离
- **模块**：`42_mp/*`, miniprogram API 中间件
- **风险**：高
- **验收**：两 storeSlug 商品/订单隔离

### Sprint H：租户级设置

- **目标**：配送、公告、弹窗、品牌信息 tenant 化
- **模块**：`AppConfig`, CMS 营销页
- **风险**：中
- **验收**：两租户配送设置互不影响

### Sprint I：支付配置租户化

- **目标**：`PaymentProviderConfig`；callback 路由
- **风险**：高
- **验收**：mock 回调可按 tenant 配置（仍可不接正式微信支付）

### Sprint J：平台管理后台与套餐

- **目标**：PlatformAdmin、租户 CRUD、套餐 / 功能开关
- **风险**：中
- **验收**：平台可创建租户；租户试用/停用

---

## 18. Open Questions

1. **FlowerWiki 平台共享 vs 租户隔离**：是否允许花材母表跨店复用？
2. **一微信用户多店 CRM**：同一 openId 在不同花店是否独立 Customer？（建议 **是**）
3. **方案 A 小程序名称**：平台统一品牌 vs 白标；是否需租户自定义 tabBar 文案？
4. **订单号全局唯一 vs 租户内唯一**：支付服务商是否要求全局唯一？（当前倾向 **全局 + 前缀**）
5. **OSS 单 bucket vs 多 bucket**：合规与成本；当前单 bucket 多 prefix 是否足够？
6. **连锁多门店**：何时引入 `storeId`（仓内调拨）？
7. **平台抽佣**：订阅费 vs 支付分账 vs 两者兼有？
8. **数据导出 / 租户离店**：GDPR 式删除与备份策略？
9. **试用租户与 smoke 数据**：`SMOKE_TEST_*` 是否挂独立 tenant？
10. **migration 执行策略**：是否改为 K8s Job / 独立 migrate 容器？

---

## Appendix A — 文档与代码引用

| 资源 | 路径 |
|---|---|
| 架构说明 | `flower-wms-system/ARCHITECTURE.md` |
| 业务规则 | `flower-wms-system/docs/business-rules.md` |
| Prisma schema | `flower-wms-system/prisma/schema.prisma` |
| RBAC | `flower-wms-system/src/lib/rbac.ts` |
| API 鉴权 | `flower-wms-system/src/lib/api-auth.ts` |
| OSS objectKey | `flower-wms-system/src/lib/storage/object-key.ts` |
| Cron worker | `flower-wms-system/scripts/cron-inventory-daemon.ts` |
| 小程序配置 | `42_mp/miniprogram/config/index.ts` |
| Docker Compose | `docker-compose.yml` |

---

*本文档由 Sprint 20 审计生成；后续改造以各 Sprint 验收标准为准。*
