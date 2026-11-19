import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import nextConfig from "../../../next.config";
import { policyPathForFallback } from "@/proxy";
import {
  LEGACY_WMS_FALLBACK_REWRITES,
  LEGACY_WMS_ROUTE_TARGETS,
  legacyWmsFallbackRewrites,
  legacyWmsRedirects,
} from "./legacy-wms-routes";

type TestCase = { name: string; run: () => void | Promise<void> };
const testCases: TestCase[] = [];

/**
 * Run assertions in-process. `node:test` prints a `skipped 0` summary that the
 * project's integration runner treats as a reported skip, so this file keeps
 * every assertion in a minimal local harness instead of weakening the runner.
 */
function test(name: string, run: () => void | Promise<void>): void {
  testCases.push({ name, run });
}

/** Works from the source file and from a temporary test bundle. */
function findAppRoot(start: string): string {
  let current = start;
  while (!existsSync(resolve(current, "package.json"))) {
    const parent = dirname(current);
    assert.notEqual(parent, current, "could not locate the app root (package.json)");
    current = parent;
  }
  return current;
}

const appRoot = findAppRoot(dirname(fileURLToPath(import.meta.url)));
const v2AppDir = resolve(appRoot, "src/app/v2");
const v1AppDir = resolve(appRoot, "src/app");

function pageFile(root: string, pathname: string): string {
  const segments = pathname.split("/").filter(Boolean);
  return resolve(root, ...segments, "page.tsx");
}

function assertPage(root: string, pathname: string): void {
  const file = pageFile(root, pathname);
  assert.ok(existsSync(file), `missing page for ${pathname}: ${file}`);
}

/**
 * The exact first-phase WMS entries from
 * docs/flower-studio-2.0-v1-v2-gap-matrix.md "V1 页面入口覆盖核对", plus the
 * `/admin/* -> /wms/*` aliases that predate the cutover. This record is
 * intentionally independent of the implementation so that adding, removing or
 * re-pointing a rule fails the test.
 *
 * `/wms/crm*` and `/cms*` are deliberately absent: they stay on V1.
 */
const EXPECTED_WMS_TARGETS = [
  ["/admin", "/v2"],
  ["/admin/staff-users", "/v2/staff"],
  ["/admin/dashboard", "/v2"],
  ["/admin/inventory", "/v2/inventory"],
  ["/admin/inventory/:id", "/v2/inventory/:id"],
  ["/admin/orders", "/v2/orders"],
  ["/admin/batches", "/v2/operations"],
  ["/admin/wastage", "/v2/operations"],
  ["/wms", "/v2"],
  ["/wms/dashboard", "/v2"],
  ["/wms/reports", "/v2/reports"],
  ["/wms/setup", "/v2/setup"],
  ["/wms/data-quality", "/v2/data-quality"],
  ["/wms/system-health", "/v2/system-health"],
  ["/wms/audit-logs", "/v2/audit"],
  ["/wms/inventory", "/v2/inventory"],
  ["/wms/inventory/:id", "/v2/inventory/:id"],
  ["/wms/operations", "/v2/operations"],
  ["/wms/purchase-orders", "/v2/purchase-orders"],
  ["/wms/suppliers", "/v2/suppliers"],
  ["/wms/wiki", "/v2/materials"],
  ["/wms/master-parts", "/v2/materials"],
  ["/wms/material-categories", "/v2/material-categories"],
  ["/wms/recipes", "/v2/recipes"],
  ["/wms/packaging-kits", "/v2/packaging-kits"],
  ["/wms/orders", "/v2/orders"],
  ["/wms/batches", "/v2/operations"],
  ["/wms/wastage", "/v2/operations"],
  ["/wms/bom", "/v2/recipes"],
] as const;

/**
 * Minimal matcher for the source shapes actually used by next.config.ts:
 * literal segments, one `:param` segment, or a trailing `:path*`.
 */
function matchesSource(source: string, pathname: string): boolean {
  const sourceSegments = source.split("/").filter(Boolean);
  const pathSegments = pathname.split("/").filter(Boolean);

  for (let index = 0; index < sourceSegments.length; index += 1) {
    const segment = sourceSegments[index];
    assert.ok(segment, `empty segment in source ${source}`);

    if (segment === ":path*") {
      assert.equal(index, sourceSegments.length - 1, `:path* must be last in ${source}`);
      return true;
    }
    if (segment.startsWith(":")) {
      if (pathSegments[index] === undefined) return false;
      continue;
    }
    if (segment !== pathSegments[index]) return false;
  }

  return sourceSegments.length === pathSegments.length;
}

