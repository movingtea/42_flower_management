# Flower WMS System

Flower WMS System 是 Universe42 / 万物肆贰鲜花的鲜花行业 **WMS + CMS + 微信小程序 API** 平台。当前代码库覆盖花材母表、BOM 配方、批次库存、销售 FIFO、订单履约、订单真实毛利、产品级毛利预估、经营报表、供应商与采购单管理，以及小程序商品货架。

> 本文档基于当前代码静态审计更新。未在代码中实现的能力不会写成已实现。

## 1. 项目简介

系统分为三条业务边界：

- **WMS**：供应链、花材母表、原材料分类、配方、包装方案、采购、物理批次库存、报损、成本、履约和经营报表。
- **CMS**：商城 SPU/SKU、商品分类、轮播、营销配置、小程序货架与 SKU 毛利预估展示。
- **微信小程序 API**：用户登录、商品浏览、购物车、下单、mock 支付 / 回调占位、订单查询与确认收货。

核心业务能力：

- FlowerWiki 花材母表与简拼检索。
- Recipe / RecipeLine 标准 BOM，SKU 通过 `ProductSku.recipeId` 绑定配方。
- Material / Batch / StockLog 物理批次库存。
- 手工入库、指定批次报损、销售 FIFO、退款 `IN_CANCEL` 原路回库。
- OrderCostSnapshot 订单真实毛利。
- FlowerWiki 标准单支成本 + PackagingKit 标准包装成本的产品级毛利预估。
- 经营报表中心：销售汇总、趋势、商品毛利排行、低毛利订单、成本结构、花材使用、损耗、库存预警。
- Supplier / PurchaseOrder / PurchaseOrderLine 采购与供应商管理。
- 采购单到货入库联动 Batch + StockLog: `INBOUND`。

## 2. 技术栈

以 `package.json` 和当前代码为准：

| 层级 | 技术 |
|---|---|
| Web 框架 | Next.js 16 App Router |
| UI | React 19, Tailwind CSS 4 |
| ORM | Prisma 7, `@prisma/adapter-pg` |
| 数据库 | PostgreSQL |
| Auth | Auth.js / next-auth v5 beta，后台 StaffUser RBAC |
| 小程序 | 仓库根目录 `42_mp/` |
| 工具 | TypeScript, ESLint, tsx |
| 其他依赖 | `pinyin-pro`, `bcryptjs`, `lucide-react`, `pg`, `dotenv` |
| 部署 | Dockerfile + docker-compose，Next standalone，cron worker |

## 3. 仓库结构

```text
42_flower_management/
├── 42_mp/                         # 微信小程序客户端
├── Dockerfile                     # 根目录 Docker 构建文件
├── docker-compose.yml             # 生产 compose：nginx/web/db/cron-worker
└── flower-wms-system/
    ├── prisma/
    │   ├── schema.prisma          # Prisma 数据模型真理源
    │   └── migrations/            # 迁移 SQL
    ├── scripts/                   # seed、库存同步、smoke scripts
    ├── src/
    │   ├── app/                   # Next App Router 页面和 API
    │   ├── components/            # WMS/CMS/shared/ui 组件
    │   ├── generated/prisma/      # Prisma 生成物
    │   ├── lib/                   # RBAC、格式化、CMS/WMS helper
    │   ├── services/              # 领域服务和事务逻辑
    │   └── utils/                 # batch-no、skuGenerator 等
    ├── docker-entrypoint.sh       # 容器启动时 migrate deploy
    └── package.json
```

## 4. 核心模块

### WMS

- **花材母表**：`FlowerWiki`，含拉丁名、中文名、花艺角色、养护、简拼、标准单支成本字段。
- **原材料分类**：`MaterialCategory` / `MaterialCategoryRelation`，与商城商品分类解耦。
- **配方**：`Recipe` / `RecipeLine`，配方只写 BOM，不产生库存副作用。
- **包装方案**：`PackagingKit`，标准包装成本用于订单成本和产品预估；当前没有包装库存扣减。
- **物理库存**：`Material` / `Batch` / `StockLog`。
- **仓储日常**：手工入库、指定批次报损、批次流水线。
- **采购与供应商**：`Supplier`、`PurchaseOrder`、`PurchaseOrderLine`。
- **订单履约**：`/wms/orders` 看板，支付后 FIFO 扣物理批次。
- **经营报表**：`/wms/reports`。

### CMS

- `ProductSpu`：商城商品 SPU。
- `ProductSku`：SKU 款式、价格、虚拟可售库存、可选 `recipeId`。
- 商品分类：`ProductCategory` + `ProductCategoryRelation`。
- Banner：`Banner`。
- 营销配置：`AppConfig`。
- SKU 毛利预估：基于 SKU price、Recipe、FlowerWiki.standardUnitCost、PackagingKit.standardCost 实时计算；没有持久化 margin 字段。

### 微信小程序 API

**业务数据**（`/api/miniprogram/*`）：

