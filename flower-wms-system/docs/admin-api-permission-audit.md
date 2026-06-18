# 后台 API 权限审计（Batch A）

> 审查日期：2026-06-17  
> 范围：`src/app/api/admin/**/*.ts`  
> 目标：handler 内显式 `requirePermission`；Middleware / UI 菜单隐藏不能替代 API 权限边界。

## 原则

1. **Middleware**（`src/proxy.ts`）只证明 Staff 已登录并按角色做页面路由；**不能**替代具体 API 的权限校验。
2. 所有 `/api/admin/*` **业务 API** 必须在 route handler 开头调用 `requirePermission(permission)`。
3. 读操作用 `*:read`，写操作用 `*:write`；权限不足返回 **403**（`PERMISSION_DENIED`），未登录返回 **401**。
4. **IT_ADMIN** 仅 `staff:manage`，不得通过业务 API 读写商品 / 库存 / 订单 / CMS 数据（`canAccessBusinessData === false`）。

实现入口：`src/lib/api-auth.ts`（`requirePermission`）、`src/lib/rbac.ts`（角色 → 权限矩阵）。

静态矩阵与 smoke：`src/lib/admin-api-permission-matrix.ts`、`npm run smoke:permission-matrix`、`npm run check:admin-api-permissions`、`npm run smoke:admin-api-http-permissions`。

---

## 本轮 Batch A 已修复路由

| Route | Method | Permission | 说明 |
|---|---|---|---|
| `/api/admin/products` | POST | `cms:write` | 创建商品（deprecated，转发 CMS 逻辑） |
| `/api/admin/products/[id]` | PUT | `cms:write` | 更新商品 |
| `/api/admin/products/[id]` | DELETE | `cms:write` | 软删除商品 |
| `/api/admin/stocktake` | POST | `wms:write` | 库存盘点调整 |
| `/api/admin/app-config` | GET | `cms:read` | 读取 AppConfig |
| `/api/admin/app-config` | PUT | `cms:write` | 写入 AppConfig |
| `/api/admin/product-categories` | GET | `cms:read` | 商品分类树 |
| `/api/admin/product-categories` | POST | `cms:write` | 创建商品分类 |
| `/api/admin/product-categories/[id]` | PUT | `cms:write` | 更新商品分类 |
| `/api/admin/product-categories/[id]` | DELETE | `cms:write` | 删除商品分类 |
| `/api/admin/wms/material-categories/[id]` | PUT | `wms:write` | 更新物料分类 |
| `/api/admin/wms/material-categories/[id]` | DELETE | `wms:write` | 删除物料分类 |
| `/api/admin/orders/[id]/detail` | GET | `wms:read` | 订单履约详情（全局审查补齐） |
| `/api/admin/products/bom` | GET | `wms:read` | deprecated 只读 |
| `/api/admin/products/[id]/bom` | GET | `wms:read` | deprecated 只读 |

**Deprecated 重导出（已通过父 route 继承权限）：**

- `/api/admin/categories` → `product-categories/route.ts`
- `/api/admin/categories/[id]` → `product-categories/[id]/route.ts`

---

## 已安全路由（审计前已有 requirePermission）

以下模块在全局扫描中均已包含 `requirePermission`，本轮未改业务逻辑：

| 域 | 典型路径 | 读权限 | 写权限 |
|---|---|---|---|
| CMS 商品 / SKU | `/api/admin/cms/products/*` | `cms:read` | `cms:write` |
| CMS Banner / 推荐位 / 场景入口 | `/api/admin/cms/banners/*`、`recommendation-*`、`home-scene-entries/*` | `cms:read` | `cms:write` |
| CMS 配送 | `/api/admin/cms/delivery-settings` | `cms:read` | `cms:write` |
| 上传 | `/api/admin/uploads/image`、`/api/admin/upload` | — | `cms:write` |
| WMS 配方 / 包装 / 入库 / 报损 / 采购 | `/api/admin/wms/*`（除下表） | `wms:read` | `wms:write` |
| WMS 物料分类列表 | `/api/admin/wms/material-categories` | `wms:read` | `wms:write` |
| 订单写操作 | `/api/admin/orders`、`/api/admin/orders/[id]/*`（cost、delivery、cancel 等） | `wms:read` / `business:read` | `orders:write` / `wms:write` |
| 报表 | `/api/admin/reports/*` | `business:read` | `business:read`（backfill 等同读域） |
| CRM | `/api/admin/crm/*` | `business:read` | `business:read`（reminder PATCH） |
| 毛利预估 | `/api/admin/products/[id]/margin-estimate/*` | `business:read` | `business:read` |
| 员工 | `/api/admin/staff-users` | — | `staff:manage` |
| 系统 / 试运营 | `/api/admin/setup/checklist`、`data-quality`、`system/health`、`trial-run/check` | `business:read` | — |
| 审计日志 | `/api/admin/audit-logs` | `business:read` | — |
| Wiki | `/api/admin/wiki/*` | `wms:read` | `wms:write` |
| 旧 Banner | `/api/admin/banners` | `cms:read` | `cms:write` |

