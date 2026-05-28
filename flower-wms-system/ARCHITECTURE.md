# Flower WMS System — 架构概览

> 文档版本：基于代码库静态审计生成（Next.js App Router + Prisma + PostgreSQL）。  
> 应用根目录：`flower-wms-system/`。所有物理表名以 `prisma/schema.prisma` 的 `@@map(...)` 为准。

---

### 🌿 项目技术全景定位

本系统是基于 **Next.js 16（App Router）+ React 19 + Tailwind CSS 4 + Prisma 7 + PostgreSQL** 的全栈数字化鲜花大仓供应链管理系统。

核心能力边界：

- **WMS 端（`/wms`）**：主导物料母表、标准工艺配方（BOM）、物理批次库存、仓储日常（入库 / 指定批次报损）、库存查询、订单履约看板。
- **CMS 端（`/cms`）**：纯粹的小程序运营货架——商品 SPU/SKU、商品分类、轮播、营销配置；通过 `ProductSpu.recipeId` **只读绑定** WMS 配方，不在 CMS 维护 BOM 明细。
- **微信小程序 API（`/api/wechat/*`）**：用户登录、商品浏览、购物车、下单与 mock 支付、订单查询等。

技术栈要点：

| 层级 | 选型 |
|------|------|
| 框架 | Next.js App Router，Server / Client Component 混用 |
| ORM | Prisma Client，输出至 `src/generated/prisma` |
| 数据库 | PostgreSQL（`datasource db`） |
| 样式 | Tailwind CSS |
| 拼音检索 | `pinyin-pro` → `src/lib/pinyin-index.ts` |

**不存在于本代码库的能力（请勿臆造）**：多租户 SaaS、聚合配送调度、独立的 `stock_batches` / `product_bom` 物理表、销售订单自动扣减物理批次库存（见下文「待重构」）。

---

### 📂 目录结构与核心模块边界

```
flower-wms-system/
├── prisma/
│   ├── schema.prisma          # 唯一数据模型真理源
│   └── migrations/            # 历史迁移 SQL
├── src/
│   ├── app/
│   │   ├── page.tsx           # 工作台门户（WMS / CMS 分流）
│   │   ├── wms/               # WMS 页面路由
│   │   ├── cms/               # CMS 页面路由
│   │   ├── admin/             # 管理壳（轻量）
│   │   └── api/
│   │       ├── admin/         # 后台 REST（含 wms、wiki、orders…）
│   │       ├── cms/           # CMS 专用 API
│   │       └── wechat/        # 小程序 API
│   ├── components/
│   │   ├── wms/               # WMS 侧栏等
│   │   ├── cms/               # CMS 侧栏、RecipeSelect、商品编辑器
│   │   ├── shared/            # QuantityStepper、上传区等
│   │   └── ui/                # FlowerMaterialSelect、Input、Button…
│   ├── services/              # 领域事务与查询（recipe、wms-stock、fifo…）
│   ├── lib/                   # 工具、序列化、库存查询 helper
│   └── generated/prisma/      # Prisma 生成物（勿手改）
```

#### WMS 页面路由（`src/app/wms/`）

| 路径 | 职责 |
|------|------|
| `/wms/dashboard` | 仪表盘指标、低库存、今日损耗等 |
| `/wms/inventory` | 物理库存列表（仅有 `remainingQty > 0` 批次） |
| `/wms/inventory/[id]` | 原材料详情：批次、流水、**历史报损日志** |
| `/wms/operations` | **仓储日常控制台**（入库 + 指定批次报损 + 左侧折叠流水线） |
| `/wms/wiki` | 物料母表（FlowerWiki）维护 |
| `/wms/recipes` | 标准配方研发中心 |
| `/wms/material-categories` | 原材料分类（与商品分类解耦） |
| `/wms/orders` | 小程序订单履约看板 |
| `/wms/batches` | → 重定向至 `/wms/operations` |
| `/wms/wastage` | → 重定向至 `/wms/operations?panel=loss` |
| `/wms/bom` | → 重定向至 `/wms/recipes` |

导航定义：`src/components/wms/sidebar.tsx`。

#### CMS 页面路由（`src/app/cms/`）

