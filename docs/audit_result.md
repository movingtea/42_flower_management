# Code Review Audit Result

> 日期：2026-06-18  
> 范围：`codex-code-review-brief.md` 指定的只读代码审计  
> 模式：Read-only review；未修改业务代码、未提交、未建分支、未创建 PR

## 1. Executive Summary

整体风险级别：高。

当前不建议直接进入生产发布。主要阻塞点是后台 API 权限缺口和退款库存回库语义风险。OSS 上传基础、Drawer 迁移、Tenant / TenantMember 身份地基整体可用，但 Sprint 22 tenantId 迁移前必须先收敛安全、库存和部署配置问题。

Top 5 风险：

1. 多个 `/api/admin/*` 路由只依赖登录中间件，没有调用 `requirePermission`。
2. 退款接口即使 `rollbackStock=false` 也会自动回补物理批次库存，不符合产品边界。
3. 小程序商品 / 分类 DTO 仍可能返回 DB objectKey，依赖客户端兜底转换。
4. 生产 `.env.production.example` 缺 OSS / 上传限制关键配置示例。
5. Sprint 22 迁移前若提前加入 tenant filter，会在 backfill 完成前导致业务数据不可见。

## 2. Critical Issues

### 2.1 后台 API 权限缺口

严重级别：Critical

涉及文件：

- `flower-wms-system/src/app/api/admin/products/route.ts`
- `flower-wms-system/src/app/api/admin/products/[id]/route.ts`
- `flower-wms-system/src/app/api/admin/stocktake/route.ts`
- `flower-wms-system/src/app/api/admin/app-config/route.ts`
- `flower-wms-system/src/app/api/admin/product-categories/route.ts`
- `flower-wms-system/src/app/api/admin/product-categories/[id]/route.ts`
- `flower-wms-system/src/app/api/admin/wms/material-categories/[id]/route.ts`

证据：

- 这些路由执行商品创建 / 更新 / 删除、盘点、AppConfig 写入、分类更新 / 删除等业务写操作。
- 路由内未调用 `requirePermission`。
- Middleware 只保证登录和部分路径拦截，不能替代 route handler 内的权限校验。

影响：

已登录但权限较低的角色可能直接请求 API 绕过 UI 限制，造成商品、库存、CMS 配置或分类数据被越权修改。

建议：

- 所有后台业务 API 显式调用 `requirePermission`。
- 写路由按业务归属使用 `cms:write`、`wms:write`、`orders:write`、`business:write`。
- 读路由按业务归属使用 `cms:read`、`wms:read`、`business:read`。
- 补 `smoke:permission-matrix` 覆盖 legacy / deprecated 路由。

### 2.2 退款库存回库语义不安全

严重级别：Critical

涉及文件：

- `flower-wms-system/src/services/order-lifecycle.ts`
- `flower-wms-system/src/app/api/admin/orders/[id]/refund/route.ts`

证据：

- `refundPaidOrder` 无条件执行 `restorePhysicalStockFromSaleOutInTx`。
- `rollbackStock` 只控制虚拟 SKU stock 是否回补。
- API 文案显示 `rollbackStock=false` 时仍然“物理批次已回库”。

产品边界确认：

- 退款取消时，需要显式选择哪些花材回库。
- 不能默认把全部 SALE_OUT 花材自动回补。

影响：

如果退款不等于实物 / 花材可回库，会导致物理库存虚增，影响 FIFO、采购建议、成本和报表。

建议：

- 将退款和物理回库拆成明确动作。
- 回库时要求运营显式选择花材 / 批次 / 数量。
- 建议 API 形态区分：
  - 仅退款取消，不回库。
  - 退款并部分花材回库。
  - 退款并虚拟 SKU 修正。
- 增加退款回库测试，覆盖重复回库、部分回库、无回库。

## 3. High Priority Issues

### 3.1 小程序商品 DTO 未统一在服务端转 OSS public URL

严重级别：High

涉及文件：

