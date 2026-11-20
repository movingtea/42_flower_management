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
  calls: Call[];
};

const state: State = { calls: [] };
(globalThis as unknown as { __samplePlanActionTest: State }).__samplePlanActionTest = state;

const stubs: Record<string, string> = {
  "next/navigation": `export function redirect(url) { globalThis.__samplePlanActionTest.redirect = url; }`,
  "@/v2/auth": `export async function requireV2Store(capability) {
    const shared = globalThis.__samplePlanActionTest;
    shared.capability = capability;
    if (shared.authDenied) throw new Error("当前账号没有打样权限");
    return { tenantId: "tenant-1", storeId: "store-1", staffId: "staff-1" };
  }`,
  "@/v2/db": `export const v2db = { $transaction: async (fn, options) => fn({ __fakeTx: true, options }) };`,
  "@/v2/services/sample-planning": `
    function record(name, args) {
      const shared = globalThis.__samplePlanActionTest;
      shared.calls.push({ name, args });
      if (shared.serviceFailure) throw shared.serviceFailure;
    }
    export async function saveSamplePlan(tx, scope, input) {
      record("saveSamplePlan", [tx, scope, input]);
      return { id: "plan-1", name: input.name, state: "DRAFT" };
    }
    export async function copySamplePlan(tx, scope, planId) {
      record("copySamplePlan", [tx, scope, planId]);
      return { id: "plan-2", name: "复制计划", state: "DRAFT" };
    }
    export async function calculatePlan(tx, scope, planId) {
      record("calculatePlan", [tx, scope, planId]);
      return { planId, calculationGroupId: "group-1", warnings: [], runs: [{ rank: 1, totalCost: 22, estimatedSaving: 10, id: "run-1", requestedSampleCount: 2, independentCost: 32, reuseRate: 0.3, stepCount: 2, purchaseQty: 0, createdAt: new Date(), selected: true }] };
    }
    export async function selectPlanRun(tx, scope, planId, runId) {
      record("selectPlanRun", [tx, scope, planId, runId]);
      return { planId, runId };
    }
    export async function approvePlan(tx, scope, planId) {
      record("approvePlan", [tx, scope, planId]);
      return { executionId: "execution-1", reservedQty: 10, shortageQty: 0 };
    }
    export async function startPlan(tx, scope, planId) {
      record("startPlan", [tx, scope, planId]);
      return { executionId: "execution-1", issuedQty: 10 };
    }
    export async function startNextStep(tx, scope, planId) {
      record("startNextStep", [tx, scope, planId]);
      return { stepId: "step-2", issuedQty: 1, reusedQty: 5 };
    }
    export async function pausePlan(tx, scope, planId, input) {
      record("pausePlan", [tx, scope, planId, input]);
      return { planId, releasedReservations: 4, releasedQty: 10, issuedKeptQty: 6, returnedQty: 2, keptQty: 6, lostQty: 2, wasStarted: true };
    }
    export async function resumePlan(tx, scope, planId) {
      record("resumePlan", [tx, scope, planId]);
      return { planId, state: "IN_PROGRESS", reservedQty: 0, shortageQty: 0 };
    }
    export async function recalculatePlan(tx, scope, planId) {
      record("recalculatePlan", [tx, scope, planId]);
      return { planId, calculationGroupId: "group-2", warnings: [], releasedReservations: 4, cancelledExecutionId: "execution-1", runs: [{ rank: 1, totalCost: 20, estimatedSaving: 0, id: "run-2", requestedSampleCount: 1, independentCost: 20, reuseRate: 0, stepCount: 1, purchaseQty: 0, createdAt: new Date(), selected: true }] };
    }
    export async function completeStep(tx, scope, planId, input) {
      record("completeStep", [tx, scope, planId, input]);
      return { stepId: "step-1", planCompleted: false, usedQty: 10, reusedQty: 0, lostQty: 5, reusableQty: 5, actualCost: 20, nextStepId: "step-2" };
    }
    export async function cancelPlan(tx, scope, planId, input) {
      record("cancelPlan", [tx, scope, planId, input]);
      return { planId, releasedReservations: 1, returnedQty: 0, keptQty: 0, lostQty: 2 };
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
  createSamplePlanAction: (data: FormData) => Promise<never>;
  updateSamplePlanAction: (data: FormData) => Promise<never>;
  copySamplePlanAction: (data: FormData) => Promise<never>;
  calculateSamplePlanAction: (data: FormData) => Promise<never>;
  selectSamplePlanRunAction: (data: FormData) => Promise<never>;
  approveSamplePlanAction: (data: FormData) => Promise<never>;
  startSamplePlanAction: (data: FormData) => Promise<never>;
  startNextSampleStepAction: (data: FormData) => Promise<never>;
  pauseSamplePlanAction: (data: FormData) => Promise<never>;
  resumeSamplePlanAction: (data: FormData) => Promise<never>;
  recalculateSamplePlanAction: (data: FormData) => Promise<never>;
  completeSampleStepAction: (data: FormData) => Promise<never>;
  cancelSamplePlanAction: (data: FormData) => Promise<never>;
};

function reset(): void {
  state.redirect = undefined;
  state.capability = undefined;
  state.authDenied = false;
  state.serviceFailure = null;
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

function planForm(overrides: Record<string, string> = {}): FormData {
  const form = new FormData();
  form.set("name", "测试打样计划");
  form.set("itemsJson", JSON.stringify([
    { sampleId: "sample-1", quantity: 1, mandatory: true, sequenceNo: 1 },
    { sampleId: "sample-2", quantity: 2, mandatory: false, sequenceNo: 2 },
  ]));
  for (const [key, value] of Object.entries(overrides)) form.set(key, value);
  return form;
}

async function main(): Promise<void> {
  const {
    createSamplePlanAction,
    updateSamplePlanAction,
    copySamplePlanAction,
    calculateSamplePlanAction,
    selectSamplePlanRunAction,
    approveSamplePlanAction,
    startSamplePlanAction,
    startNextSampleStepAction,
    pauseSamplePlanAction,
    resumeSamplePlanAction,
    recalculateSamplePlanAction,
    completeSampleStepAction,
    cancelSamplePlanAction,
  } = await import(`data:text/javascript;base64,${Buffer.from(actionsSource).toString("base64")}`) as Actions;

  reset();
  await createSamplePlanAction(planForm());
  assert.equal(state.capability, "production");
  assert.equal(state.calls[0]?.name, "saveSamplePlan");
  const items = (state.calls[0]?.args[2] as { items: unknown[] }).items;
  assert.equal(items.length, 2);
  assert.equal(feedback().path, "/v2/sample-plans");
  assert.match(feedback().message ?? "", /已创建/);

  reset();
  await updateSamplePlanAction(planForm({ planId: "plan-9" }));
  assert.equal(state.calls[0]?.name, "saveSamplePlan");
  assert.equal((state.calls[0]?.args[2] as { id?: string }).id, "plan-9");

  reset();
  await copySamplePlanAction(planForm({ planId: "plan-9" }));
  assert.equal(state.calls[0]?.name, "copySamplePlan");
  assert.equal(state.calls[0]?.args[2], "plan-9");

  reset();
  await calculateSamplePlanAction(planForm({ planId: "plan-9" }));
  assert.equal(state.calls[0]?.name, "calculatePlan");
  assert.match(feedback().message ?? "", /1 个方案/);

  reset();
  await selectSamplePlanRunAction(planForm({ planId: "plan-9", runId: "run-2" }));
  assert.equal(state.calls[0]?.name, "selectPlanRun");
  assert.equal(state.calls[0]?.args[3], "run-2");

  reset();
  await approveSamplePlanAction(planForm({ planId: "plan-9" }));
  assert.equal(state.capability, "catalog");
  assert.equal(state.calls[0]?.name, "approvePlan");
  assert.match(feedback().message ?? "", /已批准/);

  reset();
  await startSamplePlanAction(planForm({ planId: "plan-9" }));
  assert.equal(state.capability, "production");
  assert.equal(state.calls[0]?.name, "startPlan");
  assert.match(feedback().message ?? "", /已领用/);

  reset();
  await startNextSampleStepAction(planForm({ planId: "plan-9" }));
  assert.equal(state.calls[0]?.name, "startNextStep");
  assert.match(feedback().message ?? "", /复用 5/);

  reset();
  await pauseSamplePlanAction(planForm({
    planId: "plan-9",
    resolutionBatchId: "batch-1",
    "resolutionReturnQty_batch-1": "2",
    "resolutionKeepQty_batch-1": "6",
    "resolutionLossQty_batch-1": "2",
    "resolutionReverified_batch-1": "on",
  }));
  assert.equal(state.capability, "production");
  assert.equal(state.calls[0]?.name, "pausePlan");
  assert.equal(state.calls[0]?.args[2], "plan-9");
  const pauseInput = state.calls[0]?.args[3] as unknown as {
    resolutions: { batchId: string; returnQty: number; keepQty: number; lossQty: number; reverified: boolean }[];
  };
  assert.equal(pauseInput.resolutions[0]?.batchId, "batch-1");
  assert.equal(pauseInput.resolutions[0]?.returnQty, 2);
  assert.equal(pauseInput.resolutions[0]?.keepQty, 6);
  assert.equal(pauseInput.resolutions[0]?.lossQty, 2);
  assert.equal(pauseInput.resolutions[0]?.reverified, true);
  assert.match(feedback().message ?? "", /释放未领用预留 10/);
  assert.match(feedback().message ?? "", /回库 2/);
  assert.match(feedback().message ?? "", /留用 6/);

  reset();
  await resumeSamplePlanAction(planForm({ planId: "plan-9" }));
  assert.equal(state.capability, "production");
  assert.equal(state.calls[0]?.name, "resumePlan");
  assert.match(feedback().message ?? "", /已恢复/);

  reset();
  await recalculateSamplePlanAction(planForm({ planId: "plan-9" }));
  assert.equal(state.capability, "catalog");
  assert.equal(state.calls[0]?.name, "recalculatePlan");
  assert.equal(state.calls[0]?.args[2], "plan-9");
  assert.match(feedback().message ?? "", /原地重算/);
  assert.match(feedback().message ?? "", /释放旧预留 4/);

  reset();
  await completeSampleStepAction(planForm({
    planId: "plan-9",
    actualsJson: JSON.stringify([{ materialId: "material-1", usedQty: 10, reusableQty: 5 }]),
    disassemble: "true",
    lossReason: "修剪",
  }));
  const completeInput = state.calls[0]?.args[3] as unknown as {
    materials: { materialId: string; usedQty: number; reusableQty: number }[];
    disassemble: boolean;
    lossReason: string;
  };
  assert.equal(completeInput.materials[0]?.materialId, "material-1");
  assert.equal(completeInput.materials[0]?.usedQty, 10);
  assert.equal(completeInput.materials[0]?.reusableQty, 5);
  assert.equal(completeInput.disassemble, true);
  assert.equal(completeInput.lossReason, "修剪");

  reset();
  await cancelSamplePlanAction(planForm({
    planId: "plan-9",
    reason: "改期",
    resolutionBatchId: "batch-1",
    "resolutionReturnQty_batch-1": "0",
    "resolutionKeepQty_batch-1": "1",
    "resolutionLossQty_batch-1": "2",
  }));
  const cancelInput = state.calls[0]?.args[3] as unknown as {
    reason: string;
    resolutions: { batchId: string; returnQty: number; keepQty: number; lossQty: number; reverified: boolean }[];
  };
  assert.equal(cancelInput.reason, "改期");
  assert.equal(cancelInput.resolutions[0]?.batchId, "batch-1");
  assert.equal(cancelInput.resolutions[0]?.returnQty, 0);
  assert.equal(cancelInput.resolutions[0]?.keepQty, 1);
  assert.equal(cancelInput.resolutions[0]?.lossQty, 2);
  assert.equal(cancelInput.resolutions[0]?.reverified, false);

  reset();
  state.authDenied = true;
  await createSamplePlanAction(planForm());
  assert.equal(state.calls.length, 0);
  assert.match(feedback().error ?? "", /没有打样权限/);

  reset();
  state.serviceFailure = new Error("打样计划名称必填");
  await calculateSamplePlanAction(planForm({ planId: "plan-9" }));
  assert.equal(feedback().error, "打样计划名称必填");

  console.log("v2 sample plan action tests passed");
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