| 路径 | 职责 |
|------|------|
| `/cms/products` | 商品列表与编辑（含 `recipeId` 下拉绑定） |
| `/cms/product-categories` | 商城商品分类树 |
| `/cms/banner` | 首页轮播 |
| `/cms/marketing` | 营销配置（`app_configs`） |

导航定义：`src/components/cms/sidebar.tsx`。CMS **不包含** BOM 编辑、入库、报损入口。

#### WMS 后台 API（`src/app/api/admin/wms/`）

| 方法 | 路径 | 服务层 | 说明 |
|------|------|--------|------|
| GET/POST | `/api/admin/wms/recipes` | `services/recipe.ts` | 配方列表 / 创建 |
| GET/PUT/DELETE | `/api/admin/wms/recipes/[id]` | `services/recipe.ts` | 单条配方 CRUD |
| POST | `/api/admin/wms/stock-in` | `services/wms-stock.ts` | 原料到货入库 |
| POST | `/api/admin/wms/stock-loss` | `services/wms-stock.ts` | **指定批次**物理报损 |
| GET | `/api/admin/wms/stock-batches` | `services/wms-stock.ts` | 按 `flowerWikiId` 查可用批次 |
| GET | `/api/admin/wms/stock-loss/history` | `services/wms-stock.ts` | 报损历史 |
| GET | `/api/admin/wms/stock-pipeline` | `services/wms-stock.ts` | 在库批次流水线 |
| GET/POST | `/api/admin/wms/material-categories` | `lib/material-category*` | 原材料分类 |
| GET/POST | `/api/admin/wms/inbound/confirm` | `services/wiki-inbound.ts` | Wiki 撞库 / 双写入库（旧链路） |
| GET/POST | `/api/admin/wms/bom` | — | **410**，已迁移至 `recipes` |
| POST | `/api/admin/wms/ai-preview` | `@/lib/wiki-ai` | AI 花材图像预览（依赖外部模块） |

#### 物料母表 API（WMS 数据，路径在 `admin/wiki`）

| 路径 | 说明 |
|------|------|
| `/api/admin/wiki` | 列表 / 创建；支持 `q` 简拼检索 |
| `/api/admin/wiki/[id]` | 单条读写 |

#### 业务解耦原则（代码现状）

```
FlowerWiki（母表真理）
    ├── RecipeLine（配方明细，仅工艺公式）
    ├── Material（物理仓储 SKU，入库时按需创建）
    │       └── Batch（物理批次，独立进价）
    └── StockLossRecord（报损留痕）

ProductSpu（CMS 商品）
    ├── ProductSku（可售库存 stock 字段）
    └── recipeId → Recipe（只读引用，不反向写库存）
```

---

### 📡 主数据血缘与「WMS 配方中心」

#### 中央真理源：`flower_wikis`

Prisma 模型：`FlowerWiki` → 表 **`flower_wikis`**。

| 字段（DB snake_case） | 应用层 | 用途 |
|----------------------|--------|------|
| `english_name` | `englishName` | 拉丁学名，唯一 |
| `chinese_name` | `chineseName` | 中文常用名 |
| `pinyin_index` | `pinyinIndex` | 简拼索引，写入时由 `toPinyinIndex()` 生成 |
| `color_tags` | `colorTags` | 色系标签数组 |
| `floral_role` | `floralRole` | 枚举：主花 / 配花 / 线条 / 叶材 |
| `alias_map` | `aliasMap` | JSON 别名 |

**简拼检索流**：

1. 创建 / 更新 Wiki 时：`src/lib/pinyin-index.ts` 用 `pinyin-pro` 取首字母 → 如「矢车菊」→ `scj`。
2. 列表查询：`services/wiki.ts` 的 `buildWhere()` 对 `englishName`、`chineseName`、`pinyinIndex` 做 `contains` OR 检索。
3. 前端组件：`src/components/ui/FlowerMaterialSelect.tsx` 调用 `GET /api/admin/wiki?q=…`，用于配方研发、仓储报损等场景。

#### 标准配方：`recipes` + `recipe_lines`

| 模型 | 物理表 | 说明 |
|------|--------|------|
| `Recipe` | `recipes` | 配方主表 |
| `RecipeLine` | `recipe_lines` | 明细行 |

**关键字段血缘**：

