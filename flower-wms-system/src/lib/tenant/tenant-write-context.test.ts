import assert from "node:assert/strict";
import {
  DEFAULT_TENANT_ID,
  withTenant,
  withTenantMany,
} from "./tenant-write-context";

assert.equal(DEFAULT_TENANT_ID, "universe42");

const single = withTenant({ name: "test" });
assert.equal(single.tenantId, "universe42");
assert.equal(single.name, "test");

const overwritten = withTenant({ tenantId: null as unknown as string, x: 1 });
assert.equal(overwritten.tenantId, "universe42");

const many = withTenantMany([{ a: 1 }, { b: 2 }]);
assert.equal(many.length, 2);
assert.ok(many.every((row) => row.tenantId === "universe42"));

console.log("tenant-write-context.test.ts: all tests passed");
