import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as nodeModule from "node:module";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

/**
 * Run with: npx tsx src/app/v2/suppliers/actions.test.ts
 *
 * Action-layer test for the supplier write entries: capability enforcement,
 * FormData mapping, service arguments and the drawer result contract. Create
 * and update are drawer actions and return explicit results; the row-inline
 * enable/disable action keeps the URL feedback redirect until that migration.
 * The service and database invariants stay in layer-3 tests.
 */
type ServiceCall = {
  name: string;
  tx: unknown;
  scope: unknown;
  input?: unknown;
  supplierId?: unknown;
  active?: unknown;
};

type State = {
  redirect?: string;
  capability?: string;
  authDenied?: boolean;
  serviceFailure?: Error | null;
  digestFailure?: { digest: string } | null;
  serviceCalls: ServiceCall[];
};

const state: State = { serviceCalls: [] };
(globalThis as unknown as { __supplierActionTest: State }).__supplierActionTest = state;

// Next.js `redirect()` throws NEXT_REDIRECT; the action helpers catch errors but
// rethrow anything with a `digest`, so the stub records the target and returns.
const stubs: Record<string, string> = {
  "next/navigation": `export function redirect(url) { globalThis.__supplierActionTest.redirect = url; }`,
  "@/v2/auth": `export async function requireV2Store(capability) {
    const shared = globalThis.__supplierActionTest;
    shared.capability = capability;
    if (shared.authDenied) throw new Error("当前账号没有采购权限");
    return { tenantId: "tenant-1", storeId: "store-1", staffId: "staff-1" };
  }`,
  "@/v2/db": `export const v2db = { $transaction: async (fn) => fn({ __fakeTx: true }) };`,
  "../_lib/action-result": `
    export async function runV2DrawerAction(operation, fallbackMessage) {
      try {
        const message = await operation();
        return { ok: true, message: message || fallbackMessage };
      } catch (cause) {
        if (cause && typeof cause === "object" && "digest" in cause) throw cause;
        return { ok: false, error: cause instanceof Error ? cause.message : "操作失败" };
      }
    }
  `,
  "@/v2/services/master-data": `
    function record(entry) {
      const shared = globalThis.__supplierActionTest;
      shared.serviceCalls.push(entry);
      if (shared.digestFailure) throw shared.digestFailure;
      if (shared.serviceFailure) throw shared.serviceFailure;
    }
    export async function createSupplierMaster(tx, scope, input) {
      record({ name: "createSupplierMaster", tx, scope, input });
      return { id: "supplier-1", code: "SUP-20261119-TEST0001", name: input.name };
    }
    export async function updateSupplierMaster(tx, scope, supplierId, input) {
      record({ name: "updateSupplierMaster", tx, scope, supplierId, input });
    }
    export async function setSupplierActive(tx, scope, supplierId, active) {
      record({ name: "setSupplierActive", tx, scope, supplierId, active });
    }
  `,
};

// Node 20 type declarations do not expose registerHooks, but the project runs Node 24.
const registerHooks = (nodeModule as unknown as {
  registerHooks: (hooks: {
    resolve: (
      specifier: string,
      context: { parentURL?: string },
      nextResolve: (specifier: string, context?: { parentURL?: string }) => { url: string; shortCircuit?: boolean },
    ) => { url: string; shortCircuit?: boolean };
  }) => void;
}).registerHooks;