- `recipes.recipe_code` ← 系统自动生成，格式 **`BOM-YYYYMMDD-XXX`**（见 `services/recipe.ts` → `generateNextRecipeCode()`，Serializable 事务防碰撞）。
- `recipes.name` ← **必填**，用户输入的配方名称（非单号）。
- `recipe_lines.flower_wiki_id` → `flower_wikis.id`（**直接关联母表**，不关联 `materials`）。
- `recipe_lines.quantity_needed` ← 所需枝数。

**与 CMS 的绑定**：`product_spus.recipe_id` → `recipes.id`。CMS 通过 `src/components/cms/RecipeSelect.tsx` 拉取 `/api/admin/wms/recipes` 展示 `{code} - {name} ({summary})`。

#### 配方保存的沙盒隔离（已实现）

`services/recipe.ts` 中 `writeRecipeLines()` **仅**执行：

1. `recipeLine.deleteMany` + `createMany`（写 `recipe_lines`）；
2. `assertWikiIdsExist` 校验母表 ID。

**不会**创建 `materials`、**不会**写入 `batches` / `stock_logs`。因此配方研发不会产生物理库存副作用。

库存列表防护：`src/lib/wms-inventory.ts` 的 `physicalStockMaterialWhere` 要求 `batches.some({ remainingQty: { gt: 0 } })`，避免「零库存幽灵 Material」出现在 `/wms/inventory`。

#### UI：`/wms/recipes`

- 组件：`src/app/wms/recipes/WmsRecipeConsole.tsx`
- 能力：配方名称、简拼选花材、`QuantityStepper` 数量、保存后重置表单
- API：`POST /api/admin/wms/recipes` body `{ name, ingredients: [{ flowerWikiId, quantity }] }`

---

### 📦 WMS 库存核心：销售 FIFO 与批次精准报损

#### 物理表模型（Schema First）

| Prisma 模型 | 物理表 | 说明 |
|-------------|--------|------|
| `Material` | `materials` | 仓储原材料；`wiki_id` 可选关联母表 |
| `Batch` | **`batches`** | 物理库存批次（**非** `stock_batches`） |
| `StockLog` | `stock_logs` | 全量库存流水 |
| `StockLossRecord` | `stock_loss_records` | 报损专表留痕 |

`batches` 核心字段：`original_qty`、`remaining_qty`、`unit_cost`（批次独立进价）、`inbound_at`、`created_at`、`supplier`。

#### 两种扣库逻辑的本质区别

| 场景 | 实现位置 | 算法 | 状态 |
|------|----------|------|------|
| **销售出库 FIFO** | `src/services/fifo.ts` | 按 `createdAt ASC` 查 `remainingQty > 0` 的批次，跨批次扣减并写 `StockLogType.SALE_OUT` | 算法已实现；**[待架构重构/Pending Refactoring]** 当前 `order-lifecycle.ts` 仅扣减 `product_skus.stock`，**未调用** `applyFifoDeductions()`，物理批次与销售未打通 |
| **物理损耗盘点** | `src/services/wms-stock.ts` → `runStockLossTransaction()` | 操作员指定 `stockBatchId`，单批次精准扣减 | **已上线**，主路径 `/api/admin/wms/stock-loss` |

##### 1. 销售 FIFO（设计意图，代码已备未接）

```text
calculateFifoDeductions(materialId, qty)
  → batches WHERE remaining_qty > 0 ORDER BY created_at ASC
  → 依次扣减直至 qty 为 0

applyFifoDeductions({ logType: SALE_OUT, ... })
  → 事务内 update batch + insert stock_logs
```

##### 2. 物理报损：指定批次精准扣减（当前生产路径）

**API**：`POST /api/admin/wms/stock-loss`

请求体（`src/types/index.ts` → `WmsStockLossBody`）：

```json
{
  "flowerWikiId": "uuid",
  "stockBatchId": "cuid",
  "lossQuantity": 5,
  "reason": "自然开败",
  "operator": "可选"
}
```

事务逻辑（`runStockLossTransaction`）：

