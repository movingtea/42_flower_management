import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as nodeModule from "node:module";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

type Call = { name: string; args: unknown[] };
type State = {
  redirect?: string;
  capability?: string;
  authDenied?: boolean;
  serviceFailure?: Error | null;
  digestFailure?: { digest: string } | null;
  calls: Call[];
};

const state: State = { calls: [] };
(globalThis as unknown as { __sampleActionTest: State }).__sampleActionTest = state;

const stubs: Record<string, string> = {
  "next/navigation": `export function redirect(url) { globalThis.__sampleActionTest.redirect = url; }`,
  "@/v2/auth": `export async function requireV2Store(capability) {
    const shared = globalThis.__sampleActionTest;
    shared.capability = capability;
    if (shared.authDenied) throw new Error("当前账号没有商品权限");
    return { tenantId: "tenant-1", storeId: "store-1", staffId: "staff-1" };
  }`,
  "@/v2/db": `export const v2db = { $transaction: async (fn, options) => fn({ __fakeTx: true, options }) };`,
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
  "@/generated/prisma-v2/client": `export const SampleState = { DRAFT: "DRAFT", READY: "READY", ARCHIVED: "ARCHIVED" };`,
  "@/v2/services/sample-management": `
    function record(name, args) {
      const shared = globalThis.__sampleActionTest;
      shared.calls.push({ name, args });
      if (shared.digestFailure) throw shared.digestFailure;
      if (shared.serviceFailure) throw shared.serviceFailure;
    }
    export async function saveSample(tx, scope, input) {
      record("saveSample", [tx, scope, input]);
      return { id: "sample-1", code: "SMP-20260101-x", state: input.state ?? "DRAFT", versionNo: 1 };
    }
    export async function copySample(tx, scope, sampleId) {
      record("copySample", [tx, scope, sampleId]);
      return { id: "sample-2", code: "SMP-20260101-y", state: "DRAFT", versionNo: 1 };
    }
    export async function setSampleState(tx, scope, sampleId, sampleState) {
      record("setSampleState", [tx, scope, sampleId, sampleState]);
      return { id: sampleId, code: "SMP-20260101-x", state: sampleState, versionNo: 0 };
    }
  `,
  "@/v2/services/sample-conversion": `
    function record(name, args) {
      const shared = globalThis.__sampleActionTest;
      shared.calls.push({ name, args });
      if (shared.serviceFailure) throw shared.serviceFailure;
    }
    export async function convertSampleToSku(tx, scope, input) {
      record("convertSampleToSku", [tx, scope, input]);
      return { skuId: "sku-1", skuCode: "SKU-20260101-x", price: 80, materialCost: 20, packagingCost: 10, laborCost: 10, suggestedPrice: 80, productId: "product-1", productCode: "PRD-1", recipeId: "recipe-1", recipeVersionId: "rv-1" };
    }
    export async function convertSamplesToProduct(tx, scope, input) {
      record("convertSamplesToProduct", [tx, scope, input]);
      return [{ skuId: "sku-1", skuCode: "SKU-1" }, { skuId: "sku-2", skuCode: "SKU-2" }];
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

type Actions = {
  createSampleAction: (data: FormData) => Promise<ActionResult>;
  updateSampleAction: (data: FormData) => Promise<ActionResult>;
  copySampleAction: (data: FormData) => Promise<never>;
  setSampleStateAction: (data: FormData) => Promise<never>;
  convertSampleAction: (data: FormData) => Promise<ActionResult>;
  convertSamplesAction: (data: FormData) => Promise<ActionResult>;
};

type ActionResult = {
  ok: boolean;
  message?: string;
  error?: string;
};

function reset(): void {
  state.redirect = undefined;
  state.capability = undefined;
  state.authDenied = false;
  state.serviceFailure = null;
  state.digestFailure = null;
  state.calls.length = 0;
}

function feedback(): { path: string; message: string | null; error: string | null } {
  assert.ok(state.redirect);
  const url = new URL(state.redirect, "http://localhost");
  return {
    path: url.pathname,
    message: url.searchParams.get("message"),
    error: url.searchParams.get("error"),
  };
}

function sampleForm(overrides: Record<string, string> = {}): FormData {
  const form = new FormData();
  form.set("name", "测试样品");
  form.set("state", "READY");
  form.set("targetMarginPercent", "50");
  form.set("materialsJson", JSON.stringify([{ materialId: "material-1", quantity: 10 }]));
  for (const [key, value] of Object.entries(overrides)) form.set(key, value);
  return form;
}

async function main(): Promise<void> {
  const {
    createSampleAction,
    updateSampleAction,
    copySampleAction,
    setSampleStateAction,
    convertSampleAction,
    convertSamplesAction,
  } = await import(`data:text/javascript;base64,${Buffer.from(actionsSource).toString("base64")}`) as Actions;

  reset();
  const createResult = await createSampleAction(sampleForm());
  assert.equal(state.capability, "catalog");
  const createCall = state.calls[0]!;
  assert.equal(createCall.name, "saveSample");
  const createInput = createCall.args[2] as {
    name: string;
    state: string;
    targetMarginRate: number;
    materials: { materialId: string; quantity: number }[];
  };
  assert.equal(createInput.name, "测试样品");
  assert.equal(createInput.state, "READY");
  assert.equal(createInput.targetMarginRate, 0.5);
  assert.deepEqual(createInput.materials, [{ materialId: "material-1", quantity: 10 }]);
  assert.equal(createResult.ok, true);
  assert.match(createResult.message ?? "", /SMP-/);
  assert.equal(state.redirect, undefined, "drawer success must not redirect");

  reset();
  const updateResult = await updateSampleAction(
    sampleForm({ sampleId: "sample-9", name: "更新样品", state: "DRAFT" }),
  );
  assert.equal(state.calls[0]?.name, "saveSample");
  assert.equal((state.calls[0]?.args[2] as { id?: string }).id, "sample-9");
  assert.equal((state.calls[0]?.args[2] as { state?: string }).state, "DRAFT");
  assert.equal(updateResult.ok, true);
  assert.match(updateResult.message ?? "", /已保存/);
  assert.equal(state.redirect, undefined, "drawer success must not redirect");

  reset();
  await copySampleAction(sampleForm({ sampleId: "sample-9" }));
  assert.equal(state.calls[0]?.name, "copySample");
  assert.equal(state.calls[0]?.args[2], "sample-9");
  assert.match(feedback().message ?? "", /SMP-/);

  reset();
  await setSampleStateAction(sampleForm({ sampleId: "sample-9", state: "ARCHIVED" }));
  assert.equal(state.calls[0]?.name, "setSampleState");
  assert.equal(state.calls[0]?.args[3], "ARCHIVED");

  reset();
  const convertResult = await convertSampleAction(sampleForm({
    sampleId: "sample-9",
    productId: "product-9",
    skuName: "标准款",
    price: "88",
    laborCost: "12",
    consumableCost: "9",
    linesJson: JSON.stringify([{ materialId: "material-1", quantity: 8 }]),
  }));
  const convertCall = state.calls[0]!;
  assert.equal(convertCall.name, "convertSampleToSku");
  const convertInput = convertCall.args[2] as {
    sampleId: string;
    productId: string;
    skuName: string;
    price: number;
    laborCost: number;
    consumableCost: number;
    lines: { materialId: string; quantity: number }[];
  };
  assert.equal(convertInput.sampleId, "sample-9");
  assert.equal(convertInput.productId, "product-9");
  assert.equal(convertInput.skuName, "标准款");
  assert.equal(convertInput.price, 88);
  assert.equal(convertInput.laborCost, 12);
  assert.equal(convertInput.consumableCost, 9);
  assert.deepEqual(convertInput.lines, [{ materialId: "material-1", quantity: 8 }]);
  assert.equal(convertResult.ok, true);
  assert.match(convertResult.message ?? "", /SKU/);
  assert.equal(state.redirect, undefined, "drawer success must not redirect");

  reset();
  const batchForm = new FormData();
  batchForm.append("sampleIds", "sample-1");
  batchForm.append("sampleIds", "sample-2");
  batchForm.set("newProductName", "批量商品");
  batchForm.set("targetMarginPercent", "40");
  batchForm.set("laborCost", "5");
  const batchResult = await convertSamplesAction(batchForm);
  const batchCall = state.calls[0]!;
  assert.equal(batchCall.name, "convertSamplesToProduct");
  const batchInput = batchCall.args[2] as { sampleIds: string[]; newProductName: string; targetMarginRate: number };
  assert.deepEqual(batchInput.sampleIds, ["sample-1", "sample-2"]);
  assert.equal(batchInput.newProductName, "批量商品");
  assert.equal(batchInput.targetMarginRate, 0.4);
  assert.equal(batchResult.ok, true);
  assert.match(batchResult.message ?? "", /2 个 SKU/);
  assert.equal(state.redirect, undefined, "drawer success must not redirect");

  reset();
  state.authDenied = true;
  const deniedResult = await createSampleAction(sampleForm());
  assert.equal(state.calls.length, 0);
  assert.equal(deniedResult.ok, false);
  assert.match(deniedResult.error ?? "", /没有商品权限/);
  assert.equal(state.redirect, undefined, "drawer failure must not redirect");

  reset();
  state.serviceFailure = new Error("样品名称必填");
  const failedResult = await createSampleAction(sampleForm());
  assert.deepEqual(failedResult, { ok: false, error: "样品名称必填" });
  assert.equal(state.redirect, undefined, "drawer failure must not redirect");

  reset();
  state.digestFailure = { digest: "NEXT_REDIRECT;replace;/v2;307" };
  await assert.rejects(
    () => createSampleAction(sampleForm()),
    (error: unknown) => {
      assert.deepEqual(error, { digest: "NEXT_REDIRECT;replace;/v2;307" });
      return true;
    },
  );
  assert.equal(state.redirect, undefined);

  console.log("v2 sample action tests passed");
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
