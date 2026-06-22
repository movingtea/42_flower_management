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
- 手工入库、指定批次报损、销售 FIFO；已支付退款默认不自动物理回库（`rollbackStock` 仅回补虚拟 SKU）。
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
- **通用物料母表**：`MasterPart`，维护辅料、包装材料、工具与其他耗材（Batch P2）；花材仍走 `FlowerWiki`。
- **采购明细双来源（Batch P3）**：`PurchaseOrderLine.itemType = FLOWER` 关联 `FlowerWiki`；`SUPPLY` / `PACKAGING` / `TOOL` / `OTHER` 关联 `MasterPart`；历史明细默认 `FLOWER`。
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
- `ProductSku`：SKU 款式、价格、虚拟可售库存、`isActive`（规格运营可售，默认 true）、可选 `recipeId`。
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
- 已支付退款默认不回补物理批次、不写 `IN_CANCEL`；`rollbackStock=true` 时仅回补虚拟 `ProductSku.stock`。
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

### 9.1 阿里云 OSS（Sprint 14）

图片上传已切换至阿里云 OSS。本地开发见 `flower-wms-system/.env.example`；**生产**见仓库根目录 [`.env.production.example`](../.env.production.example)（与 compose 同目录放置 `.env`）。

部署前静态检查：

```bash
cd flower-wms-system
npm run check:production-env-example
npm run check:nginx-upload-limit
```

完整发布清单：[`docs/production-deployment-checklist.md`](docs/production-deployment-checklist.md)。

| 变量 | 说明 |
|---|---|
| `STORAGE_DRIVER` | 固定 `oss` |
| `ENABLE_OSS_UPLOAD` | `true` 启用 OSS 上传 |
| `ENABLE_LEGACY_UPLOADS` | 生产设为 `false`；`/uploads` 不再作为有效图片来源 |
| `ALIYUN_OSS_UPLOAD_ENDPOINT` | **服务端上传** Endpoint；生产 ECS 同地域用内网 `...-internal.aliyuncs.com`；本地开发用外网 |
| `ALIYUN_OSS_PUBLIC_BASE_URL` | **公网展示**域名，当前 `https://oss.universe42.studio` |
| `ALIYUN_OSS_OBJECT_PREFIX` | objectKey 前缀，当前 `universe42` |
| `UPLOAD_MAX_SIZE_MB` | 单张上限，默认 **3MB**（API 业务校验）；Nginx `client_max_body_size` 应 **大于** 此值（推荐 **5m**） |
| `NEXT_PUBLIC_OSS_PUBLIC_BASE_URL` | CMS 客户端预览用，与 public base 一致 |
| `NEXT_PUBLIC_OSS_OBJECT_PREFIX` | objectKey 前缀识别（**非密钥**） |

**安全边界：** `ALIYUN_OSS_ACCESS_KEY_ID` / `ALIYUN_OSS_ACCESS_KEY_SECRET` 为**服务端密钥**，**禁止** `NEXT_PUBLIC_` 前缀；`ALIYUN_OSS_INTERNAL_ENDPOINT` 仅服务端使用。

**数据库存储 objectKey**（如 `universe42/products/sku/2026/06/xxx.webp`），**不存**完整 public URL；CMS / 小程序展示时转换为 `https://oss.universe42.studio/...`。生产不再使用 `public/uploads` 作为图片来源。

**连通性测试：**

```bash
cd flower-wms-system
npm run test:oss
```

**上传限制：** JPG / PNG / WebP；禁止 SVG；默认 ≤3MB。

**图片上传 413 排查：**

1. 若 **1MB 以上**图片返回裸 `413 Request Entity Too Large`（非 JSON），请求在到达 Next.js 前被 **Nginx** 拦截（默认 `client_max_body_size 1m`）。
2. 生产配置见 [`deploy/nginx/conf.d/flower.conf.example`](../deploy/nginx/conf.d/flower.conf.example)：`client_max_body_size 5m;`
3. 业务限制仍为 `UPLOAD_MAX_SIZE_MB=3`；超过 3MB 应由 API 返回 JSON `{ code: "FILE_TOO_LARGE" }`。
4. 修改 Nginx 后 reload：`docker compose exec flower-nginx nginx -s reload`
5. 验证：`docker compose exec flower-nginx nginx -T | grep client_max_body_size`
6. 验收清单：[`docs/upload-size-limit-checklist.md`](docs/upload-size-limit-checklist.md)