1. 校验批次存在且 `batch.material.wikiId === flowerWikiId`；
2. 若 `lossQuantity > batch.remainingQty` → 报错 **「报损数量超出该批次可用库存」**；
3. `batches.remaining_qty` 递减；
4. 写 `stock_logs`（`WASTAGE_OUT`）；
5. 写 **`stock_loss_records`**（关联 `flower_wiki_id`、`batch_id`、`stock_log_id`）。

**报损历史查询**：

- `GET /api/admin/wms/stock-loss/history?flowerWikiId=` 或 `?materialId=`

#### 原料到货入库

**API**：`POST /api/admin/wms/stock-in`  
服务：`runStockInTransaction()` — 为每次到货创建**独立** `batches` 行 + `INBOUND` 流水；若该 Wiki 尚无 Material 则创建 `materials`（入库场景合理，与配方沙盒不同）。

#### 仓储日常 UI（`/wms/operations`）

| 文件 | 职责 |
|------|------|
| `WmsStockConsole.tsx` | 双栏：左流水线 + 右入库 / 报损 Tab |
| `BatchPipelinePanel.tsx` | 左侧折叠流水线 |

**左侧流水线（Group By & Collapse）**：

- 按 `flowerWikiId`（无则退化为 `materialId`）分组；
- **默认全部收起**；
- 收起态展示：花材名（`text-lg` / `md:text-xl font-bold`）、批次数 Tag、库中总计支数、库存总价值（Σ 剩余 × 进价）；
- 点击展开：CSS `grid-rows` 过渡动画，内嵌按 `createdAt` 排序的批次小卡片。

**右侧报损面板**：

- 文案：「请选择实际发生物理损耗的花材批次进行扣减」；
- 流程：简拼选花材 → `GET /api/admin/wms/stock-batches` 填充 Select → 选定批次后启用 `QuantityStepper` 与提交；
- Select Option 格式：`批次: {日期} - 剩余: {n}支 - 进价: ¥{单价} - 供应商: {名}`。

#### 库存详情中的报损日志

`src/app/wms/inventory/[id]/page.tsx` + `services/wms-inventory-detail.ts`：

- 区块 **「📜 历史报损盘点日志」**：从 `stock_loss_records` 加载；
- 列：报损时间 | 报损批次（单号 / 日期）| 损耗数量 | 损耗原因。

#### 共享计数器组件

`src/components/shared/QuantityStepper.tsx`：

- 左右 ± 按钮（最小 44×44px 触控热区）；
- 中间 `type="number"` + `inputMode="numeric"` + `pattern="[0-9]*"`；
- `onBlur` 纠正空值 / 非法值为 `min`（默认 1）；
- 用于：配方研发、仓储入库、仓储报损等。

---

### 🚧 研发红线与架构防线

以下为**代码中已固化或从实现直接推导**的规矩；未在仓库中出现的策略不会写入。

#### 必须遵守

1. **配方保存零库存副作用**  
   `services/recipe.ts` 只写 `recipes` / `recipe_lines`，禁止在配方事务中创建 `materials` 或 `batches`。

2. **库存列表只展示真实物理库存**  
   使用 `lib/wms-inventory.ts` 的 `physicalStockMaterialWhere`，禁止对 `materials` 全表 `findMany` 作为库存展示。

3. **报损必须指定批次**  
   新链路只认 `stockBatchId`；禁止在 `stock-loss` 接口恢复「按时间戳自动 FIFO 扣损耗」。

4. **计数器交互标准**  
   WMS 数量输入统一走 `QuantityStepper`（加减 + 手动输入 + 移动端数字键盘），禁止退化为不可编辑的纯文本展示。

5. **物理命名规范**  
   DB 列 snake_case（`@@map`）；TypeScript / API JSON 使用 camelCase。

6. **CMS / WMS 分类完全解耦**  
   - 商品分类：`product_categories_list` + `product_categories`  
   - 原材料分类：`material_categories` + `material_category_relations`  
   二者无 `parentId` 交叉。

#### 已知悬空 / 待清理 `[待架构重构/Pending Refactoring]`

