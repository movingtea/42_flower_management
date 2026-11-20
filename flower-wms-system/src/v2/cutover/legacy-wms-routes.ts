/**
 * Sprint 3 / S3-A: V1 -> V2 WMS cutover compatibility map.
 *
 * This module is intentionally pure data + builders: it must be importable by
 * `next.config.ts` (which Next compiles outside the app graph) and by node:test
 * without touching the database, the filesystem or the request lifecycle.
 *
 * Scope: first-phase WMS pages only. These V1 areas deliberately stay on V1 and
 * are NOT redirected by this module:
 *   - `/wms/crm` and every CRM child route (CRM is a later phase);
 *   - `/cms`, `/cms/*`, and CMS aliases such as `/admin/products`
 *     (CMS is a later phase; `next.config.ts` keeps those aliases on `/cms/*`).
 *
 * Every redirect destination is a final, real V2 page. No redirect points at
 * `/wms`, `/legacy/*`, or another redirect source, so Next.js never emits a
 * redirect chain and a 307 client can always roll back to V1.
 */

export type LegacyWmsRouteTarget = {
  /** Incoming V1 path pattern, path-to-regexp syntax supported by Next.js. */
  readonly source: string;
  /** Final V2 path pattern. Query strings are forwarded by Next.js automatically. */
  readonly destination: string;
};

/**
 * First-phase WMS entry points from the gap matrix section
 * "V1 页面入口覆盖核对", plus the `/admin/* -> /wms/*` aliases that existed
 * before this cutover.
 *
 * Those admin aliases are folded in and point straight at V2. Leaving them as
 * `/admin/* -> /wms/*` would produce `/admin/* -> /wms/* -> /v2/*` chains now
 * that `/wms/*` redirects.
 *
 * Exact paths are listed before their dynamic variants for readability and for
 * a deterministic matcher; the test enforces that order for inventory.
 */
export const LEGACY_WMS_ROUTE_TARGETS = [
  // Admin aliases inherited from the pre-cutover config.
  { source: "/admin", destination: "/v2" },
  { source: "/admin/staff-users", destination: "/v2/staff" },
  { source: "/admin/dashboard", destination: "/v2" },
  { source: "/admin/inventory", destination: "/v2/inventory" },
  { source: "/admin/inventory/:id", destination: "/v2/inventory/:id" },
  { source: "/admin/orders", destination: "/v2/orders" },
  { source: "/admin/batches", destination: "/v2/operations" },
  { source: "/admin/wastage", destination: "/v2/operations" },

  // WMS pages: gap matrix "V1 页面入口覆盖核对".
  // `/v2` is the V2 dashboard ("经营概览").
  { source: "/wms", destination: "/v2" },
  { source: "/wms/dashboard", destination: "/v2" },
  { source: "/wms/reports", destination: "/v2/reports" },
  { source: "/wms/setup", destination: "/v2/setup" },
  { source: "/wms/data-quality", destination: "/v2/data-quality" },
  { source: "/wms/system-health", destination: "/v2/system-health" },
  { source: "/wms/audit-logs", destination: "/v2/audit" },
  { source: "/wms/inventory", destination: "/v2/inventory" },
  // V1 and V2 both use one `[id]` segment for an inventory detail. `:id`
  // deliberately does not match deeper paths (which have no page), so a legacy
  // URL can never be rewritten onto a 404.
  { source: "/wms/inventory/:id", destination: "/v2/inventory/:id" },
  { source: "/wms/operations", destination: "/v2/operations" },
  { source: "/wms/purchase-orders", destination: "/v2/purchase-orders" },
  { source: "/wms/suppliers", destination: "/v2/suppliers" },
  // V2 split the material master into a flower page and a consumable page:
  // V1 FlowerWiki (flowers/foliage) maps to `/v2/materials`, while the V1
  // generic master-parts list (packaging/consumables/other) maps to
  // `/v2/consumables`. Both are backed by the same V2 `Material` model.
  { source: "/wms/wiki", destination: "/v2/materials" },
  { source: "/wms/master-parts", destination: "/v2/consumables" },
  { source: "/wms/material-categories", destination: "/v2/material-categories" },
  { source: "/wms/recipes", destination: "/v2/recipes" },
  { source: "/wms/packaging-kits", destination: "/v2/packaging-kits" },
  { source: "/wms/orders", destination: "/v2/orders" },
  // V2 has no standalone batch/wastage route: both live in `/v2/operations`.
  { source: "/wms/batches", destination: "/v2/operations" },
  { source: "/wms/wastage", destination: "/v2/operations" },
  // V1 BOM is the V2 standard recipe.
  { source: "/wms/bom", destination: "/v2/recipes" },
] as const satisfies readonly LegacyWmsRouteTarget[];

export type LegacyWmsRedirect = {
  source: string;
  destination: string;
  /** `false` => HTTP 307; `true` would be a permanently cached 308. */
  permanent: boolean;
};

/**
 * Generate `next.config.ts` redirects.
 *
 * `permanent: false` is HTTP 307, deliberately temporary: the cutover is
 * reversible while the `/legacy/wms` fallback exists, so browsers must not cache
 * the redirect forever. Next.js forwards the original query string to the
 * destination (see `redirects.md`), so no rule bakes in `?`.
 */
export function legacyWmsRedirects(): LegacyWmsRedirect[] {
  return LEGACY_WMS_ROUTE_TARGETS.map(({ source, destination }) => ({
    source,
    destination,
    permanent: false,
  }));
}

export type LegacyWmsRewrite = {
  source: string;
  destination: string;
};

/**
 * Controlled short-term V1 fallback.
 *
 * These are `beforeFiles` rewrites: Next.js checks them after redirects/proxy
 * and before the filesystem, so the public `/legacy/wms...` URL is served by the
 * internal V1 `/wms...` route tree. The incoming path never matches a redirect
 * source, so the fallback is not intercepted. The URL stays `/legacy/wms...`.
 *
 * `/legacy/wms` targets the V1 dashboard, not the V1 index: the index only
 * redirects to `/wms/<role-home>`, which the cutover now redirects to V2. Deep
 * links (`/legacy/wms/orders`, ...) serve the matching V1 page directly.
 */
export const LEGACY_WMS_FALLBACK_REWRITES = [
  { source: "/legacy/wms", destination: "/wms/dashboard" },
  { source: "/legacy/wms/:path*", destination: "/wms/:path*" },
] as const satisfies readonly LegacyWmsRewrite[];

export function legacyWmsFallbackRewrites(): LegacyWmsRewrite[] {
  return LEGACY_WMS_FALLBACK_REWRITES.map(({ source, destination }) => ({
    source,
    destination,
  }));
}