- `flower-wms-system/src/lib/wechat-product-mapper.ts`
- `flower-wms-system/src/services/miniprogram-products.ts`
- `flower-wms-system/src/app/api/miniprogram/products/[id]/route.ts`

证据：

- `sku.imageUrl`、`imageUrl`、`mainImageUrl`、`images` 从 DB 映射后直接返回。
- 当前小程序客户端通过 `normalizeImageUrl` 兜底转换 objectKey。

影响：

当前客户端多数场景可正常显示，但 API 合约不满足“Mini Program business images must use OSS public URL”。未来缓存、分享、其他客户端或调试工具可能拿到 objectKey。

建议：

- 服务端 mapper 对所有业务图片字段统一调用 `toPublicImageUrl` / `toPublicImageUrlList`。
- 小程序客户端保留 `normalizeImageUrl` 作为防御性兜底。

### 3.2 小程序分类 / 首页分类图片返回 stored value

严重级别：High

涉及文件：

- `flower-wms-system/src/lib/product-category.server.ts`
- `flower-wms-system/src/app/api/miniprogram/product-categories/route.ts`
- `flower-wms-system/src/app/api/miniprogram/homepage/route.ts`

影响：

分类图片如写入 objectKey，小程序 API 可能返回 stored value 而不是完整 OSS URL。

建议：

- 小程序 DTO 输出层统一转换分类图片为 public URL。

### 3.3 生产 env 示例缺 OSS / 上传限制配置

严重级别：High

涉及文件：

- `.env.production.example`

证据：

- 示例只包含 DB/Auth/WeChat/DeepSeek。
- 缺少 `ENABLE_OSS_UPLOAD`、`ALIYUN_OSS_*`、`UPLOAD_MAX_SIZE_MB`、`NEXT_PUBLIC_OSS_PUBLIC_BASE_URL`。

影响：

部署人员容易漏配，导致上传失败、CMS 预览异常或 objectKey 解析不一致。

建议：

- 补完整 OSS env 示例。
- 明确 AccessKey 不得使用 `NEXT_PUBLIC_`。
- 明确业务上传限制为 3MB，Nginx `client_max_body_size` 为 5m。

### 3.4 Docker entrypoint 自动 migrate 不适合未来多 web 实例

严重级别：High

涉及文件：

- `flower-wms-system/docker-entrypoint.sh`

证据：

- web entrypoint 默认执行 `npx prisma migrate deploy`。

影响：

未来多 web 实例部署时可能并发执行 migration。

建议：

- Sprint 22 前改为单独 migration job。
- web 默认设置 `SKIP_DB_MIGRATE=true`。
- 发布流程中加入备份、migration、verification 三段式命令。

## 4. Medium Priority Issues

### 4.1 Mini Program request 未设置显式 timeout

涉及文件：

- `42_mp/miniprogram/utils/request.ts`

建议：

- 在 `wx.request` 加显式 timeout。
- fail 分支保持 reject，避免 Promise 长时间悬挂。

### 4.2 首页启动请求建议改为 allSettled

涉及文件：

- `42_mp/miniprogram/pages/index/index.ts`

证据：

- 首页使用 `Promise.all`。
- 推荐位、场景入口已有局部 catch，但首页配置 / 商品列表失败时会影响后续 `applyCategoryFilter`。

建议：

- 改为 `Promise.allSettled` 或分别兜底。
- 商品失败时显示空态，首页配置失败时使用本地默认配置。

### 4.3 CMS 商品分类图片仍是手填 URL

涉及文件：

- `flower-wms-system/src/app/cms/product-categories/ProductCategoryManager.tsx`

建议：

- 接入 CMS 图片上传。
- 使用 `CmsImagePreview` 展示预览。
- 保存前继续使用 `normalizeStoredImagePath`。

## 5. Low Priority / Cleanup