| 项 | 说明 |
|----|------|
| 销售 → 物理批次 FIFO | `fifo.ts` 已实现但无调用方；订单仍扣 `product_skus.stock`（`order-lifecycle.ts`） |
| 旧报损 API | `POST /api/admin/wastage` + `services/wastage.ts`（单批次扣减）仍存在；UI 已迁到 `/wms/operations`，建议废弃或 410 |
| 旧入库链路 | `InboundForm`、`/api/admin/batches`、`wiki-inbound` 与新版 `stock-in` 并存 |
| 旧 BOM 路由 | `/api/admin/products/bom`、`services/bom.ts` 等遗留；WMS 侧已 410 / 重定向 |
| 损耗 UI 死代码 | `wms/wastage/WastageWorkspace.tsx`、`WastageForm.tsx` 仍保留，页面已 redirect |
| AI 视觉依赖 | `ai-preview`、`ai/vision`、`wiki/ai-generate` 路由引用 `@/lib/wiki-ai`；该模块可能未纳入当前工作区 / 需环境变量，**生产启用前需单独验证** |
| Schema 注释滞后 | `schema.prisma` 头部仍写「RecipeLine ↔ Material」；实际已为 `flower_wiki_id`；`StockLogType.WASTAGE_OUT` 注释写「FIFO 扣减」，与当前报损实现不符 |
| Mock 数据 | `src/lib/mock/*` 部分页面未引用，仅测试 / 遗留 |

#### API 与枚举速查

**`StockLogType`（`stock_logs.type`）**

| 枚举 | 含义 |
|------|------|
| `INBOUND` | 采购入库 |
| `SALE_OUT` | 销售出库（设计为 FIFO） |
| `WASTAGE_OUT` | 损耗出库 |
| `ADJUSTMENT` | 盘点调整 |
| `IN_CANCEL` | 订单取消回库 |

**订单状态机**：`OrderStatus` — 待支付 → 已支付 → 制作中 → 配送中 → 已完成 / 已取消（`services/order-lifecycle.ts`）。

---

### 用户与权限管理（五级 RBAC）

后台员工与小程序顾客 **分表**：`staff_users`（Credentials + RBAC）与 `users`（微信 `openId`）。避免改动订单外键。

#### 角色职责边界

| 角色 | 职责 | 业务数据 |
|------|------|----------|
| `IT_ADMIN` | 创建/停用后台账号、分配角色 | **禁止**：批次、配方、Wiki、订单、CMS 商品等一切业务读写 |
| `STORE_ADMIN` | 门店全权：WMS + CMS + 店内人员 + **全量损耗审计** | 全部业务 |
| `WAREHOUSE_MANAGER` | 入库、**指定批次报损**、Wiki、标准配方审定 | WMS 写；**禁止 CMS** |
| `FLORIST` | 订单履约看板；Wiki/配方 **只读**；销售 FIFO 扣库（服务已就绪，订单链路待接通） | `/wms/orders` + 只读 API |
| `STORE_OPERATOR` | CMS 商品上架；`recipeId` **只读引用** | **禁止** WMS 写与 Wiki；`GET /api/admin/wms/recipes` 只读 |

权限矩阵实现：`src/lib/rbac.ts`；Route Handler 二次校验：`requirePermission()`（`src/lib/api-auth.ts`）。

#### IT Admin 业务盲区

- **Middleware**（`src/middleware.ts`）：拦截 `BUSINESS_API_PREFIXES` 下所有 `/api/admin/wms|wiki|orders|…` 与 `/api/cms`，以及 `/wms`、`/cms` 页面，重定向至 `/admin/staff-users`。
- **API 层**：`canAccessBusinessData(role)` 为 false 时，业务 Route 返回 403。
- 运维账号 **看不到** 批次余量、报损明细、配方行、订单金额等敏感字段（未登录则 401）。

#### Store Operator 与 CMS 只读红线

- CMS 写路径：`/cms/*`、`/api/cms/*`，权限 `cms:write`。
- 绑定 SPU 时仅允许选择已存在的 `recipes.id`（`assertRecipeExists`），**不得** POST/PUT 配方行或物料批次。
- Middleware 对 `STORE_OPERATOR` 仅放行配方 **GET**；其余 `/api/admin/wms`、`/api/admin/wiki` 返回 403。

#### 审计追溯（operatorStaffId）

物理库存变动必须带操作员：