### 小程序图片（Sprint 22）

- 业务远程图：服务端 DTO 输出完整 OSS URL（Batch C：`miniprogram-image-dto` + `imageUrlFormatter`）；客户端 `normalizeImageUrl` 仅兜底。
- `<image src>` 直接使用完整 URL，**不要** `baseUrl + objectKey`。
- 配置：`42_mp/miniprogram/config/index.ts` 中 `ossPublicBaseUrl`（`https://oss.universe42.studio`）与 API `baseUrl` 分离。
- 本地图标：`assets/icons`、tabBar 不走 OSS。
- 验收：[`docs/sprint-22-miniprogram-image-url-audit-checklist.md`](docs/sprint-22-miniprogram-image-url-audit-checklist.md)

```bash
npm run test:miniprogram-image-url
npm run test:miniprogram-image-dto
npm run check:miniprogram-image-dto
```

**微信小程序：** 在微信公众平台配置 `https://oss.universe42.studio` 为合法 **downloadFile** 域名。

**排查图片无法显示：**

1. 确认 `.env` 中 OSS AccessKey 与 Bucket 正确（勿提交 Git）。
2. 运行 `npm run test:oss` 验证上传与公网 HEAD。
3. 数据库字段应为 objectKey，不应含 `localhost` 或 `/uploads`；无效旧图需在 CMS 重新上传。
4. 小程序侧确认 downloadFile 域名白名单。

不要保存 localhost 图片 URL；不要提交真实 AccessKey。

不要提交真实密钥。

## 10. Docker / 部署

Docker 文件位于仓库根目录：

- `Dockerfile`
- `docker-compose.yml`
- `docker-compose.example.yml`
- `.env.production.example` — 生产 env 模板（OSS / 上传 / Auth）
- `deploy/nginx/conf.d/flower.conf.example` — Nginx 含 `client_max_body_size 5m`
- `scripts/deploy-cleanup.sh` — 部署后安全磁盘清理（宿主机执行）

compose 服务：

| 服务 | 说明 |
|---|---|
| `flower-nginx` | Nginx 网关 |
| `flower-web` | Next.js standalone Web 应用 |
| `flower-cron-worker` | 库存投影 cron worker，运行 `scripts/cron-inventory-daemon.ts` |
| `db` | PostgreSQL |
| `docker-cleanup` | 可选清理服务，仅在 `--profile cleanup` 时启用（不推荐默认使用） |

### 推荐部署流程

生产服务器磁盘通常较小（例如 20GB），频繁部署会积累 build cache、dangling images、停止的容器与容器 json 日志。推荐在 `docker compose up -d` 成功且 healthcheck 通过后执行清理：

```bash
# 在 compose 与 .env 所在目录（如 /root/flower-platform/）
docker compose pull
docker compose build    # 若本地构建镜像
docker compose up -d
./scripts/deploy-cleanup.sh
```

`deploy-cleanup.sh` 行为：

- 等待 `flower-web`（Dockerfile healthcheck `/login`）与 `db`（`pg_isready`）变为 healthy，默认最多 120 秒。
- healthcheck 未通过时**不执行 prune**，退出码 1。
- healthcheck 通过后执行安全 prune：停止的容器、dangling images、未使用网络、24 小时前的 build cache。
- **不删除** Docker volumes（含 `postgres_data`）、**不删除** `public/uploads`、**不影响**正在运行的容器。
- **不执行** `docker system prune -a --volumes` 或 `docker volume prune`。
- 输出清理前后的 `df -h` 与 `docker system df`。
- 清理命令失败不会停止已启动的服务。

更激进但仍不删 volume：`./scripts/deploy-cleanup.sh --aggressive`（清理 72 小时前未使用的镜像与 build cache）。

CI/CD（`.github/workflows/deploy.yml`）在远程部署成功后会尝试执行 `./scripts/deploy-cleanup.sh`；失败仅 WARNING，不阻断已成功的 deploy（healthcheck 失败时 deploy-cleanup 会跳过 prune）。

### 10.5 服务器磁盘空间与 Docker 运维（Sprint 15）

Sprint 14 验证中曾出现：**CMS 图片上传成功但保存 502**、Prisma `getaddrinfo EAI_AGAIN db` — 根因是**宿主机磁盘满**，不是 OSS。磁盘不足还会导致容器 unhealthy、cron-worker 重启、PostgreSQL 异常。