- 多个已迁移为 Drawer 的组件命名仍包含 `Modal`，例如 `OrderDetailModal`、`WikiMaterialDetailModal`。可后续重命名，不影响当前行为。
- `Dockerfile` build arg 默认 `NEXT_PUBLIC_ASSET_BASE_URL=http://localhost:3000`，生产构建示例已有覆盖参数；建议部署文档再强调 CI 必须传生产值。

## 6. No-Issue Confirmations

已确认可接受的区域：

- OSS 上传主路由设置 `runtime = "nodejs"`。
- 上传主路由使用 `requirePermission("cms:write")`。
- 上传校验拒绝 SVG、text、PDF、zip 等危险 MIME。
- 业务上传限制默认 3MB。
- Nginx 示例 `client_max_body_size 5m` 高于业务限制。
- Drawer 组件具备 mask、右侧面板、固定 header/footer、body 独立滚动、移动端 `w-full`。
- Tenant / TenantMember 已作为 Sprint 21 身份地基落库。
- Sprint 21 未给业务表加 `tenantId`，符合红线。
- 下单虚拟库存扣减使用 `updateMany` + `stock >= quantity`，避免先查后改超卖。
- Docker 清理脚本明确不删除 volumes / postgres_data。

## 7. Sprint 22 Design Boundaries

以下为产品 / 架构决策边界，后续实现以此为准。

### 7.1 退款取消与回库

决策：

- 退款取消时，需要显式选择哪些花材回库。
- 不允许默认自动回补全部物理批次。

设计含义：

- `refundPaidOrder` 不能无条件执行物理回库。
- 回库应记录花材、批次、数量、操作人、原因。
- 重复回库必须被阻止。
- 部分回库需要保留完整审计。

### 7.2 租户模型

决策：

- 一租户 = 一花店。
- Sprint 22 只引入 `tenantId`，暂不引入 `storeId`。

设计含义：

- 核心业务表以 `tenantId` 作为唯一租户隔离维度。
- 后续连锁多门店能力不进入 Sprint 22。

### 7.3 订单号

决策：

- `Order.orderNo` 需要平台全局唯一。

设计含义：

- `orderNo` 保持全局唯一约束。
- 建议未来格式包含 tenant slug，例如 `ORD-{tenantSlug}-{yyyyMMdd}-{random}`。
- 微信支付回调仍可通过全局 `orderNo` 定位订单。

### 7.4 FlowerWiki

决策：

- `FlowerWiki` 暂时每租户独立。

设计含义：

- `FlowerWiki` 需要纳入 tenantId 迁移范围。
- `Material.wikiId`、`RecipeLine.flowerWikiId` 必须校验同租户一致。
- 暂不采用“平台共享 FlowerWiki + 租户成本覆盖”方案。

## 8. Sprint 22 Readiness Assessment

结论：

- 可以开始 Sprint 22 迁移设计。
- 不建议在修复 Critical 前执行生产 migration。

Sprint 22 第一阶段目标：

- 给核心业务表新增 nullable `tenantId`。
- 对现有数据 backfill 到默认租户 `universe42`。
- 不改变业务查询过滤。
- 不修改 unique constraint。
- 不把 `tenantId` 改成 NOT NULL。

建议新增 nullable `tenantId` 的表：

- `ProductSpu`
- `ProductSku`
- `ProductCategory`
- `ProductCategoryRelation`
- `Order`
- `OrderItem`
- `OrderCostSnapshot`
- `Customer`
- `Recipient`
- `CustomerRecipientRelation`
- `GiftOccasion`
- `CustomerReminder`
- `Supplier`
- `Material`
- `MaterialCategory`
- `Batch`
- `StockLog`
- `StockLossRecord`
- `Recipe`
- `RecipeLine`
- `PurchaseOrder`
- `PurchaseOrderLine`
- `Banner`
- `CmsRecommendationSlot`
- `CmsRecommendationItem`
- `CmsHomeSceneEntry`
- `AppConfig`
- `AuditLog`
- `FlowerWiki`
- `PackagingKit`

暂不应修改的 unique 约束：

