/**
 * Route Handler contract for the protected metrics entrypoint (E3.4).
 * Discovered by the V2 integration runner (`src/v2/**\/*.test.ts`).
 *
 * Uses the existing in-process staff-session override so the assertion is about
 * the route contract (401/403/200, content type, no-store, safe body) instead of
 * a real login; no database access is involved in rendering the snapshot.
 */
import assert from "node:assert/strict";
import { GET } from "../app/api/admin/system/metrics/route";
import {
  clearStaffSessionOverrideForTests,
  setStaffSessionOverrideForTests,
} from "../lib/api-auth";
import { STAFF_FIXTURES } from "../lib/admin-api-http-test-harness";
import {
  recordHttpRequest,
  resetMetricsForTests,
} from "../lib/observability/metrics";

async function assertJson(res: Response, status: number, label: string): Promise<void> {
  assert.equal(res.status, status, `${label}: expected HTTP ${status}, got ${res.status}`);
  const body = (await res.json()) as { success?: boolean; error?: string };
  assert.equal(body.success, false, `${label}: expected a JSON error envelope`);
}

async function main(): Promise<void> {
  try {
    // 1) Not authenticated -> existing 401 JSON contract. A `null` override keeps the
    // assertion at the handler boundary instead of calling auth() outside a request scope.
    setStaffSessionOverrideForTests(null);
    await assertJson(await GET(), 401, "unauthenticated");

    // 2) IT admin is business-blind -> existing 403 JSON contract.
    setStaffSessionOverrideForTests(STAFF_FIXTURES.itAdmin);
    await assertJson(await GET(), 403, "it-admin");

    // 3) A business role passes -> Prometheus text, no-store, safe body.
    resetMetricsForTests();
    recordHttpRequest({
      method: "GET",
      route: "/api/health",
      status: 200,
      durationMs: 12,
    });
    setStaffSessionOverrideForTests(STAFF_FIXTURES.warehouseManager);
    const response = await GET();
    assert.equal(response.status, 200);
    assert.match(
      response.headers.get("content-type") ?? "",
      /^text\/plain; version=0\.0\.4/,
    );
    assert.equal(response.headers.get("cache-control"), "no-store");
    const body = await response.text();
    assert.ok(
      body.includes("wms_http_requests_total"),
      "body should contain the Prometheus counter",
    );
    assert.ok(
      body.includes('route="/api/health"'),
      "body should contain the low-cardinality route label",
    );
    // The public snapshot must not leak database identity, credentials or DSNs.
    for (const forbidden of ["DATABASE_URL", "postgres://", "postgresql://", "password"]) {
      assert.ok(!body.includes(forbidden), `body must not contain ${forbidden}`);
    }

    // 4) Empty snapshot still renders a valid 200 text response (no partial JSON).
    resetMetricsForTests();
    const empty = await GET();
    assert.equal(empty.status, 200);
    assert.match(empty.headers.get("content-type") ?? "", /^text\/plain/);
    assert.equal(await empty.text(), "");

    console.log("v2 system metrics route tests passed");
  } finally {
    clearStaffSessionOverrideForTests();
    resetMetricsForTests();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