- 商品：`/api/miniprogram/products`、`/api/miniprogram/products/[id]`、分类、首页、推荐位、场景入口
- 购物车：`/api/miniprogram/cart`
- 下单：`/api/miniprogram/orders/create`
- Mock 支付：`/api/miniprogram/orders/mock-pay`
- 订单：列表、取消、确认收货
- 收花人、用户资料、上传

**微信平台能力**（`/api/wechat/*`）：

- 登录：`/api/wechat/auth/login`、`/api/wechat/login`（重定向）
- 支付回调：`/api/wechat/orders/callback`（占位，非正式微信支付 SDK）

## 5. 成本与毛利体系

### 订单真实毛利

核心模型：`OrderCostSnapshot`。

真实花材成本来自历史库存流水：

```text
Order
  -> SALE_OUT stock_logs
  -> Batch.unitCost
  -> OrderCostSnapshot.flowerMaterialCost
```

成本来源：

- 花材成本：`SALE_OUT stock_logs.quantity × batch.unitCost`
- 包装成本：订单 SKU 绑定的 `Recipe -> PackagingKit.standardCost × order item quantity`
- 配送成本：`Order.deliveryCostActual`
- 平台费 / 花艺师人工 / 其他成本：字段存在于快照模型，但当前 `calculateOrderCostSnapshot` 中按 0 计入

毛利公式：

```text
totalCost = flowerMaterialCost + packagingCost + deliveryCostActual + platformFee + floristLaborCost + otherCost
grossProfit = paidAmount - totalCost
grossMargin = grossProfit / paidAmount
```

订单支付成功后 `markOrderPaidWithFifo` 会在同一事务中扣物理库存并生成 / 更新成本快照。配送实际成本更新后可通过订单成本 API 重算。

### 产品级毛利预估

产品预估链路与订单实际毛利分开：

```text
FlowerWiki.standardUnitCost
  -> RecipeLine.quantityNeeded
  -> Recipe + PackagingKit
  -> ProductSku.price
  -> estimated gross margin / suggested prices
```

相关字段：

- `FlowerWiki.standardUnitCost`
- `FlowerWiki.costUnit`
- `FlowerWiki.costUpdatedAt`
- `FlowerWiki.costNote`
- `PackagingKit.standardCost`

预估 warning 场景包括 SKU 未绑定配方、配方未绑定包装方案、花材缺少标准成本、SKU 价格缺失等。

### 经营报表

服务：`src/services/business-report.ts`。

当前报表：

- Sales summary
- Daily sales trend
- Product profit ranking
- Low margin orders
- Cost structure
- Material usage cost
- Wastage
- Inventory alerts
- Missing OrderCostSnapshot backfill

经营报表优先使用历史 `OrderCostSnapshot`，避免用当前标准成本重算历史毛利。

## 6. 采购与供应商体系

Sprint 4 新增：

- `Supplier`
- `PurchaseOrder`
- `PurchaseOrderLine`

采购单号格式：

```text
PO-YYYYMMDD-XXX
```

采购成本字段：

- 商品金额：`lineAmount = purchaseQuantity × unitPrice`
- 总支数：`totalStems = purchaseQuantity × stemsPerUnit`
- 附加费用：运费、包装费、其他费用
- `BY_AMOUNT`：按明细金额占比分摊附加费用
- `BY_QUANTITY`：纯计算层已支持，UI/业务主要使用按金额分摊
- `actualTotalCost = lineAmount + allocatedExtraFee`
- `actualUnitCost = actualTotalCost / totalStems`

采购单到货入库：

```text
PurchaseOrder RECEIVED
  -> 为每条 PurchaseOrderLine 创建 Batch
  -> 写 StockLog: INBOUND
  -> PurchaseOrderLine.inboundBatchId = batch.id
```

入库约束：

- `DRAFT` / `ORDERED` 可以入库。
- `RECEIVED` 不可重复入库。
- `CANCELLED` 不可入库。
- 入库事务中任一行失败，整张采购单回滚。
- `Batch.unitCost = PurchaseOrderLine.actualUnitCost`。
- `Batch.supplier = Supplier.name`。

标准成本更新：

- 已实现单行和整单 API，可将 RECEIVED 采购单实际单支成本写回 `FlowerWiki.standardUnitCost`。
- 该动作仅影响后续产品毛利预估，不影响历史订单真实成本。

## 7. 库存逻辑

库存是双轨：

| 轨道 | 表/字段 | 时点 | 说明 |
|---|---|---|---|
| 虚拟 SKU 库存 | `product_skus.stock` | 下单时 | 小程序可售库存 |
| 物理批次库存 | `batches.remaining_qty` | 支付后 | FIFO 扣真实花材 |

关键规则：