/** Resolve a `:id` / `:path*` destination the way Next.js does after a match. */
function substituteDestination(
  source: string,
  destination: string,
  pathname: string,
): string {
  const sourceSegments = source.split("/").filter(Boolean);
  const pathSegments = pathname.split("/").filter(Boolean);
  const params = new Map<string, string>();

  for (let index = 0; index < sourceSegments.length; index += 1) {
    const segment = sourceSegments[index];
    assert.ok(segment, `empty segment in source ${source}`);
    if (segment === ":path*") {
      params.set("path", pathSegments.slice(index).join("/"));
      break;
    }
    if (segment.startsWith(":")) {
      params.set(segment.slice(1), pathSegments[index] ?? "");
    }
  }

  return destination.replace(/:([A-Za-z0-9_]+)\*?/g, (_match, name: string) => {
    assert.ok(params.has(name), `${source} does not capture :${name}`);
    return params.get(name) ?? "";
  });
}

/** Return the static page.tsx that backs a destination pattern. */
function staticV2PageFile(destination: string): string {
  const [pathname] = destination.split(/[?#]/);
  assert.ok(pathname, `destination has no pathname: ${destination}`);
  const segments = pathname.split("/").filter(Boolean);
  assert.equal(segments[0], "v2", `destination must stay under /v2: ${destination}`);
  const staticSegments = segments.slice(1).filter((segment) => !segment.startsWith(":"));
  return resolve(v2AppDir, ...staticSegments, "page.tsx");
}

test("exact first-phase WMS cutover map (gap matrix plus admin aliases)", () => {
  const actual = new Map<string, string>(
    LEGACY_WMS_ROUTE_TARGETS.map(({ source, destination }) => [source, destination] as const),
  );

  assert.equal(actual.size, LEGACY_WMS_ROUTE_TARGETS.length, "duplicate mapping source");
  assert.equal(
    actual.size,
    EXPECTED_WMS_TARGETS.length,
    `expected ${EXPECTED_WMS_TARGETS.length} rules, found ${actual.size}`,
  );

  for (const [source, destination] of EXPECTED_WMS_TARGETS) {
    assert.equal(actual.get(source), destination, `unexpected destination for ${source}`);
  }

  assert.deepEqual(
    [...actual.keys()].sort(),
    EXPECTED_WMS_TARGETS.map(([source]) => source).sort(),
    "the map must not contain extra or missing sources",
  );

  for (const { source, destination } of LEGACY_WMS_ROUTE_TARGETS) {
    assert.ok(
      destination === "/v2" || destination.startsWith("/v2/"),
      `${source} must land on a V2 page, got ${destination}`,
    );
    assert.ok(!source.includes("?") && !destination.includes("?"), `${source} must not bake a query`);
  }
});

test("every cutover redirect is a temporary 307 (reversible rollback)", () => {
  const redirects = legacyWmsRedirects();
  assert.equal(redirects.length, LEGACY_WMS_ROUTE_TARGETS.length);

  for (const redirect of redirects) {
    assert.equal(
      redirect.permanent,
      false,
      `${redirect.source} must use 307 (permanent:false), not a cached 308`,
    );
  }
});

test("every destination is a real V2 page.tsx (dynamic inventory parent included)", () => {
  const destinations = [...new Set(LEGACY_WMS_ROUTE_TARGETS.map(({ destination }) => destination))];

  for (const destination of destinations) {
    const file = staticV2PageFile(destination);
    assert.ok(existsSync(file), `${destination}: missing ${file}`);
  }

  const dynamicDestinations = destinations.filter((destination) =>
    destination.split("/").some((segment) => segment.startsWith(":")),
  );
  assert.deepEqual(dynamicDestinations, ["/v2/inventory/:id"]);
  assertPage(v2AppDir, "inventory/[id]");
});

test("cutover never captures /wms/crm* or /cms* (they stay on V1)", async () => {
  const configured = await nextConfig.redirects?.();
  assert.ok(configured, "next.config.ts must return redirects");

  for (const { source } of LEGACY_WMS_ROUTE_TARGETS) {
    assert.ok(source.startsWith("/wms") || source.startsWith("/admin"), source);
    assert.ok(!source.startsWith("/cms"), `CMS route must stay on V1: ${source}`);
    assert.ok(!source.startsWith("/wms/crm"), `CRM route must stay on V1: ${source}`);
  }

  const staysOnV1 = [
    "/wms/crm",
    "/wms/crm/customers",
    "/wms/crm/customers/customer-1",
    "/wms/crm/reminders",
    "/cms",
    "/cms/products",
    "/cms/products/product-1",
    "/cms/product-categories",
    "/cms/banner",
    "/cms/carousel",
    "/cms/marketing",
    "/cms/recommendations",
    "/cms/categories",
  ];

  for (const pathname of staysOnV1) {
    for (const rule of configured.filter(({ source }) => matchesSource(source, pathname))) {
      assert.ok(
        rule.destination === "/cms" || rule.destination.startsWith("/cms/"),
        `${pathname} is captured by ${rule.source} -> ${rule.destination}; CMS/CRM must stay on V1`,
      );
    }
  }

  // CMS aliases from /admin stay CMS, never V2.
  assert.ok(
    configured.some(
      ({ source, destination }) => source === "/admin/products" && destination === "/cms/products",
    ),
    "/admin/products must stay on CMS",
  );
  assert.ok(
    configured.some(
      ({ source, destination }) =>
        source === "/admin/products/:path*" && destination === "/cms/products/:path*",
    ),
    "/admin/products/:path* must stay on CMS",
  );

  // The V1 pages backing those routes are real, so "stays on V1" is not a 404.
  for (const pathname of [
    "/wms/crm",
    "/wms/crm/customers",
    "/cms",
    "/cms/products",
    "/cms/products/[id]",
    "/cms/carousel",
    "/cms/product-categories",
  ]) {
    assertPage(v1AppDir, pathname);
  }
});

test("sources are unique and exact inventory rules precede dynamic ones", () => {
  const redirectSources = LEGACY_WMS_ROUTE_TARGETS.map(({ source }) => source);
  assert.equal(new Set(redirectSources).size, redirectSources.length, "duplicate redirect source");

  const fallbackSources = LEGACY_WMS_FALLBACK_REWRITES.map(({ source }) => source);
  assert.equal(new Set(fallbackSources).size, fallbackSources.length, "duplicate rewrite source");

  const redirects = legacyWmsRedirects();
  assert.ok(
    redirects.every(({ source }) => !source.includes(":path*")),
    "cutover redirects must not use catch-all inventory segments",
  );

  const exactInventory = redirects.find(({ source }) => source === "/wms/inventory");
  const dynamicInventory = redirects.find(({ source }) => source === "/wms/inventory/:id");
  assert.ok(exactInventory);
  assert.ok(dynamicInventory);
  assert.ok(
    redirects.indexOf(exactInventory) < redirects.indexOf(dynamicInventory),
    "exact /wms/inventory must precede /wms/inventory/:id",
  );

  const exactAdminInventory = redirects.find(({ source }) => source === "/admin/inventory");
  const dynamicAdminInventory = redirects.find(
    ({ source }) => source === "/admin/inventory/:id",
  );
  assert.ok(exactAdminInventory);
  assert.ok(dynamicAdminInventory);
  assert.ok(
    redirects.indexOf(exactAdminInventory) < redirects.indexOf(dynamicAdminInventory),
    "exact /admin/inventory must precede /admin/inventory/:id",
  );
});

test("configured redirect graph is one hop deep, including /admin aliases", async () => {
  const redirects = await nextConfig.redirects?.();
  assert.ok(redirects, "next.config.ts must return redirects");

  const sources = new Set(redirects.map(({ source }) => source));

  for (const { source, destination } of redirects) {
    assert.ok(
      !sources.has(destination),
      `${source} -> ${destination} would be a second redirect (chain)`,
    );
    assert.ok(!destination.startsWith("/wms"), `${source} must not fall back to V1 WMS`);
    assert.ok(!destination.startsWith("/legacy"), `${source} must not enter the fallback`);
    assert.ok(
      destination === "/v2" ||
        destination.startsWith("/v2/") ||
        destination === "/cms" ||
        destination.startsWith("/cms/"),
      `${source} -> ${destination} is not a final V2/V1-CMS destination`,
    );
  }

  // Pre-cutover `/admin/* -> /wms/*` aliases are now direct `/admin/* -> /v2/*`.
  const adminWmsAliases = redirects.filter(
    ({ source }) =>
      source.startsWith("/admin") &&
      source !== "/admin/products" &&
      !source.startsWith("/admin/products/") &&
      source !== "/admin/cms/banner",
  );
  assert.ok(adminWmsAliases.length >= 8, "expected the legacy admin WMS aliases");
  for (const { source, destination } of adminWmsAliases) {
    assert.ok(
      destination === "/v2" || destination.startsWith("/v2/"),
      `${source} -> ${destination} must not route through /wms to avoid a chain`,
    );
  }
});

test("fallback rewrites are beforeFiles, target V1 pages, and are not intercepted", async () => {
  const configuredRedirects = await nextConfig.redirects?.();
  assert.ok(configuredRedirects, "next.config.ts must return redirects");

  const fallbackPaths = [
    "/legacy/wms",
    "/legacy/wms/dashboard",
    "/legacy/wms/orders",
    "/legacy/wms/inventory/material-1",
    "/legacy/wms/crm/customers/customer-1",
  ];
  for (const pathname of fallbackPaths) {
    for (const rule of configuredRedirects) {
      assert.ok(
        !matchesSource(rule.source, pathname),
        `redirect ${rule.source} would intercept fallback path ${pathname}`,
      );
    }
  }

  assert.ok(
    configuredRedirects.every(({ source }) => !source.startsWith("/legacy")),
    "redirects must not capture the /legacy fallback entry",
  );

  assert.deepEqual(legacyWmsFallbackRewrites(), [
    // Not `/wms`: that index redirects to a role home, which the cutover sends
    // to V2, so the fallback root must land on a real V1 content page.
    { source: "/legacy/wms", destination: "/wms/dashboard" },
    { source: "/legacy/wms/:path*", destination: "/wms/:path*" },
  ]);

  for (const rewrite of LEGACY_WMS_FALLBACK_REWRITES) {
    assert.ok(rewrite.source.startsWith("/legacy/wms"), rewrite.source);
    assert.ok(!rewrite.source.includes("?") && !rewrite.destination.includes("?"));
  }

  // The rewrite destination is the real V1 route tree, not `/legacy` or `/v2`.
  assertPage(v1AppDir, "wms");
  assertPage(v1AppDir, "wms/dashboard");
  assertPage(v1AppDir, "wms/orders");
  assertPage(v1AppDir, "wms/inventory/[id]");
  assertPage(v1AppDir, "wms/crm");
  assertPage(v1AppDir, "wms/crm/customers");

  const deepRewrite = LEGACY_WMS_FALLBACK_REWRITES.find(
    ({ source }) => source === "/legacy/wms/:path*",
  );
  assert.ok(deepRewrite);
  assert.equal(
    substituteDestination(
      deepRewrite.source,
      deepRewrite.destination,
      "/legacy/wms/inventory/material-1",
    ),
    "/wms/inventory/material-1",
  );
});

test("legacy fallback policy path maps to the effective V1 WMS path", () => {
  assert.equal(policyPathForFallback("/legacy/wms"), "/wms");
  assert.equal(policyPathForFallback("/legacy/wms/orders"), "/wms/orders");
  assert.equal(
    policyPathForFallback("/legacy/wms/inventory/123"),
    "/wms/inventory/123",
  );
  assert.equal(
    policyPathForFallback("/legacy/wms/crm/customers/customer-1"),
    "/wms/crm/customers/customer-1",
  );
  assert.equal(policyPathForFallback("/v2/orders"), "/v2/orders");
  assert.equal(policyPathForFallback("/legacy/cms"), "/legacy/cms");
  assert.equal(policyPathForFallback("/"), "/");
});

test("dynamic inventory uses one :id segment and does not swallow deeper paths", () => {
  const redirects = legacyWmsRedirects();
  const dynamic = redirects.find(({ source }) => source === "/wms/inventory/:id");
  assert.ok(dynamic);
  assert.equal(dynamic.destination, "/v2/inventory/:id");

  assert.ok(matchesSource("/wms/inventory/:id", "/wms/inventory/material-1"));
  assert.ok(!matchesSource("/wms/inventory/:id", "/wms/inventory"));
  assert.ok(
    !matchesSource("/wms/inventory/:id", "/wms/inventory/material-1/batches"),
    "a deeper legacy path must not be rewritten onto a non-existent V2 page",
  );
  assert.equal(
    substituteDestination("/wms/inventory/:id", "/v2/inventory/:id", "/wms/inventory/material-1"),
    "/v2/inventory/material-1",
  );

  const adminDynamic = redirects.find(({ source }) => source === "/admin/inventory/:id");
  assert.ok(adminDynamic);
  assert.equal(adminDynamic.destination, "/v2/inventory/:id");
  assert.ok(!matchesSource("/admin/inventory/:id", "/admin/inventory/material-1/batches"));
});

test("redirects preserve query strings: no baked query and dynamic params forwarded", () => {
  const redirects = legacyWmsRedirects();

  for (const { source, destination, permanent } of redirects) {
    assert.equal(permanent, false, `${source} must be 307`);
    assert.ok(!source.includes("?"), `${source} must not bake in a query string`);
    assert.ok(!destination.includes("?"), `${destination} must not replace the request query`);

    for (const match of source.matchAll(/:([A-Za-z0-9_]+)\*?/g)) {
      const name = match[1];
      assert.ok(name);
      assert.ok(destination.includes(`:${name}`), `${source} -> ${destination} drops :${name}`);
    }
  }

  // Next.js forwards the request search string to the redirect Location.
  const orders = redirects.find(({ source }) => source === "/wms/orders");
  assert.ok(orders);
  assert.equal(`${orders.destination}?status=PAID&page=2`, "/v2/orders?status=PAID&page=2");

  const inventory = redirects.find(({ source }) => source === "/wms/inventory/:id");
  assert.ok(inventory);
  const resolved = substituteDestination(
    inventory.source,
    inventory.destination,
    "/wms/inventory/material-1",
  );
  assert.equal(`${resolved}?tab=batches`, "/v2/inventory/material-1?tab=batches");
});

test("next.config.ts wires redirects plus beforeFiles rewrites and keeps CMS on V1", async () => {
  const expectedRedirects = legacyWmsRedirects();
  const cmsRedirects = [
    { source: "/admin/products", destination: "/cms/products", permanent: false },
    { source: "/admin/products/:path*", destination: "/cms/products/:path*", permanent: false },
    { source: "/admin/cms/banner", destination: "/cms/banner", permanent: false },
    { source: "/cms/carousel", destination: "/cms/banner", permanent: false },
  ];

  const configured = await nextConfig.redirects?.();
  assert.ok(configured, "next.config.ts must return redirects");
  assert.deepEqual(configured, [...expectedRedirects, ...cmsRedirects]);

  const configuredSources = configured.map(({ source }) => source);
  assert.equal(
    new Set(configuredSources).size,
    configuredSources.length,
    "next.config.ts has duplicate redirect sources",
  );
  for (const redirect of configured) {
    assert.equal(redirect.permanent, false, `${redirect.source} must be 307`);
  }

  const bySource = new Map(configured.map(({ source, destination }) => [source, destination]));
  for (const { source, destination } of expectedRedirects) {
    assert.equal(bySource.get(source), destination, `next.config.ts missing ${source}`);
  }
  assert.equal(bySource.get("/admin/products"), "/cms/products");
  assert.equal(bySource.get("/admin/products/:path*"), "/cms/products/:path*");
  assert.equal(bySource.get("/admin/cms/banner"), "/cms/banner");
  assert.equal(bySource.get("/cms/carousel"), "/cms/banner");

  // CMS destinations are real V1 pages, not V2 pages and not 404s.
  assertPage(v1AppDir, "cms/products");
  assertPage(v1AppDir, "cms/products/[id]");
  assertPage(v1AppDir, "cms/banner");

  const rewrites = await nextConfig.rewrites?.();
  assert.ok(rewrites && !Array.isArray(rewrites), "next.config.ts must use named rewrites");
  assert.deepEqual(rewrites.beforeFiles, legacyWmsFallbackRewrites());
  assert.ok(
    !rewrites.afterFiles || rewrites.afterFiles.length === 0,
    "legacy fallback must be beforeFiles, not afterFiles",
  );
  assert.ok(
    !rewrites.fallback || rewrites.fallback.length === 0,
    "legacy fallback must not use the 404 fallback phase",
  );
});

async function runAll(): Promise<void> {
  for (const { name, run } of testCases) {
    await run();
    console.log(`ok - ${name}`);
  }
  console.log(`${testCases.length} legacy cutover tests passed`);
}

runAll().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