---

## Batch A.2：HTTP 层测试、410 stub、静态 guard

### HTTP 层权限集成测试

脚本：`npm run smoke:admin-api-http-permissions`

方法：直接调用 route handler + `api-auth.setStaffSessionOverrideForTests` 模拟登录态（非真实 cookie，不依赖 DB）。

覆盖：

| 场景 | 路由 | 期望 |
|---|---|---|
| 未登录 | products POST、stocktake POST、app-config PUT、product-categories POST、material-categories PUT | 401 |
| IT_ADMIN | 同上写 API | 403 |
| FLORIST → cms:write | products POST | 403 |
| STORE_OPERATOR → wms:write | stocktake POST | 403 |
| WAREHOUSE_MANAGER → cms:write | app-config PUT | 403 |
| STORE_ADMIN | CMS/WMS 写 API | 非 401/403（可 400 等业务错误） |
| WAREHOUSE_MANAGER | stocktake POST、material-categories PUT | 非 401/403 |

410 stub 同样覆盖 401 / 403 / 410 路径。

### 410 deprecated stub 权限一致化（Batch A.2 已修复）

| Route | Method | Permission | 有权限时 |
|---|---|---|---|
| `/api/admin/wms/bom` | GET | `wms:read` | 410 |
| `/api/admin/wms/bom` | POST | `wms:write` | 410 |
| `/api/admin/products/bom` | POST | `wms:write` | 410 |
| `/api/admin/products/[id]/bom` | PUT | `wms:write` | 410 |

规则：**先 `requirePermission`，再返回 410**；无权限 403，未登录 401。

### 静态 guard

脚本：`npm run check:admin-api-permissions`（亦合并进 `smoke:permission-matrix`）

- 扫描 `src/app/api/admin/**/route.ts`
- 含本地 `export async function GET|POST|PUT|PATCH|DELETE` 的文件必须出现 `requirePermission`
- **白名单**（re-export only，权限在目标 route）：
  - `categories/route.ts` → `product-categories/route.ts`
  - `categories/[id]/route.ts` → `product-categories/[id]/route.ts`

---

## 角色边界（smoke 验证）

| 角色 | CMS 写 | WMS 写 | 业务读 | 说明 |
|---|---|---|---|---|
| STORE_ADMIN | ✅ | ✅ | ✅ | 不受影响 |
| WAREHOUSE_MANAGER | ❌ | ✅ | ✅ | WMS 能力保留 |
| STORE_OPERATOR | ✅ | ❌ | ✅ | CMS 写保留 |
| FLORIST | ❌ | ❌ | 部分 | `orders:write` + `wms:read` |
| IT_ADMIN | ❌ | ❌ | ❌ | 仅 `staff:manage` |

---

## 测试

```bash
npm run test:permission-invariants
npm run smoke:permission-matrix      # 含 check:admin-api-permissions
npm run check:admin-api-permissions  # 单独跑静态 guard
npm run smoke:admin-api-http-permissions
```

`smoke:permission-matrix` 会：

1. 静态检查 Batch A 路由文件是否包含预期 `requirePermission("…")`。
2. 断言低权限角色不具备关键写权限及 IT_ADMIN 业务隔离。
3. 全量扫描 `/api/admin/**/route.ts` 静态 guard。

`smoke:admin-api-http-permissions` 会：

1. 未登录 / IT_ADMIN / 低权限 / 合法角色 的 handler 层 401/403 断言。
2. 410 stub 先鉴权再 410 的行为断言。