- 下单扣 SKU 虚拟库存。
- 支付成功后按配方展开花材需求，FIFO 扣 `Batch.remainingQty` 并写 `SALE_OUT`。
- 退款通过历史 `SALE_OUT` 原路写 `IN_CANCEL` 回库。
- 报损必须指定批次，写 `WASTAGE_OUT` 和 `StockLossRecord`。
- 手工入库和采购入库都会创建 Batch 并写 `INBOUND`。
- cron worker 可运行 `scripts/cron-inventory-daemon.ts`，定期将物理库存木桶上限投影到 SKU 虚拟库存。

## 8. 本地开发

在 `flower-wms-system/` 下运行：

```bash
npm ci
npx prisma generate
npm run dev
```

常用命令：

```bash
npm run build
npm run lint
npx prisma migrate dev
npx prisma migrate deploy
npm run db:seed
```

说明：

- `npm run db:seed` 使用 `prisma/seed.ts`，创建默认后台管理员和包装方案。
- Prisma Client 输出目录为 `src/generated/prisma`。
- Prisma 7 使用 `@prisma/adapter-pg`，需要 `DATABASE_URL`。

## 9. 环境变量

参考 `flower-wms-system/.env.example`。

| 变量 | 说明 |
|---|---|
| `DATABASE_URL` | PostgreSQL 连接串 |
| `AUTH_SECRET` | Auth.js 后台登录密钥 |
| `NEXTAUTH_SECRET` | NextAuth 兼容密钥 |
| `NEXTAUTH_URL` | 后台访问 URL |
| `NEXT_PUBLIC_ASSET_BASE_URL` | 小程序/外网访问静态资源基址 |
| `NEXT_PUBLIC_API_URL` | 小程序/外网访问 API 基址 |
| `WECHAT_MINI_APP_ID` | 微信小程序 AppID |
| `WECHAT_MINI_APP_SECRET` | 微信小程序密钥 |
| `WECHAT_JWT_SECRET` | 小程序用户 JWT 密钥 |
| `DEEPSEEK_API_KEY` | AI 补全 API Key |
| `DEEPSEEK_MODEL` | 默认 `deepseek-chat` |
| `INVENTORY_SYNC_INTERVAL_MS` | cron worker 读取，当前不在 `.env.example` 中列出 |
| `SKIP_DB_MIGRATE` | Docker entrypoint 支持，设为 `true` 可跳过 migrate deploy |

不要提交真实密钥。

## 10. Docker / 部署

Docker 文件位于仓库根目录：

- `Dockerfile`
- `docker-compose.yml`

compose 服务：

| 服务 | 说明 |
|---|---|
| `flower-nginx` | Nginx 网关 |
| `flower-web` | Next.js standalone Web 应用 |
| `flower-cron-worker` | 库存投影 cron worker，运行 `scripts/cron-inventory-daemon.ts` |
| `db` | PostgreSQL |

容器启动：

- `flower-wms-system/docker-entrypoint.sh` 会在 `DATABASE_URL` 存在且 `SKIP_DB_MIGRATE != true` 时执行 `npx prisma migrate deploy`。
- Dockerfile healthcheck 请求 `/login`。
- 当前 compose 未为 `public/uploads` 配置持久化卷；上传仍是本地文件系统方案。

## 11. 测试 / Smoke Scripts

当前没有统一 `npm test`。已有轻量 tsx 测试：

```bash
npm run test:cost
npm run test:reports
npm run test:purchase
npm run test:margin
```

采购入库手动 smoke：

```bash
DATABASE_URL="postgresql://..." npm run smoke:purchase
```

该脚本会创建/复用测试供应商、FlowerWiki 和操作员，创建采购单，执行 receive，断言 Batch、StockLog、Material 库存和成本字段一致。

其他脚本：

```bash
npx tsx scripts/sync-physical-to-virtual-stock.ts
npx tsx scripts/cron-inventory-daemon.ts
npm run seed:test-products
```

## 12. 开发红线

必须遵守：

1. 不要绕过 `StockLog` 直接改 `Batch` 库存。
2. 配方保存不能产生库存副作用。
3. 报损必须指定批次。
4. 订单实际毛利必须基于历史 `SALE_OUT` 和 `Batch.unitCost`，不能用当前标准成本覆盖。
5. 产品毛利预估使用 `FlowerWiki.standardUnitCost`，与订单真实毛利分开。
6. `PackagingKit.standardCost` 是包装标准成本，不代表包装物理库存。
7. 采购单 `RECEIVED` 后不能修改核心金额和明细。
8. 采购单不能重复入库。
9. 采购入库必须写 Batch + `StockLog: INBOUND`。
10. 供应商停用不能影响历史采购单。
11. CMS SKU 营销 PATCH 不得 mass assignment，只能改图文白名单字段。
12. 当前不是多租户 SaaS：代码中没有 tenant 模型或隔离字段。

## 13. 当前未实现 / 不应假设

- 多租户 SaaS。
- 正式微信支付 SDK；当前是 mock 支付和 callback 占位。
- 第三方配送调度。
- 对象存储；当前上传为本地 `public/uploads`。
- Redis / MQ。
- 供应商分析大报表、采购价趋势图。
- Excel 导入导出。
- CRM / SaaS 计费。
