# Sprint 22 Post-Migration Architecture Audit

> Date: 2026-06-18  
> Scope: post-migration architecture consistency audit after Sprint 22  
> Mode: read-only review; no code changes, no commits, no branch, no PR

## Context

Sprint 22 has completed:

- Added nullable `tenantId` to 13 core business tables.
- Backfilled existing data with `tenantId = "universe42"`.
- Verified no NULL `tenantId` exists for the declared Sprint 22 target tables.
- Did not introduce business logic changes, API tenant isolation, or query filtering.

This audit is not a general bug hunt. It focuses on architecture consistency and hidden risks before Sprint 23.

## Executive Summary

Sprint 22 migration and backfill are structurally consistent for the declared 13-table scope, but runtime writes currently reintroduce NULL `tenantId`. This is the main issue to fix before Sprint 23.

The second blocker is deciding whether business-table `tenantId` stores tenant slug or `Tenant.id`. Current backfill uses the literal slug `"universe42"`, while `TenantMember.tenantId` and session context use `Tenant.id`.

Product image DTOs are mostly improved after the previous audit, but Mini Program category and order snapshot responses still have raw image-value risks.

## High Risks

### 1. Runtime create paths still write `tenantId = NULL`

Affected Sprint 22 tables are nullable, so missing writes do not fail immediately. However, after `db:verify:tenant` passes, any new business write can reintroduce NULL rows.

Evidence:

- Product SPU create uses `cmsSpuCreateData(body)` without tenantId: `flower-wms-system/src/app/api/cms/products/route.ts:55`
- SKU create rows omit tenantId: `flower-wms-system/src/lib/cms-product-write.ts:30`
- Order create omits tenantId: `flower-wms-system/src/services/order-lifecycle.ts:299`
- Customer create omits tenantId: `flower-wms-system/src/services/crm.ts:249`
- Supplier create omits tenantId: `flower-wms-system/src/services/purchase.ts:655`
- PurchaseOrder create omits tenantId: `flower-wms-system/src/services/purchase.ts:728`
- Material / Batch / StockLog create omit tenantId: `flower-wms-system/src/services/wms-stock.ts:181`, `:212`, `:225`
- Recipe create omits tenantId: `flower-wms-system/src/services/recipe.ts:502`
- Banner / recommendation / home scene creates omit tenantId: `flower-wms-system/src/services/cms-banners.ts:179`, `flower-wms-system/src/services/cms-product-operations.ts:681`, `flower-wms-system/src/services/cms-home-scene-entries.ts:233`

Impact:

- Sprint 23 tenant filtering will silently hide newly created rows.
- Verification becomes point-in-time only.
- Order, inventory, purchase, CMS, and CRM data can drift immediately after migration.

Minimal suggested fix:

- Add a single default-tenant stamping helper for current single-tenant mode.
- Use it only in create paths for the 13 Sprint 22 tables.
- Do not add query isolation yet.

### 2. `tenantId` value semantics conflict with Tenant model

Evidence:

- Backfill writes literal slug: `DEFAULT_TENANT = "universe42"` in `flower-wms-system/scripts/backfill-tenant-id.ts:9`
- `TenantMember.tenantId` is a FK to `Tenant.id`, not slug: `flower-wms-system/prisma/schema.prisma:774`, `:783`
- `Tenant.slug` is separately unique: `flower-wms-system/prisma/schema.prisma:747`

Impact:

- Sprint 23 may compare business-table `tenantId = "universe42"` with session `currentTenantId = <cuid>`.
- Tenant-filtered queries would then return no rows.
- This would look like data loss even though data exists.

Minimal suggested fix:

- Freeze the convention before Sprint 23:
  - Either business-table `tenantId` stores `Tenant.id`.
  - Or session/current tenant context must expose the slug used by business tables.
- Do this before adding any tenant filters.

### 3. `FlowerWiki` is not tenant-scoped despite confirmed per-tenant boundary

Product / architecture decision:

- `FlowerWiki` is temporarily per-tenant independent, not shared platform master data.

Evidence:

- `FlowerWiki` has no `tenantId`: `flower-wms-system/prisma/schema.prisma:1141`
- `Material.wikiId` depends on `FlowerWiki`: `flower-wms-system/prisma/schema.prisma:589`
- `RecipeLine.flowerWikiId` depends on `FlowerWiki`: `flower-wms-system/prisma/schema.prisma:644`
- `PurchaseOrderLine.flowerWikiId` depends on `FlowerWiki`: `flower-wms-system/prisma/schema.prisma:338`