| 场景 | 服务 | 审计字段 |
|------|------|----------|
| 采购入库 | `wms-stock.runStockInTransaction` | `stock_logs.operator_staff_id` |
| 指定批次报损 | `wms-stock.runStockLossTransaction` + `stock_loss_records` | 同上 + 损耗专表 |
| FIFO 销售/跨批次损耗 | `fifo.applyFifoDeductions` | `operatorStaffId` + `operator` 快照 |
| 旧报损 API（待废弃） | `wastage.registerBatchWastage` | 已从 Session 注入，不再信任客户端 `operatorId` |

初始化账号：`npx prisma db seed` → 用户名/密码 `admin` / `admin`，角色 `IT_ADMIN`（请上线后立即改密）。

#### 登出与会话失效

- **UI**：`StaffAccountBar`（WMS/CMS/Admin 侧栏底部 + 工作台 `PortalAccountStrip`）调用 `signOut({ redirect: true, callbackUrl: "/login" })`，清除客户端 Session Cookie 并整页跳转登录页。
- **会话策略**：JWT `maxAge` 12 小时（`auth.config.ts`）；登出后 Middleware 对受保护路径返回 401/重定向 `/login`。
- **切换账号**：必须先登出，再以另一组 Credentials 登录（无「多账号并存」）。

#### 管理员代行重置密码

- **Server Action**：`src/actions/staff-users.ts` → `resetUserPassword(targetStaffId, newPassword)`。
- **权限**：仅 `IT_ADMIN`、`STORE_ADMIN`（`canManageStaffUsers`）；`STORE_ADMIN` **不可**重置 `IT_ADMIN` 账号密码。
- **存储**：`bcrypt`（cost 12）写入 `staff_users.password_hash`，禁止明文。
- **审计表**：`staff_audit_logs`（`action = PASSWORD_RESET`，`operator_staff_id`、`target_staff_id`、`created_at`）。
- **UI**：`/admin/staff-users` 列表仅在 `canResetPassword` 为真时显示「重置密码」→ Modal 确认 → Toast。

相关文件：`src/auth.ts`、`src/auth.config.ts`、`src/middleware.ts`、`prisma/seed.ts`、`src/components/shared/StaffAccountBar.tsx`。

---

### 安全策略（Auth.js 与边缘性能）

#### Auth.js（NextAuth v5）

- **Provider**：Credentials，校验 `staff_users.password_hash`（bcrypt）。
- **Session**：JWT，`session.user` 含 `id`、`username`、`role`（见 `src/types/next-auth.d.ts`）。
- **环境变量**：`AUTH_SECRET` 或 `NEXTAUTH_SECRET`；`NEXTAUTH_URL` 与部署域名一致。
- **入口**：`/login`；Handler：`/api/auth/[...nextauth]`。

#### 路由拦截机制（护城河闭环）

**文件**：`src/middleware.ts`（NextAuth `auth()` 包装）+ `src/lib/auth-routes.ts`（路径判定与角色首页）。

**`matcher` 覆盖范围**（未列入的路径不解析 JWT，如 `/api/wechat` 小程序接口保持公开）：

| 模式 | 作用 |
|------|------|
| `/` | 工作台门户：未登录 → `/login` |
| `/login` | 已登录 → 按角色 `getRoleHomePath()` 跳转 |
| `/wms/:path*`、`/cms/:path*`、`/admin/:path*` | 后台页面 |
| `/api/admin/:path*`、`/api/cms/:path*`、`/api/business/:path*` | 后台 API |

**未登录**：凡 `isStaffProtectedPath()`（`/`、WMS/CMS/Admin 页面及后台 API）→ 页面 **302** 至 `/login?callbackUrl=…`；API 返回 **401 JSON**。

**已登录按角色**（Middleware 内，无 DB）：

- `IT_ADMIN`：业务 API（`BUSINESS_API_PREFIXES`）→ **403**；访问 `/`、`/wms`、`/cms` 或非 `staff-users` 的 `/api/admin/*` → **重定向** `/admin/staff-users`（**物理上看不到**批次/配方/订单等业务数据）。
- `STORE_OPERATOR`：禁止 `/wms`；`/api/admin/wms` 仅放行配方 **GET**。
- `FLORIST`：仅 `/wms/orders` 与 WMS **GET** API。
- `WAREHOUSE_MANAGER`：禁止 `/cms` 与 `/api/cms`。
- `STORE_ADMIN`：可访问 `/` 门户；其余角色访问 `/` 时重定向至各自首页。

