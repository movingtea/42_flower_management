import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as nodeModule from "node:module";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

/**
 * Run with: npx tsx src/app/v2/receiving/actions.test.ts
 *
 * Action-layer contract for the dedicated receiving route. The shared receipt
 * service owns authorization and the database transaction (covered by the
 * service/integration suites); this test proves the route actions expose the
 * drawer result contract and never convert control-flow errors into banners.
 */
type ReceiptCall = { kind: "receive" | "reject"; data: FormData };

type State = {
  calls: ReceiptCall[];
  failure?: Error | null;
  digest?: { digest: string } | null;
};

const state: State = { calls: [] };
(globalThis as unknown as { __receivingActionTest: State }).__receivingActionTest = state;

const stubs: Record<string, string> = {
  "@/v2/services/purchase-receipt": `
    export async function receivePurchaseFromForm(data) {
      const shared = globalThis.__receivingActionTest;
      shared.calls.push({ kind: "receive", data });
      if (shared.digest) throw shared.digest;
      if (shared.failure) throw shared.failure;
      return "验收入库完成";
    }
    export async function rejectPurchaseFromForm(data) {
      const shared = globalThis.__receivingActionTest;
      shared.calls.push({ kind: "reject", data });
      if (shared.digest) throw shared.digest;
      if (shared.failure) throw shared.failure;
      return "已拒收 2支，剩余 0支";
    }
  `,
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
};

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

type ReceivingActionResult = { ok: boolean; message?: string; error?: string };
type ReceivingActions = {
  receivePurchaseAction: (data: FormData) => Promise<ReceivingActionResult>;
  rejectPurchaseAction: (data: FormData) => Promise<ReceivingActionResult>;
};

function resetState(): void {
  state.calls.length = 0;
  state.failure = null;
  state.digest = null;
}

function receiptForm(): FormData {
  const form = new FormData();
  form.set("purchaseLineId", "line-1");
  form.set("quantity", "2");
  form.set("disposition", "ACCEPTED");
  form.set("finalUnitCost", "3.5");
  return form;
}

async function main(): Promise<void> {
  const { receivePurchaseAction, rejectPurchaseAction } = await import(
    `data:text/javascript;base64,${Buffer.from(actionsSource).toString("base64")}`
  ) as ReceivingActions;

  // 1. Success: the service receives the exact submitted FormData and the
  //    action returns the drawer success contract.
  resetState();
  const receiveResult = await receivePurchaseAction(receiptForm());
  assert.equal(state.calls.length, 1);
  assert.equal(state.calls[0]?.kind, "receive");
  assert.equal(state.calls[0]?.data.get("purchaseLineId"), "line-1");
  assert.equal(state.calls[0]?.data.get("quantity"), "2");
  assert.deepEqual(receiveResult, { ok: true, message: "验收入库完成" });

  // 2. Reject: same contract with the rejection service entry.
  resetState();
  const rejectForm = receiptForm();
  rejectForm.set("reason", "到货破损");
  const rejectResult = await rejectPurchaseAction(rejectForm);
  assert.equal(state.calls[0]?.kind, "reject");
  assert.equal(state.calls[0]?.data.get("reason"), "到货破损");
  assert.deepEqual(rejectResult, { ok: true, message: "已拒收 2支，剩余 0支" });

  // 3. Service failure stays inside the open drawer as an inline error.
  resetState();
  state.failure = new Error("采购明细不存在或不属于当前门店");
  const failed = await receivePurchaseAction(receiptForm());
  assert.deepEqual(failed, { ok: false, error: "采购明细不存在或不属于当前门店" });

  // 4. Framework control flow is rethrown and never shown as a form error.
  resetState();
  state.digest = { digest: "NEXT_REDIRECT;replace;/v2/receiving;307" };
  await assert.rejects(
    () => receivePurchaseAction(receiptForm()),
    (error: unknown) => {
      assert.deepEqual(error, { digest: "NEXT_REDIRECT;replace;/v2/receiving;307" });
      return true;
    },
  );

  console.log("v2 receiving action tests passed");
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