registerHooks({
  resolve(specifier, context, nextResolve) {
    const source = stubs[specifier];
    if (source) {
      return { url: `data:text/javascript,${encodeURIComponent(source)}`, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});

const testDirectory = typeof __dirname === "string"
  ? __dirname
  : fileURLToPath(new URL(".", import.meta.url));
const actionsSource = ts.transpileModule(
  readFileSync(join(testDirectory, "actions.ts"), "utf8"),
  {
    fileName: join(testDirectory, "actions.ts"),
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  },
).outputText;

type SupplierActionResult = {
  ok: boolean;
  message?: string;
  error?: string;
};

type SupplierActions = {
  createSupplierAction: (data: FormData) => Promise<SupplierActionResult>;
  updateSupplierAction: (data: FormData) => Promise<SupplierActionResult>;
  setSupplierActiveAction: (data: FormData) => Promise<never>;
};

function resetState(): void {
  state.redirect = undefined;
  state.capability = undefined;
  state.authDenied = false;
  state.serviceFailure = null;
  state.digestFailure = null;
  state.serviceCalls.length = 0;
}

function redirectTarget(): { pathname: string; message: string | null; error: string | null } {
  assert.ok(state.redirect, "action must redirect back to /v2/suppliers");
  const url = new URL(state.redirect, "http://localhost");
  return {
    pathname: url.pathname,
    message: url.searchParams.get("message"),
    error: url.searchParams.get("error"),
  };
}

function supplierForm(overrides: Record<string, string> = {}): FormData {
  const form = new FormData();
  form.set("code", "SUP-TEST-1");
  form.set("name", "测试供应商");
  form.set("contactName", "张三");
  form.set("phone", "13800000000");
  form.set("wechat", "wx-test");
  form.set("notes", "E1.3 走读");
  for (const [key, value] of Object.entries(overrides)) form.set(key, value);
  return form;
}

async function main(): Promise<void> {
  const { createSupplierAction, updateSupplierAction, setSupplierActiveAction } = await import(
    `data:text/javascript;base64,${Buffer.from(actionsSource).toString("base64")}`
  ) as SupplierActions;

  // 1. Create: purchase capability, exact FormData mapping and success result.
  resetState();
  const createResult = await createSupplierAction(supplierForm());
  assert.equal(state.capability, "purchase");
  assert.equal(state.serviceCalls.length, 1);
  const createCall = state.serviceCalls[0]!;
  assert.equal(createCall.name, "createSupplierMaster");
  assert.deepEqual(createCall.tx, { __fakeTx: true });
  assert.deepEqual(createCall.scope, {
    tenantId: "tenant-1",
    storeId: "store-1",
    staffId: "staff-1",
    actorStaffId: "staff-1",
  });
  assert.deepEqual(createCall.input, {
    code: "SUP-TEST-1",
    name: "测试供应商",
    contactName: "张三",
    phone: "13800000000",
    wechat: "wx-test",
    notes: "E1.3 走读",
  });
  assert.deepEqual(createResult, {
    ok: true,
    message: "供应商已创建，编号 SUP-20261119-TEST0001",
  });
  assert.equal(state.redirect, undefined, "drawer success must not redirect");

  // 2. Update: the target id is a separate argument, the rest maps the same way.
  resetState();
  const updateResult = await updateSupplierAction(
    supplierForm({ supplierId: "supplier-9", name: "测试供应商（更新）" }),
  );
  assert.equal(state.capability, "purchase");
  assert.equal(state.serviceCalls[0]?.name, "updateSupplierMaster");
  assert.equal(state.serviceCalls[0]?.supplierId, "supplier-9");
  assert.equal((state.serviceCalls[0]?.input as { name?: string }).name, "测试供应商（更新）");
  assert.deepEqual(updateResult, { ok: true, message: "供应商已更新" });
  assert.equal(state.redirect, undefined, "drawer success must not redirect");

  // 3. Enable/disable: the checkbox string becomes a boolean, each with its feedback.
  resetState();
  await setSupplierActiveAction(supplierForm({ supplierId: "supplier-9", active: "true" }));
  assert.equal(state.serviceCalls[0]?.name, "setSupplierActive");
  assert.equal(state.serviceCalls[0]?.active, true);
  assert.equal(redirectTarget().message, "供应商已启用");

  resetState();
  await setSupplierActiveAction(supplierForm({ supplierId: "supplier-9", active: "false" }));
  assert.equal(state.serviceCalls[0]?.active, false);
  assert.equal(redirectTarget().message, "供应商已停用");

  // 4. Read-only role: the action must stop before the service and return an
  //    inline error result so the drawer stays open.
  resetState();
  state.authDenied = true;
  const deniedResult = await createSupplierAction(supplierForm());
  assert.equal(state.capability, "purchase", "capability is checked before the service");
  assert.equal(state.serviceCalls.length, 0, "denied capability must not reach the service");
  assert.equal(deniedResult.ok, false);
  assert.match(deniedResult.error ?? "", /没有采购权限/);
  assert.equal(state.redirect, undefined, "drawer failure must not redirect");

  // 5. Service rejection: the message is surfaced as an inline drawer error.
  resetState();
  state.serviceFailure = new Error("供应商编码已存在");
  const failedResult = await createSupplierAction(supplierForm());
  assert.equal(state.serviceCalls.length, 1);
  assert.deepEqual(failedResult, { ok: false, error: "供应商编码已存在" });
  assert.equal(state.redirect, undefined, "drawer failure must not redirect");

  // 6. NEXT_REDIRECT (or any digest control flow) must be rethrown, never converted
  //    into a ?error banner, otherwise a nested redirect would be swallowed.
  resetState();
  state.digestFailure = { digest: "NEXT_REDIRECT;replace;/v2;307" };
  await assert.rejects(
    () => createSupplierAction(supplierForm()),
    (error: unknown) => {
      assert.deepEqual(error, { digest: "NEXT_REDIRECT;replace;/v2;307" });
      return true;
    },
  );
  assert.equal(state.redirect, undefined, "digest control flow must not be replaced by a banner redirect");

  console.log("v2 supplier action tests passed");
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