#### 常见现象

| 现象 | 可能根因 |
|---|---|
| CMS 保存 502 | 磁盘满 → Node/Prisma/DB 不稳定 |
| `getaddrinfo EAI_AGAIN db` | Docker DNS/网络或 db 容器异常，常伴随磁盘满 |
| 容器 unhealthy | 健康检查超时、日志或 overlay 写满 |
| cron-worker 反复重启 | 同主机资源耗尽 |
| 上传成功保存失败 | 上传走 OSS 已成功，写库阶段 DB 不可用 |

#### 排查命令（宿主机）

```bash
df -h
docker system df
docker ps -a
docker logs flower-web-prod --tail 100
du -sh /var/lib/docker
```

#### 项目运维命令（在 `flower-wms-system/` 目录）

```bash
npm run ops:disk           # 只读：df、Docker 占用、目录 du（>=90% exit 2）
npm run ops:docker-usage   # 只读：镜像/容器/volume/build cache 摘要
npm run smoke:ops          # 上述两项串联，不执行清理
npm run ops:prune          # 安全清理（需人工执行；不清理 volumes）
```

或直接运行仓库根目录脚本：

```bash
./scripts/check-disk-space.sh
./scripts/check-docker-usage.sh
DRY_RUN=true ./scripts/safe-docker-prune.sh   # 预览
./scripts/safe-docker-prune.sh                # 执行清理
./scripts/deploy-cleanup.sh                   # 部署后（等 healthcheck）
```

#### 安全清理说明

**可以清理：**

- 已停止容器（`docker container prune -f`）
- dangling images（`docker image prune -f`）
- 未使用网络（`docker network prune -f`）
- build cache（`docker builder prune -f`）

**禁止清理：**

- `docker volume prune` / `docker system prune -a --volumes`
- `postgres_data` 等 PostgreSQL 数据 volume
- `rm -rf /var/lib/docker`、业务 uploads 目录

#### 日志轮转

`docker-compose.example.yml` 中 `flower-web`、`flower-cron-worker`、`flower-nginx`、`db` 均已配置：

```yaml
logging:
  driver: "json-file"
  options:
    max-size: "10m"
    max-file: "3"
```

#### PostgreSQL volume

数据在 compose volume `postgres_data`（`/var/lib/docker/volumes/...`），**任何自动清理脚本均不得 prune volumes**。

#### 何时扩容磁盘

- 根分区持续 ≥80%（WARNING）
- 执行 `ops:prune` / `deploy-cleanup` 后仍 ≥80%
- `/var/lib/docker` 占用持续增长
- 数据库数据量明显增长

WMS **系统健康**（`/wms/system-health`）会展示容器内磁盘视图；宿主机请以 `ops:disk` 为准。

若磁盘仍不足，需人工排查：

```bash
docker system df
docker logs flower-web-prod --tail 100
du -sh /var/lib/docker/*
du -sh public/uploads
docker volume ls
```

### 容器日志轮转

`flower-web`、`flower-cron-worker`、`flower-nginx`、`db` 已配置 json-file 日志轮转（单文件最大 10MB，保留 3 个），避免容器日志无限增长。

### 容器启动与数据

- `flower-wms-system/docker-entrypoint.sh` 会在 `DATABASE_URL` 存在且 `SKIP_DB_MIGRATE != true` 时执行 `npx prisma migrate deploy`。
- Dockerfile healthcheck 请求 `/login`。
- 当前 compose 未为 `public/uploads` 配置持久化卷；**Sprint 14 起新上传走 OSS**，legacy 本地目录仅当 `ENABLE_LEGACY_UPLOADS=true` 时使用。
- PostgreSQL 数据保存在 named volume `postgres_data`，清理脚本不会 prune volumes。

### 可选 compose cleanup profile（不推荐默认）

```bash
docker compose --profile cleanup run --rm docker-cleanup
```

该服务挂载 `/var/run/docker.sock`，存在安全风险；**优先使用宿主机 `scripts/deploy-cleanup.sh`**。默认 `docker compose up -d` 不会启动 `docker-cleanup`。

### 10.6 后台 UI 规范（Sprint 16）