Impact:

- Sprint 23 cannot reliably verify same-tenant consistency for material, recipe, purchase, and FIFO inputs.
- Inventory and recipe data may remain globally coupled even after top-level tables are filtered.

Minimal suggested fix:

- Include `FlowerWiki` in the next consistency migration.
- Or explicitly document that `FlowerWiki` remains excluded until a dedicated migration.
- Do not add isolation behavior yet; only close the schema consistency gap.

### 4. Order image snapshot can leak raw objectKey to Mini Program order API

Evidence:

- Order item stores raw `sku.imageUrl`: `flower-wms-system/src/services/order-lifecycle.ts:327`
- Mini Program order API returns `snapshotImageUrl` unchanged: `flower-wms-system/src/app/api/miniprogram/orders/route.ts:47`

Impact:

- Order history can return objectKey, localhost, or `/uploads` legacy values even though product list/detail DTOs now use public image URL conversion.

Minimal suggested fix:

- Convert `snapshotImageUrl` through `toMiniprogramImageUrl` at DTO output.
- Keep database snapshot storage unchanged for now.

## Medium Risks

### 1. Product category image DTO still returns raw stored value

Evidence:

- `imageUrl: n.imageUrl` in `flower-wms-system/src/app/api/miniprogram/product-categories/route.ts:27`

Impact:

- Category images can leak objectKey or legacy image paths to Mini Program.

Minimal suggested fix:

- Wrap with `toMiniprogramImageUrl(n.imageUrl)` in the category DTO mapper.

### 2. Tenant-owned satellite models were not included in Sprint 22 scripts

Evidence:

- No tenantId on `ProductCategory`, `ProductCategoryRelation`: `flower-wms-system/prisma/schema.prisma:207`, `:231`
- No tenantId on `OrderItem`, `OrderCostSnapshot`: `flower-wms-system/prisma/schema.prisma:904`, `:928`
- No tenantId on `RecipeLine`, `PurchaseOrderLine`: `flower-wms-system/prisma/schema.prisma:335`, `:641`
- No tenantId on `AppConfig`, `AuditLog`: `flower-wms-system/prisma/schema.prisma:1096`, `:1111`

Impact:

- Parent-level filtering can work later, but direct queries, reports, config reads, and audit views may lose tenant context.
- AppConfig and AuditLog are especially likely to need explicit tenant context in Sprint 23+.

Minimal suggested fix:

- For Sprint 23 readiness, document which models are parent-derived versus explicitly scoped.
- Add verification coverage only for models intentionally given tenantId.
- Do not expand tenant isolation behavior yet.

### 3. Query paths will need careful tenant propagation once filtering starts

Evidence:

- FIFO selects batches only by `materialId`: `flower-wms-system/src/services/fifo.ts:31`
- Payment/FIFO order lookup uses only order id/status/user: `flower-wms-system/src/services/order-fifo.ts:179`
- CRM customer matching is global by miniProgramUserId/openid/phone: `flower-wms-system/src/services/crm.ts:211`, `:216`, `:221`
- Purchase receive resolves material by global `wikiId`: `flower-wms-system/src/services/purchase.ts:928`

Impact:

- These are not current regressions, because Sprint 22 intentionally did not add query isolation.
- They are likely Sprint 23 breaking points once tenant filters are introduced.

Minimal suggested fix:

- Add tenant consistency assertions at these transaction boundaries when Sprint 23 starts.
- Do not add filtering yet as part of this audit.

### 4. Migration has no DB-level guard against future NULL writes

Evidence:

- Migration only adds nullable columns, no defaults, indexes, foreign keys, or NOT NULL constraints: `flower-wms-system/prisma/migrations/20260617120000_add_tenant_id_nullable/migration.sql:3`

Impact:

- This is expected for Sprint 22, but verification is point-in-time.
- New writes can invalidate the verified state.

Minimal suggested fix:

- Add a read-only CI/check script step that fails if any declared Sprint 22 table has NULL tenantId after tests/smokes.
- Keep DB schema nullable until Sprint 23/24 is ready.

## Low Risks / Confirmations