- `Order.orderNo`：保持平台全局唯一。
- `StaffUser.username`：保持平台全局唯一。
- `OrderCostSnapshot.orderId`：保持一订单一快照。
- 其他现有 unique 不在 nullable tenantId 第一阶段调整，避免迁移风险叠加。

必须保持幂等的脚本：

- 默认租户 seed。
- TenantMember backfill。
- 业务表 tenantId backfill。
- Sprint 22 verification。

禁止事项：

- backfill 完成前不要给服务查询加 tenant filter。
- 不要在同一批 PR 中混入 UI / 图片 / 退款逻辑重构。
- 不要把 nullable tenantId 与 unique constraint 范围变更混在同一次 migration。

## 9. Proposed Pre-Deployment Checklist

部署前：

- 完成 DB 备份。
- 确认 `tenants.slug = universe42` 存在。
- 确认所有 StaffUser 均有默认 TenantMember。
- 在 staging 执行 nullable tenantId migration。
- 执行业务表 backfill。
- 执行 verification，确认目标表 `tenantId IS NULL = 0`。
- 执行 lint / build / Prisma validate。
- 执行权限矩阵 smoke。
- 执行订单 / FIFO / 退款相关测试。
- 执行图片 URL smoke。
- 确认 Nginx `client_max_body_size 5m`。
- 确认 `UPLOAD_MAX_SIZE_MB=3`。
- 确认 OSS env 完整且 AccessKey 未暴露到 `NEXT_PUBLIC_*`。

发布后：

- 检查系统健康页。
- 检查 cron worker 日志。
- 抽查商品、订单、库存、CRM、CMS 配置。
- 抽查小程序图片 URL 是否为 `https://oss.universe42.studio/...`。
- 抽查后台 IT_ADMIN 无法访问业务数据。

## 10. Suggested Fix Plan

Batch A：权限修复

- 给缺失 `requirePermission` 的后台 API 补权限。
- 补 permission smoke。
- 不混入业务逻辑变化。

Batch B：退款 / 回库修复

- 拆分退款取消与物理花材回库。
- 支持显式选择花材 / 批次 / 数量。
- 补重复回库、部分回库、无回库测试。

Batch C：图片 DTO 修复

- 小程序 API 服务端统一输出 OSS public URL。
- CMS 商品分类图片接上传 + 预览。
- 保留客户端防御性 normalize。

Batch D：部署配置修复

- 补 `.env.production.example` OSS 配置。
- 补 README / Nginx 413 troubleshooting。
- 规划 migration job，避免多 web 自动 migrate。

Batch E：Sprint 22 nullable tenantId migration

- 单独 PR。
- 只做 nullable tenantId + backfill + verification。
- 不改 unique。
- 不加 tenant filter。

## 11. Commands to Run

建议在 `flower-wms-system` 下执行：

```bash
npm run lint
npm run build
npx prisma validate
npm run test:image-url
npm run test:client-image-preview
npm run test:miniprogram-image-url
npm run test:upload-validation
npm run test:storage
npm run test:permission-invariants
npm run smoke:permission-matrix
npm run test:tenant-foundation
npm run smoke:tenant-foundation
npm run test:order-invariants
npm run test:order-fifo
npm run test:order-expiry-lifecycle
npm run smoke:image-url
npm run smoke:oss-upload
```

备注：本次审计未执行测试命令，仅做只读文件审查。

## 12. Open Questions

当前阻塞 Sprint 22 设计的问题已由产品侧确认：

1. 退款取消时需要显式选择哪些花材回库。
2. 一租户 = 一花店。
3. 订单号需要平台全局唯一。
4. `FlowerWiki` 暂时每租户独立。

后续仍建议在 Sprint 22 实施前确认：

- 默认租户 `universe42` 的固定 slug 是否永不改名。
- 小程序多租户入口第一阶段是否固定默认租户，不暴露店铺切换。
- FlowerWiki 独立后，是否允许未来做平台模板复制到租户。
