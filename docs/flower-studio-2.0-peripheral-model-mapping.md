# Flower Studio 2.0 外围模型处理清单

状态：基于现有 `flower-wms-system/prisma/schema.prisma` 的静态盘点。目标是确定 2.0 Schema 的保留范围；当前没有真实生产数据迁移要求。

| 现有模型 | 2.0 处理 | 归属与关键调整 |
|---|---|---|
| `Tenant`, `TenantMember`, `StaffUser` | 保留概念，重建关系 | StaffUser 是全局登录身份；TenantMember 承载租户职责；另加 StoreMember 表达门店职责。当前默认租户和门店。 |
| `StaffAuditLog`, `AuditLog` | 合并为统一审计能力 | 保留登录安全审计与业务操作审计类型；业务审计必须有 tenantId，门店操作带 storeId；只追加。 |
| `User` | 保留为小程序登录身份 | 微信 OpenID 属登录身份；与 Customer 可关联。不可要求后台人工订单必须有小程序 User。 |
| `Customer`, `Recipient`, `CustomerRecipientRelation` | 保留并整理 | 归 Tenant；订单可选关联客户、收花人，但必须保存下单时的联系人和地址快照。人工订单可快速创建客户。 |
| `GiftOccasion`, `CustomerReminder` | 保留 | 归 Tenant，提醒属于运营待办；失败不能阻断订单履约。订单关联可选。 |
| `ProductCategory`, `ProductCategoryRelation` | 保留概念 | 分类归 Tenant；关系连接 2.0 Product。商品可多分类。 |
| `MaterialCategory`, `MaterialCategoryRelation` | 保留概念 | 分类归 Tenant；关系连接统一 Material。 |
| `Banner`, `CmsRecommendationSlot`, `CmsRecommendationItem`, `CmsHomeSceneEntry` | 保留外围 CMS | 归 Tenant；推荐项指向 2.0 Product 或 SKU。售罄展示规则由 SKU 可售量计算，不使用旧 `ProductSku.stock`。 |
| `AppConfig` | 拆分作用域 | 平台配置与 Tenant/Store 业务设置分开；配送时段、容量、损耗复核阈值属于 Store 设置。 |
| `FlowerWiki` | 保留知识资料，不作库存主档 | 养护、花语等知识可附着到 Material；采购、配方、库存只引用 Material。 |
| `MasterPart`, 旧 `Material` | 由统一 Material 取代 | 2.0 物料含鲜花、包材和耗材，规格、颜色、等级与基础单位明确。 |
| `PackagingKit` | 作为可选包装方案重建 | 包装物料进入配方；整卷耗材按门店控制和单件预计成本处理。 |
| `StockLog`, `StockLossRecord` | 由 InventoryTransaction、LossRecord 取代 | 流水只追加；损耗保存批次、位置、原因、订单关联可选及复核。 |
| 旧 `Order`, `OrderItem`, `OrderCostSnapshot` | 按 2.0 核心模型重建 | 多入口订单、状态分维度、定制项、支付/退款/履约独立、历史快照保留。 |

## 2.0 Schema 需要补齐的外围关系

1. 身份：`StaffUser`、`TenantMember`、`StoreMember`、`MiniProgramIdentity`。同一员工可有多种职责；业务记录的操作人引用员工 ID。
2. 客户：`Customer`、`Recipient`、`CustomerRecipientRelation`、`GiftOccasion`、`CustomerReminder`。均带明确租户归属；订单保存购买人、收花人、地址、贺卡等快照。
3. 盘点损耗：`Stocktake`、`StocktakeLine`、`LossRecord`。门店与库位归属明确；盘点调整与损耗都产生统一库存流水。待核实批次的异常不直接扣库。
4. 内容运营：`ProductCategory`、`MaterialCategory`、`Banner`、`RecommendationSlot`、`RecommendationItem`、`HomeSceneEntry`。先保留业务功能，字段可在页面迁移时按 2.0 商品模型映射。
5. 配置审计：`StoreSettings`、`AuditEvent`。门店配送与产能设置不放全局 `AppConfig`；审计事件只追加。

## 迁移与依赖顺序

先建立身份、客户、盘点损耗和门店设置，再接订单、库存与制作服务；CMS 内容模型可以在商品页面适配阶段接入。由于旧系统没有正式上线，目标是干净的初始结构，不保留双写或旧表兼容。执行任何数据库重建前仍需核实连接目标和测试数据是否可丢弃。

当前独立 `schema.v2.draft.prisma` 已补入身份、客户、盘点损耗、门店设置与审计骨架；内容运营的分类、Banner、推荐位和场景入口尚未补入。其 `prisma validate` 通过不表示 2.0 全量 Schema 已可替换运行中的数据库；跨租户复合归属约束、业务检查约束和内容模型仍需落地。仓库中其他未跟踪目录不属于此次设计工作。