### 1. Product Mini Program image DTOs are mostly corrected

Evidence:

- Product mapper uses `toMiniprogramImageUrl`: `flower-wms-system/src/lib/wechat-product-mapper.ts:124`, `:156`, `:193`
- Shared DTO helper exists: `flower-wms-system/src/lib/miniprogram-image-dto.ts:15`

Remaining risk:

- Product category and order snapshot DTOs still need the same treatment.

### 2. Refund behavior aligns with product decision

Product decision:

- Refund cancellation must not imply automatic physical flower/material return.
- Physical return must be explicit.

Evidence:

- Refund no longer calls physical batch restore by default: `flower-wms-system/src/services/order-lifecycle.ts:466`, `:478`
- Test asserts no physical restore: `flower-wms-system/src/services/refund-stock-policy.test.ts:44`

Remaining risk:

- Order-level `tenantId` is still not written on new orders.

### 3. Backfill and verify scripts are idempotent for declared 13 tables

Evidence:

- Backfill loops on `where: { tenantId: null }`: `flower-wms-system/scripts/backfill-tenant-id.ts:18`
- Verify checks the same target list: `flower-wms-system/scripts/verify-tenant-id.ts:15`

Limitation:

- They only cover the 13 Sprint 22 migration tables.

## Migration & Backfill Review

Declared Sprint 22 migration tables:

1. `product_spus`
2. `product_skus`
3. `orders`
4. `customers`
5. `suppliers`
6. `materials`
7. `batches`
8. `stock_logs`
9. `recipes`
10. `purchase_orders`
11. `banners`
12. `cms_recommendation_slots`
13. `cms_home_scene_entries`

Findings:

- Migration is simple and reversible in principle because it only adds nullable text columns.
- Backfill is idempotent for the declared 13-table scope.
- Verify is aligned with the backfill target list.
- Runtime create paths are the main remaining source of NULL reintroduction.
- The scripts do not cover models outside the declared 13-table scope.

## Business Logic Safety

Orders:

- TenantId introduction did not change order creation behavior directly.
- However, new orders currently omit tenantId and can become invisible under Sprint 23 filters.

Inventory / FIFO:

- TenantId introduction did not change FIFO deduction logic directly.
- Batch and StockLog create paths currently omit tenantId.
- FIFO will need tenant context propagated from order/material in Sprint 23.

Refunds:

- Refund physical-stock behavior appears corrected and aligned with product decision.
- No implicit physical return is performed by `refundPaidOrder`.

Purchasing:

- PurchaseOrder, generated Material, Batch, and StockLog writes currently omit tenantId.
- Purchase receive resolves Material globally by `wikiId`; this is a Sprint 23 consistency boundary.

CMS:

- Product, SKU, Banner, RecommendationSlot, and HomeSceneEntry creation currently omit tenantId.
- Product DTO image chain is mostly fixed; category image DTO remains incomplete.

## Minimal Fix Plan

1. Resolve tenant value convention before Sprint 23.
   - Decide whether business `tenantId` stores `Tenant.id` or `Tenant.slug`.
   - Align session/current tenant context with that decision.

2. Stamp tenantId on all 13 Sprint 22 runtime create paths.
   - Current single-tenant mode can stamp the default tenant.
   - Keep query behavior unchanged.

3. Add post-smoke NULL verification.
   - Run `npm run db:verify:tenant` after business smoke tests that create data.

4. Fix DTO image leaks.
   - Convert Mini Program category `imageUrl`.
   - Convert Mini Program order `snapshotImageUrl`.

5. Clarify satellite model scope.
   - Document which child/config/audit models are parent-derived versus explicitly tenant-scoped.
   - Include `FlowerWiki` in the next schema consistency decision because product boundary says it is per-tenant independent.

## Non-Recommendations For This Phase

Per review constraints, this audit does not recommend:

- Adding full tenant query isolation yet.
- Refactoring the service layer around tenant-aware repositories.
- Introducing new product features.
- Changing business workflows.
- Changing tenant-scoped unique constraints in the same step.

## Bottom Line

Sprint 22 is a valid nullable-schema/backfill step, but it is not yet stable for ongoing writes. Before Sprint 23 query filtering starts, the repository needs a minimal tenant stamping pass for the 13 migrated tables and a clear decision on whether business `tenantId` means Tenant slug or Tenant id.