Sprint 16 聚焦 CMS / WMS 后台布局体验，**不改业务规则与数据库 schema**。详见 [`docs/ui-guidelines.md`](docs/ui-guidelines.md) 与 [`docs/sprint-16-ui-checklist.md`](docs/sprint-16-ui-checklist.md)。

| 区域 | 变更 |
|---|---|
| 商品编辑 SKU | 宽表 → 卡片；毛利摘要默认可见，损耗模拟默认折叠 |
| 订单履约看板 | 归档列 compact card + 最近 20 条限制 |
| 宽表格 | sticky 主识别列 + sticky 操作列（`src/components/admin/sticky-table.tsx`） |

```bash
npm run test:sku-display
npm run test:kanban-archive
```

### 10.7 后台表单与图片预览（Sprint 17）

- 数字输入：使用 `NumberInput` / `DecimalStringInput`，勿在 `onChange` 中 `Number('') → 0`。
- 图片：DB 存 objectKey；CMS 预览用 `NEXT_PUBLIC_OSS_PUBLIC_BASE_URL` + `NEXT_PUBLIC_OSS_OBJECT_PREFIX`；**禁止**在 client component 将 objectKey 直接作为 `img` / `next/image` src；详见 [`docs/ui-guidelines.md`](docs/ui-guidelines.md) 与 [`docs/sprint-22-cms-image-url-audit-checklist.md`](docs/sprint-22-cms-image-url-audit-checklist.md)。

```bash
npm run test:number-input
npm run test:client-image-preview
npm run smoke:cms-product-preview
```

### 10.8 Lint 清理（Sprint 18）

- `npm run lint`：**0 error**（2026-06-10）；剩余 warning 为历史未使用 import/变量（API routes、product-margin 等），不影响 build。
- OSS：`module` 变量重命名为 `uploadModule`，避免 `@next/next/no-assign-module-variable`。
- React 19：`react-hooks/set-state-in-effect` 通过 `src/lib/defer-effect.ts`（`useDeferredEffect` / `deferEffectTask`）延迟 effect 内 setState，不改变请求时机与业务逻辑。
- `QuantityStepper`：聚焦时用 draft、失焦后同步 prop，移除 effect 同步。

### 10.9 单规格商品（默认 SKU）

- 新建商品默认 1 个 SKU 草稿（`createDefaultSkuDraftRow()`），CMS 区块「价格与库存」，无需手动添加款式。
- 多款式：点击「添加款式」；小程序 `showSpecSelector` 仅多 SKU 为 true。
- 测试：`npm run test:single-spec-product`

### 10.10 UI 抛光（Sprint 18 补充）

- SKU 卡片启用区固定布局；宽表 sticky 不透明背景 + 操作列横向按钮。
- 验收：`docs/sprint-18-ui-polish-checklist.md`

### 10.11 Drawer 交互（Sprint 19）

- 新增 / 编辑 / 详情统一右侧 `AdminDrawer`；mask 半透明遮盖；Footer 固定保存 / 取消。
- 验收：`docs/sprint-19-drawer-migration-checklist.md`

## 11. 测试 / Smoke Scripts

**业务规则源文件**：`docs/business-rules.md`（Sprint 12 起为规则真理源；Sprint 13 补齐 `ProductSku.isActive` 语义）。

迁移（Sprint 13）：

```bash
cd flower-wms-system
npx prisma migrate deploy   # 或 migrate dev
npx prisma generate
```

新增 migration：`20260611140000_product_sku_is_active`（`product_skus.is_active BOOLEAN NOT NULL DEFAULT true`）。

### 业务不变量测试

全量纯函数测试：

```bash
npm run test:all
```

Sprint 13 专项测试：

```bash
npm run test:sku-active-invariants
npm run test:miniprogram-stock
npm run test:recommendation-rules
npm run test:recommendation-display
npm run test:cms-validation
npm run test:banner-rules
npm run test:cms-banners
```

CMS 首页轮播删除为**软删除**（`isDeleted=true`），删除后 CMS 默认列表与小程序 `home-banners` 均不再展示；历史记录保留。