**页面双保险**：`src/app/page.tsx` 在 Server Component 内再次 `auth()`，未登录 `redirect('/login')`，非主理人重定向角色首页（防止 Middleware 配置疏漏）。

#### IT Admin 数据脱敏（物理实现）

1. **Middleware 盲区**：`canAccessBusinessData(IT_ADMIN) === false`；`isBusinessApiPath()` 命中即 403，不进入 Prisma。  
2. **页面隔离**：无法打开 `/wms/*`、`/cms/*`；仅 `/admin/staff-users` 可管理 `staff_users`。  
3. **API 层**：`requirePermission()` 对非 `staff:manage` 权限一律 403。  
4. **服务层**：`assertStockMutationAuthorized()` 拒绝 IT Admin 调用入库/报损/FIFO（即使伪造 API 请求）。

#### Middleware 性能（2 核 2G）

- 不对 `/api/wechat`、静态资源做 JWT 解析。  
- 规则仅字符串前缀 + HTTP Method，无 Prisma。

#### 账户退出清理机制

1. 客户端：`signOut({ redirect: true, callbackUrl: "/login" })` 由 Auth.js 清除 Session Token（JWT Cookie）。  
2. 边缘：`middleware.ts` 在后续请求中 `req.auth` 为空，受保护路径无法进入业务页。  
3. 服务端：Route Handler / Server Action 通过 `auth()` 读取 Session；登出后 `requireStaffSession()` 返回 401。  
4. **不**依赖客户端 localStorage 存凭据；Credentials 仅在登录 POST 时使用一次。

#### 管理员代行重置密码（权限判定）

| 操作者 | 可重置对象 | 业务 API |
|--------|------------|----------|
| `IT_ADMIN` | 除自身外的所有 `staff_users`（含 `STORE_ADMIN` 等） | **仍禁止** `/api/admin/wms`、`/api/cms`、`/api/business/**` 等业务路径 |
| `STORE_ADMIN` | 非 `IT_ADMIN` 的员工账号 | 拥有业务权限，与用户管理无关 |

IT Admin 可在 `/admin/staff-users` 重置他人密码，但 Middleware 与 `canAccessBusinessData` 确保其 **永远无法读取** 批次库存、配方、订单等业务 payload。

#### 纵深防御（四层）

1. **Middleware**：登录门禁 + 角色路径隔离 + IT Admin 业务盲区。  
2. **Route Handler**：`requirePermission()` 细粒度能力。  
3. **Server Action / 服务层**：`resetUserPassword` 内 `auth()` + 角色校验；库存侧 `assertStockMutationAuthorized`。  
4. **审计字段**：库存 `operator_staff_id`、账号 `staff_audit_logs` 均绑定真实操作员 ID。

---

### 附录：核心 ER 关系（简图）

```mermaid
erDiagram
  flower_wikis ||--o{ recipe_lines : "flower_wiki_id"
  recipes ||--o{ recipe_lines : "recipe_id"
  recipes ||--o{ product_spus : "recipe_id"
  flower_wikis ||--o{ materials : "wiki_id"
  materials ||--o{ batches : "material_id"
  batches ||--o{ stock_logs : "batch_id"
  batches ||--o{ stock_loss_records : "batch_id"
  flower_wikis ||--o{ stock_loss_records : "flower_wiki_id"
  stock_logs ||--o| stock_loss_records : "stock_log_id"
  staff_users ||--o{ stock_logs : "operator_staff_id"
  staff_users ||--o{ stock_loss_records : "operator_staff_id"
  product_spus ||--o{ product_skus : "spu_id"
  product_skus ||--o{ order_items : "sku_id"
```

---

### 文档维护说明

- 变更 Prisma Schema 后，请同步更新本文「物理表名」与 ER 图。
- 新增 WMS API 请在 `src/app/api/admin/wms/` 落地，并在 `services/` 封装事务，避免 Route Handler 内联复杂 Prisma 逻辑。
- 若完成「销售 FIFO 与物理批次」打通，请移除文中对应 `[待架构重构]` 条目并补充 `order-lifecycle.ts` 调用链说明。