Sprint 12 专项测试：

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
npm run test:order-create-delivery
npm run test:order-expiry-lifecycle   # 需 DATABASE_URL
npm run test:recommendation-display
npm run test:banner-validity
```

### 店铺配送设置（Sprint 12 Round 2）

- 存储：`AppConfig` key `STORE_DELIVERY_SETTINGS`（见 `src/lib/store-delivery-settings.ts`）
- CMS 配置：后台 **营销配置** → **配送设置** Tab（`/cms/marketing`）
- 小程序读取：`GET /api/miniprogram/delivery-settings`
- 下单强校验：`createWechatOrder` → `assertDeliveryAvailabilityForOrder`

### 待支付订单自动关闭（cron worker）

`flower-cron-worker` 运行 `scripts/cron-inventory-daemon.ts`，除库存投影外每 60 秒执行 `closeExpiredPendingOrders()`：

- 条件：`PENDING_PAYMENT` 且 `createdAt` 超过 15 分钟
- 动作：状态 → `CANCELLED`，回补 `ProductSku.stock`
- 不扣 Batch、不生成 `SALE_OUT` / `OrderCostSnapshot`

本地调试：

```bash
npx tsx scripts/cron-inventory-daemon.ts
```

### 人工验收 Checklist

Sprint 12 Round 2 上线前请逐项勾选：

`docs/sprint-12-manual-checklist.md`

已有轻量 tsx 测试（节选）：

```bash
npm run test:cost
npm run test:reports
npm run test:purchase
npm run test:margin
npm run test:miniprogram-stock
npm run test:crm
```

### Smoke Scripts

无需数据库：

```bash
npm run smoke:permission-matrix   # Batch A：静态 route + RBAC 角色边界 + admin API guard
npm run check:admin-api-permissions
npm run smoke:admin-api-http-permissions   # Batch A.2：handler 层 401/403 HTTP smoke
npm run smoke:image-url
npm run smoke:recommendation-rules
```

**后台 API 权限**：所有 `/api/admin/*` 业务 handler 必须调用 `requirePermission`；UI 菜单隐藏不能替代 API 校验。`IT_ADMIN` 不得访问业务数据。详见 [`docs/admin-api-permission-audit.md`](docs/admin-api-permission-audit.md)。

需要 `DATABASE_URL` 且已 migrate：

```bash
npm run smoke:stock-boundary
npm run smoke:preorder-rule
npm run smoke:cms-home-content
npm run smoke:crm-order-sync
npm run smoke:miniprogram-order-flow
DATABASE_URL="postgresql://..." npm run smoke:purchase
```

Smoke 脚本会创建带 `SMOKE_TEST_*` 前缀的测试数据；**勿在生产环境裸跑**。可按前缀手动清理测试 `ProductSpu` / `User` / `Order`。

采购 smoke 会创建/复用测试供应商、FlowerWiki 和操作员，创建采购单并 receive，断言 Batch、StockLog、Material 一致。

其他工具脚本：

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
12. 当前不是完整多租户 SaaS：已有 `Tenant` / `TenantMember` 地基，但**业务表尚无 `tenantId`，查询未隔离**。

### 12.1 多租户 SaaS 改造准备（Sprint 20 + 21）

系统**业务行为仍为单店**。Sprint 20 审计与 Sprint 21 租户地基：

- **[`docs/multitenancy-audit.md`](docs/multitenancy-audit.md)** — 完整审计与路线图
- **Sprint 21**：`Tenant` / `TenantMember`、默认租户 `universe42`、StaffUser 成员归属、session 租户字段

**默认租户与成员回填命令**（在 `flower-wms-system/` 下，需 `DATABASE_URL` 且已 migrate）：

```bash
npx prisma migrate deploy
npm run db:seed              # 含默认租户 + TenantMember 回填
# 或分步：
npm run db:seed:tenant
npm run db:backfill:tenant-members
```

**测试**：

```bash
npm run test:tenant-foundation    # 纯函数，无需 DB
DATABASE_URL="..." npm run smoke:tenant-foundation
```

> 租户模型仅为 SaaS **身份地基**，不代表商品/订单/库存等业务数据已多租户隔离。

## 13. 当前未实现 / 不应假设

- 完整多租户 SaaS 数据隔离（Sprint B/C/D 未做；业务表无 `tenantId`）。
- 正式微信支付 SDK；当前是 mock 支付和 callback 占位。
- 第三方配送调度。
- 对象存储：**Sprint 14 已实现**（阿里云 OSS）；生产不再依赖 `public/uploads`。
- Redis / MQ。
- 供应商分析大报表、采购价趋势图。
- Excel 导入导出。
- SaaS 计费。
- CRM 自动触达（订阅消息 / 短信）；后台 CRM 基础能力已实现。
