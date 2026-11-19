import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as nodeModule from "node:module";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

/**
 * Run with: npx tsx src/app/v2/order-ui.test.ts
 *
 * If a confined sandbox blocks tsx/esbuild's child-process pipe, the same assertions
 * can run through Node's type stripping:
 * node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON src/app/v2/order-ui.test.ts
 *
 * _lib/order-ui.ts is pure, so the test imports it directly without loading page.tsx.
 * This keeps the test focused on the order gating and latest-reservation aggregation
 * that decide whether the low-burden forms appear.
 */
const stubs: Record<string, string> = {
  "react": "export function Fragment() {}",
  "react/jsx-runtime": "export function jsx() {} export function jsxs() {} export function Fragment() {}",
  "next/link": "export default function Link() {}",
  "next/navigation": "export function redirect(url) { globalThis.__v2UiTest.redirect = url; }",
  "@/auth": "export async function auth() { return null; }",
  "@/v2/auth": "export async function requireV2Store(capability) { globalThis.__v2UiTest.capability = capability; return { tenantId: 'tenant-1', storeId: 'store-1', staffId: 'staff-1' }; }",
  "@/v2/db": "export const v2db = {};",
  "@/generated/prisma-v2/client": "export const MaterialKind = { FLOWER: 'FLOWER', FOLIAGE: 'FOLIAGE', PACKAGING: 'PACKAGING', CONSUMABLE: 'CONSUMABLE', OTHER: 'OTHER' }; export const RecipeState = { PUBLISHED: 'PUBLISHED', RETIRED: 'RETIRED' };",
  "@/v2/domain/stock-planning": "export function assertMaterialQuantity() {}",
  "@/v2/domain/identifiers": "export function generateBatchNumber() { return 'B-TEST'; } export function generateProductCode() { return 'P-TEST'; } export function generateSkuCode() { return 'S-TEST'; }",
  "@/v2/services/complete-delivery": "export async function completeDelivery() {}",
  "@/v2/services/complete-production": "export async function completeProduction(...args) { globalThis.__v2UiTest.productionCalls += 1; globalThis.__v2UiTest.usage = args[4]; }",
  "@/v2/services/allocate-purchase-demand": "export async function allocatePurchaseDemand() {}",
  "@/v2/services/manual-order": "export async function confirmManualOrder() {} export async function createManualOrder(db, input) { globalThis.__v2UiTest.createInput = input; return 'order-1'; }",
  "@/v2/services/receive-purchase-line": "export async function receivePurchaseLine() {}",
  "@/v2/services/recheck-supply": "export async function recheckSupplyAfterReceipt() {}",
  "@/v2/services/reject-purchase-line": "export async function rejectPurchaseLine() {}",
  "@/v2/services/revise-order": "export async function reviseManualOrder(db, input) { globalThis.__v2UiTest.reviseInput = input; return { orderId: input.orderId, revisionId: 'revision-3', revisionNumber: 3, covered: globalThis.__v2UiTest.reviseResult?.covered ?? true, totalShortage: globalThis.__v2UiTest.reviseResult?.totalShortage ?? 0 }; }",
  "@/v2/services/substitute-order-material": "export async function substituteOrderMaterial() {}",
  "@/v2/services/order-lifecycle": "export async function cancelOrder(db, input) { globalThis.__v2UiTest.lifecycle = { type: 'cancel', input }; } export async function closeOrder(db, input) { globalThis.__v2UiTest.lifecycle = { type: 'close', input }; } export async function startOrderProduction(db, input) { globalThis.__v2UiTest.lifecycle = { type: 'start', input }; }",
  "@/v2/services/delivery-management": "export async function createDeliveryAttempt(db, input) { globalThis.__v2UiTest.delivery = { type: 'create', input }; } export async function startDeliveryAttempt(db, input) { globalThis.__v2UiTest.delivery = { type: 'start', input }; } export async function failDeliveryAttempt(db, input) { globalThis.__v2UiTest.delivery = { type: 'fail', input }; } export async function rescheduleDeliveryAttempt(db, input) { globalThis.__v2UiTest.delivery = { type: 'reschedule', input }; }",
  "@/v2/services/order-cost-management": "export async function recordDeliveryActualCost(db, input) { globalThis.__v2UiTest.deliveryCost = input; }",
  "@/v2/services/record-manual-payment": "export async function recordManualPayment() { return { amount: 0 }; }",
  "@/v2/services/record-refund": "export async function recordRefund() { return { amount: 0 }; }",
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

function dataUrl(source: string): string {
  return `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
}

// Transpile the pure order UI helper module with TypeScript's in-process API; the sandbox
// blocks tsx/esbuild's child-process pipe. The module has no server-only imports.
// package.json is CJS, so tsx supplies __dirname; the fallback keeps direct Node ESM runs working.
const testDirectory = typeof __dirname === "string"
  ? __dirname
  : fileURLToPath(new URL(".", import.meta.url));
const orderUiPath = join(testDirectory, "_lib", "order-ui.ts");
const orderUiModuleSource = ts.transpileModule(readFileSync(orderUiPath, "utf8"), {
  fileName: orderUiPath,
  compilerOptions: {
    jsx: ts.JsxEmit.ReactJSX,
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText;
const purchaseUiPath = join(testDirectory, "_lib", "purchase-ui.ts");
const purchaseUiModuleSource = ts.transpileModule(readFileSync(purchaseUiPath, "utf8"), {
  fileName: purchaseUiPath,
  compilerOptions: {
    jsx: ts.JsxEmit.ReactJSX,
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText;

type CapturedUsage = {
  batchId: string;
  usedQty: number;
  lostQty?: number;
  returnedQty?: number;
  differenceReason?: string | null;
};
type Capture = {
  capability?: string;
  productionCalls: number;
  usage?: CapturedUsage[];
  createInput?: {
    skuId?: string;
    quantity?: number;
    items?: { skuId: string; quantity: number }[];
  };
  reviseInput?: {
    tenantId: string;
    storeId: string;
    orderId: string;
    quantity?: number;
    items?: { orderItemId: string; quantity: number }[];
    deliveryAt: Date;
  };
  reviseResult?: { covered: boolean; totalShortage: number };
  lifecycle?: { type: string; input: Record<string, unknown> };
  delivery?: { type: string; input: Record<string, unknown> };
  deliveryCost?: Record<string, unknown>;
  redirect?: string;
};
const capture: Capture = { productionCalls: 0 };
(globalThis as unknown as { __v2UiTest: Capture }).__v2UiTest = capture;
function resetCapture(): void {
  capture.capability = undefined;
  capture.productionCalls = 0;
  capture.usage = undefined;
  capture.createInput = undefined;
  capture.reviseInput = undefined;
  capture.reviseResult = undefined;
  capture.lifecycle = undefined;
  capture.delivery = undefined;
  capture.deliveryCost = undefined;
  capture.redirect = undefined;
}

// The actions module is loaded the same way, with the service calls stubbed so the
// test can assert the exact FormData contract and capability each action enforces.
const actionsPath = join(testDirectory, "actions.ts");
const actionsModuleSource = ts.transpileModule(readFileSync(actionsPath, "utf8"), {
  fileName: actionsPath,
  compilerOptions: {
    jsx: ts.JsxEmit.ReactJSX,
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText;

const ordersActionsPath = join(testDirectory, "orders", "actions.ts");
const ordersActionsModuleSource = ts.transpileModule(readFileSync(ordersActionsPath, "utf8"), {
  fileName: ordersActionsPath,
  compilerOptions: {
    jsx: ts.JsxEmit.ReactJSX,
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText;

function redirectParams(): { message: string | null; error: string | null } {
  assert.ok(capture.redirect, "action must redirect back to /v2");
  const url = new URL(capture.redirect, "http://localhost");
  return { message: url.searchParams.get("message"), error: url.searchParams.get("error") };
}

type Reservation = { batchId: string; state: string; quantity: number; batch: { batchNo: string } };
type Requirement = {
  revisionId: string;
  material: { code: string; name: string; baseUnit: string; quantityScale: number };
  reservations: Reservation[];
};
type Candidate = {
  commercialState: string;
  productionState: string;
  fulfillmentState: string;
  fulfillment: { handedOverAt: Date | null } | null;
  items: {
    id: string;
    nameSnapshot: string;
    kind: string;
    quantity: number;
    tasks: { id: string; state: string; startedAt: Date | null; completedAt: Date | null }[];
    requirements: Requirement[];
  }[];
  revisions: { id: string; number: number }[];
};

function makeOrder(overrides: Partial<Candidate> = {}): Candidate {
  return {
    commercialState: "CONFIRMED",
    productionState: "READY",
    fulfillmentState: "UNPLANNED",
    fulfillment: null,
    items: [{
      id: "item-1",
      nameSnapshot: "红玫瑰花束",
      kind: "STANDARD",
      quantity: 2,
      tasks: [{ id: "task-1", state: "READY", startedAt: null, completedAt: null }],
      requirements: [],
    }],
    revisions: [{ id: "revision-2", number: 2 }],
    ...overrides,
  };
}

async function main() {
  const {
    canReviseOrder, latestReservedBatchLines, toDateTimeLocalValue,
    ORDER_BOARD_COLUMNS, appDateKey, hasCopyValue, orderBoardStage,
    groupOrdersByBoardStage, matchesOrderFilters, canCancelOrder, canCloseOrder,
    canCompleteDelivery, canStartProduction, canFinishProduction,
    deliveryAttemptActionFlags, orderTotalCents,
  } = await import(dataUrl(orderUiModuleSource)) as {
    canReviseOrder: (order: Candidate) => boolean;
    latestReservedBatchLines: (order: Candidate) => {
      taskId: string; itemId: string; itemName: string;
      batchId: string; batchNo: string; materialCode: string; materialName: string; quantity: number;
    }[];
    toDateTimeLocalValue: (value: Date | null) => string;
    ORDER_BOARD_COLUMNS: { id: string; title: string }[];
    appDateKey: (value: Date | string | null | undefined) => string | null;
    hasCopyValue: (value: unknown) => boolean;
    orderBoardStage: (order: { commercialState: string; productionState: string; fulfillmentState: string }) => string;
    groupOrdersByBoardStage: <T extends { commercialState: string; productionState: string; fulfillmentState: string }>(
      orders: readonly T[],
    ) => { column: { id: string; title: string }; orders: T[] }[];
    matchesOrderFilters: (
      order: {
        commercialState: string; productionState: string; fulfillmentState: string; supplyState: string;
        number: string; buyerNameSnapshot: string | null; buyerPhoneSnapshot: string | null;
        recipientNameSnapshot: string | null; recipientPhoneSnapshot: string | null; deliveryAt: Date | null;
      },
      filters: {
        q?: string; deliveryDate?: string; commercial?: string; supply?: string;
        production?: string; fulfillment?: string;
      },
    ) => boolean;
    canCancelOrder: (order: { commercialState: string; productionState: string; fulfillmentState: string }) => boolean;
    canCloseOrder: (order: { commercialState: string; productionState: string; fulfillmentState: string }) => boolean;
    canCompleteDelivery: (order: { commercialState: string; productionState: string; fulfillmentState: string }) => boolean;
    canStartProduction: (order: {
      commercialState: string; supplyState: string; productionState: string; fulfillmentState: string;
    }) => boolean;
    canFinishProduction: (order: {
      commercialState: string; supplyState: string; productionState: string; fulfillmentState: string;
    }) => boolean;
    deliveryAttemptActionFlags: (attempt: { state: string }) => { start: boolean; fail: boolean; reschedule: boolean };
    orderTotalCents: (order: {
      items: { quantity: number; unitPrice: unknown }[];
      fulfillment?: { deliveryFeeCharged: unknown } | null;
    }) => number;
  };
  const { createOrder, finishProductionWithUsage, reviseOrder } = await import(dataUrl(actionsModuleSource)) as {
    createOrder: (data: FormData) => Promise<void>;
    finishProductionWithUsage: (data: FormData) => Promise<void>;
    reviseOrder: (data: FormData) => Promise<void>;
  };
  const {
    cancelOrder: cancelOrderAction,
    startOrderProduction: startOrderProductionAction,
    rescheduleDeliveryAttempt: rescheduleDeliveryAttemptAction,
    recordDeliveryActualCost: recordDeliveryActualCostAction,
  } = await import(dataUrl(ordersActionsModuleSource)) as {
    cancelOrder: (data: FormData) => Promise<void>;
    startOrderProduction: (data: FormData) => Promise<void>;
    rescheduleDeliveryAttempt: (data: FormData) => Promise<void>;
    recordDeliveryActualCost: (data: FormData) => Promise<void>;
  };
  const {
    describeProgressState, formatQuantity, isEligiblePurchaseLine, isLatePurchaseLine,
    outstandingAllocatableQty, sortReplacementMaterialOptions, toPurchaseReceiptRows,
  } = await import(dataUrl(purchaseUiModuleSource)) as {
    describeProgressState: (progress: { state?: string; processedQty: number; remainingQty: number }) => string;
    formatQuantity: (value: unknown) => string;
    isEligiblePurchaseLine: (
      line: { materialId: string; expectedAt: Date | null; allocatableQty: number },
      requirement: { materialId: string; needBy: Date },
    ) => boolean;
    isLatePurchaseLine: (
      line: { materialId: string; expectedAt: Date | null; allocatableQty: number },
      requirement: { materialId: string; needBy: Date },
    ) => boolean;
    outstandingAllocatableQty: (expectedBaseQty: number, processedQty: number, allocatedQty: number) => number;
    sortReplacementMaterialOptions: <T extends {
      material: { code: string; name: string };
      availableQty: number;
    }>(options: readonly T[], plannedQty: number) => T[];
    toPurchaseReceiptRows: (rows: readonly { disposition: string; quantity: unknown }[]) => {
      disposition: "ACCEPTED" | "DOWNGRADED" | "REJECTED";
      quantity: number;
    }[];
  };

  // Revision form: only pre-production single-item standard orders are offered.
  assert.equal(canReviseOrder(makeOrder()), true);
  assert.equal(canReviseOrder(makeOrder({ commercialState: "DRAFT" })), true);
  assert.equal(canReviseOrder(makeOrder({ commercialState: "PENDING_CONFIRMATION" })), true);
  assert.equal(canReviseOrder(makeOrder({ commercialState: "CANCELLED" })), false);
  assert.equal(canReviseOrder(makeOrder({ productionState: "IN_PROGRESS" })), false);
  assert.equal(canReviseOrder(makeOrder({ productionState: "COMPLETED" })), false);
  assert.equal(canReviseOrder(makeOrder({ fulfillmentState: "DELIVERED" })), false);
  assert.equal(canReviseOrder(makeOrder({ fulfillment: { handedOverAt: new Date() } })), false);
  assert.equal(canReviseOrder(makeOrder({ revisions: [] })), false);
  assert.equal(canReviseOrder(makeOrder({
    items: [
      makeOrder().items[0],
      { ...makeOrder().items[0], id: "item-2", nameSnapshot: "白玫瑰", quantity: 1 },
    ],
  })), true);
  assert.equal(canReviseOrder(makeOrder({
    items: Array.from({ length: 21 }, (_, index) => ({
      ...makeOrder().items[0],
      id: `item-${index + 1}`,
      nameSnapshot: `商品 ${index + 1}`,
    })),
  })), false);
  assert.equal(canReviseOrder(makeOrder({
    items: [{ ...makeOrder().items[0], kind: "CUSTOM" }],
  })), false);
  assert.equal(canReviseOrder(makeOrder({
    items: [{
      ...makeOrder().items[0],
      tasks: [{ id: "task-1", state: "READY", startedAt: new Date(), completedAt: null }],
    }],
  })), false);
  assert.equal(canReviseOrder(makeOrder({
    items: [{
      ...makeOrder().items[0],
      tasks: [{ id: "task-1", state: "EXCEPTION", startedAt: null, completedAt: null }],
    }],
  })), false);

  const material = { code: "ROSE", name: "红玫瑰", baseUnit: "支", quantityScale: 0 };
  const reservation = (batchId: string, batchNo: string, quantity: number, state = "ACTIVE") => ({
    batchId, state, quantity, batch: { batchNo },
  });
  const order = makeOrder({
    revisions: [{ id: "revision-2", number: 2 }, { id: "revision-1", number: 1 }],
    items: [{
      id: "item-1",
      nameSnapshot: "红玫瑰花束",
      kind: "STANDARD",
      quantity: 2,
      tasks: [{ id: "task-1", state: "READY", startedAt: null, completedAt: null }],
      requirements: [
        {
          revisionId: "revision-2",
          material,
          reservations: [
            reservation("batch-1", "B-001", 3),
            reservation("batch-1", "B-001", 2),
            reservation("batch-2", "B-002", 1),
            reservation("batch-3", "B-003", 9, "RELEASED"),
          ],
        },
        {
          revisionId: "revision-2",
          material,
          reservations: [reservation("batch-2", "B-002", 0.5)],
        },
        {
          revisionId: "revision-2",
          material: { code: "FERN", name: "尤加利", baseUnit: "支", quantityScale: 1 },
          reservations: [reservation("batch-5", "B-005", 1.5)],
        },
        {
          revisionId: "revision-1",
          material,
          reservations: [reservation("batch-4", "B-004", 20)],
        },
      ],
    }],
  });

  // Only latest-revision active reservations appear, grouped per task + batch.
  const lines = latestReservedBatchLines(order);
  assert.deepEqual(lines.map((line) => [line.taskId, line.batchId, line.batchNo, line.materialCode, line.quantity]), [
    ["task-1", "batch-5", "B-005", "FERN", 1.5],
    ["task-1", "batch-1", "B-001", "ROSE", 5],
    ["task-1", "batch-2", "B-002", "ROSE", 1.5],
  ]);
  assert.equal(latestReservedBatchLines(makeOrder()).length, 0);
  assert.equal(latestReservedBatchLines(makeOrder({ revisions: [] })).length, 0);

  // A batch shared by two production tasks stays two rows, each with its own task id.
  const shared = makeOrder({
    revisions: [{ id: "revision-2", number: 2 }],
    items: [
      {
        ...makeOrder().items[0],
        id: "item-a",
        nameSnapshot: "商品 A",
        tasks: [{ id: "task-a", state: "READY", startedAt: null, completedAt: null }],
        requirements: [{
          revisionId: "revision-2",
          material,
          reservations: [reservation("batch-1", "B-001", 2)],
        }],
      },
      {
        ...makeOrder().items[0],
        id: "item-b",
        nameSnapshot: "商品 B",
        tasks: [{ id: "task-b", state: "READY", startedAt: null, completedAt: null }],
        requirements: [{
          revisionId: "revision-2",
          material,
          reservations: [reservation("batch-1", "B-001", 3)],
        }],
      },
    ],
  });
  assert.deepEqual(
    latestReservedBatchLines(shared).map((line) => [line.taskId, line.itemId, line.batchId, line.quantity]),
    [["task-a", "item-a", "batch-1", 2], ["task-b", "item-b", "batch-1", 3]],
  );

  assert.equal(toDateTimeLocalValue(new Date(2026, 10, 6, 9, 5)), "2026-11-06T09:05");
  assert.equal(toDateTimeLocalValue(null), "");

  // Board lanes keep the V1 Chinese operational titles and a single history lane.
  assert.deepEqual(ORDER_BOARD_COLUMNS.map((column) => column.title), [
    "待确认", "待制作", "制作中", "待交付 / 自提 / 配送", "配送中", "配送异常", "已完成 / 历史归档",
  ]);
  assert.equal(orderBoardStage({ commercialState: "DRAFT", productionState: "NOT_SCHEDULED", fulfillmentState: "UNPLANNED" }), "pending");
  assert.equal(orderBoardStage({ commercialState: "CONFIRMED", productionState: "READY", fulfillmentState: "UNPLANNED" }), "production");
  assert.equal(orderBoardStage({ commercialState: "CONFIRMED", productionState: "IN_PROGRESS", fulfillmentState: "UNPLANNED" }), "in_progress");
  assert.equal(orderBoardStage({ commercialState: "CONFIRMED", productionState: "COMPLETED", fulfillmentState: "WAITING_PICKUP" }), "ready");
  assert.equal(orderBoardStage({ commercialState: "CONFIRMED", productionState: "COMPLETED", fulfillmentState: "DELIVERING" }), "delivering");
  assert.equal(orderBoardStage({ commercialState: "CONFIRMED", productionState: "COMPLETED", fulfillmentState: "FAILED" }), "failed");
  assert.equal(orderBoardStage({ commercialState: "CONFIRMED", productionState: "COMPLETED", fulfillmentState: "DELIVERED" }), "archive");
  assert.equal(orderBoardStage({ commercialState: "CANCELLED", productionState: "READY", fulfillmentState: "UNPLANNED" }), "archive");

  const grouped = groupOrdersByBoardStage([
    { commercialState: "DRAFT", productionState: "NOT_SCHEDULED", fulfillmentState: "UNPLANNED" },
    { commercialState: "CONFIRMED", productionState: "READY", fulfillmentState: "UNPLANNED" },
    { commercialState: "CONFIRMED", productionState: "IN_PROGRESS", fulfillmentState: "UNPLANNED" },
    { commercialState: "CONFIRMED", productionState: "COMPLETED", fulfillmentState: "WAITING_PICKUP" },
    { commercialState: "CONFIRMED", productionState: "COMPLETED", fulfillmentState: "DELIVERING" },
    { commercialState: "CONFIRMED", productionState: "COMPLETED", fulfillmentState: "FAILED" },
    { commercialState: "CONFIRMED", productionState: "COMPLETED", fulfillmentState: "DELIVERED" },
    { commercialState: "CLOSED", productionState: "COMPLETED", fulfillmentState: "DELIVERED" },
  ]);
  assert.deepEqual(grouped.map((group) => [group.column.id, group.orders.length]), [
    ["pending", 1], ["production", 1], ["in_progress", 1], ["ready", 1],
    ["delivering", 1], ["failed", 1], ["archive", 2],
  ]);

  // Date keys and filters use the Asia/Shanghai operating day.
  assert.equal(appDateKey(new Date("2026-06-09T16:00:00.000Z")), "2026-06-10");
  assert.equal(appDateKey("2026-06-10T15:59:59.000Z"), "2026-06-10");
  assert.equal(appDateKey(null), null);
  assert.equal(appDateKey("not-a-date"), null);
  const filterOrder = {
    commercialState: "CONFIRMED",
    supplyState: "PURCHASE_REQUIRED",
    productionState: "READY",
    fulfillmentState: "WAITING_DELIVERY",
    number: "SO-20260610-001",
    buyerNameSnapshot: "张三",
    buyerPhoneSnapshot: "13800000000",
    recipientNameSnapshot: "李四",
    recipientPhoneSnapshot: "13900000000",
    deliveryAt: new Date("2026-06-10T02:00:00.000Z"),
  };
  assert.equal(matchesOrderFilters(filterOrder, {}), true);
  assert.equal(matchesOrderFilters(filterOrder, { q: "so-20260610" }), true);
  assert.equal(matchesOrderFilters(filterOrder, { q: "张三" }), true);
  assert.equal(matchesOrderFilters(filterOrder, { q: "139" }), true);
  assert.equal(matchesOrderFilters(filterOrder, { q: "不存在" }), false);
  assert.equal(matchesOrderFilters(filterOrder, { deliveryDate: "2026-06-10" }), true);
  assert.equal(matchesOrderFilters(filterOrder, { deliveryDate: "2026-06-11" }), false);
  assert.equal(matchesOrderFilters(filterOrder, { commercial: "CONFIRMED", supply: "PURCHASE_REQUIRED" }), true);
  assert.equal(matchesOrderFilters(filterOrder, { production: "READY", fulfillment: "WAITING_DELIVERY" }), true);
  assert.equal(matchesOrderFilters(filterOrder, { supply: "ON_HAND_COVERED" }), false);

  // Copy controls are only rendered for meaningful values.
  assert.equal(hasCopyValue("SO-1"), true);
  assert.equal(hasCopyValue("  13800000000  "), true);
  assert.equal(hasCopyValue(""), false);
  assert.equal(hasCopyValue("   "), false);
  assert.equal(hasCopyValue(null), false);
  assert.equal(hasCopyValue(undefined), false);

  // Action gates follow lifecycle/service rules.
  const readyOrder = { commercialState: "CONFIRMED", productionState: "READY", fulfillmentState: "UNPLANNED" };
  const inProgressOrder = { commercialState: "CONFIRMED", productionState: "IN_PROGRESS", fulfillmentState: "UNPLANNED" };
  const deliveredOrder = { commercialState: "CONFIRMED", productionState: "COMPLETED", fulfillmentState: "DELIVERED" };
  assert.equal(canCancelOrder(readyOrder), true);
  assert.equal(canCancelOrder(inProgressOrder), false);
  assert.equal(canCancelOrder({ ...readyOrder, productionState: "COMPLETED" }), false);
  assert.equal(canCancelOrder({ ...readyOrder, commercialState: "CANCELLED" }), false);
  assert.equal(canCloseOrder(deliveredOrder), true);
  assert.equal(canCloseOrder({ ...readyOrder, productionState: "COMPLETED", fulfillmentState: "WAITING_PICKUP" }), false);
  assert.equal(canCompleteDelivery({ ...readyOrder, productionState: "COMPLETED", fulfillmentState: "WAITING_PICKUP" }), true);
  assert.equal(canCompleteDelivery({ ...readyOrder, productionState: "COMPLETED", fulfillmentState: "DELIVERING" }), true);
  assert.equal(canCompleteDelivery({ ...readyOrder, productionState: "COMPLETED", fulfillmentState: "UNPLANNED" }), false);
  assert.equal(canStartProduction({ ...readyOrder, supplyState: "ON_HAND_COVERED" }), true);
  assert.equal(canStartProduction({ ...readyOrder, supplyState: "PURCHASE_REQUIRED" }), false);
  assert.equal(canFinishProduction({ ...inProgressOrder, supplyState: "ON_HAND_COVERED" }), true);
  assert.equal(canFinishProduction({ ...inProgressOrder, supplyState: "PURCHASE_REQUIRED" }), false);
  assert.deepEqual(deliveryAttemptActionFlags({ state: "SCHEDULED" }), { start: true, fail: false, reschedule: false });
  assert.deepEqual(deliveryAttemptActionFlags({ state: "OUT_FOR_DELIVERY" }), { start: false, fail: true, reschedule: false });
  assert.deepEqual(deliveryAttemptActionFlags({ state: "FAILED" }), { start: false, fail: false, reschedule: true });
  assert.deepEqual(deliveryAttemptActionFlags({ state: "DELIVERED" }), { start: false, fail: false, reschedule: false });
  assert.equal(orderTotalCents({
    items: [{ quantity: 2, unitPrice: "12.50" }],
    fulfillment: { deliveryFeeCharged: 5 },
  }), 3000);

  // Create action: parallel itemSkuId/itemQuantity rows become independent order lines.
  resetCapture();
  const createForm = new FormData();
  createForm.set("deliveryAt", "2030-01-01T10:00");
  createForm.set("fulfillmentKind", "PICKUP");
  createForm.set("buyerName", "多商品顾客");
  createForm.append("itemSkuId", "sku-1");
  createForm.append("itemQuantity", "2");
  createForm.append("itemSkuId", "sku-2");
  createForm.append("itemQuantity", "3");
  await createOrder(createForm);
  assert.equal(capture.capability, "order");
  assert.deepEqual(capture.createInput?.items, [
    { skuId: "sku-1", quantity: 2 },
    { skuId: "sku-2", quantity: 3 },
  ]);
  assert.equal(redirectParams().error, null);

  // Legacy create markup still forwards one skuId/quantity.
  resetCapture();
  const legacyCreateForm = new FormData();
  legacyCreateForm.set("deliveryAt", "2030-01-01T10:00");
  legacyCreateForm.set("fulfillmentKind", "PICKUP");
  legacyCreateForm.set("skuId", "sku-legacy");
  legacyCreateForm.set("quantity", "4");
  await createOrder(legacyCreateForm);
  assert.equal(capture.createInput?.skuId, "sku-legacy");
  assert.equal(capture.createInput?.quantity, 4);
  assert.equal(capture.createInput?.items, undefined);

  // Exception action: only submitted batch rows are parsed, and production capability is enforced.
  resetCapture();
  const usageForm = new FormData();
  usageForm.set("orderId", "order-1");
  usageForm.set("usage.batch-b.usedQty", "2.5");
  usageForm.set("usage.batch-b.lostQty", "0.5");
  usageForm.set("usage.batch-b.reason", "现场补用");
  usageForm.set("usage.batch-a.usedQty", "1");
  usageForm.set("usage.batch-a.returnedQty", "");
  await finishProductionWithUsage(usageForm);
  assert.equal(capture.capability, "production");
  assert.equal(capture.productionCalls, 1);
  assert.deepEqual(capture.usage, [
    { batchId: "batch-a", usedQty: 1, lostQty: undefined, returnedQty: undefined, differenceReason: null },
    { batchId: "batch-b", usedQty: 2.5, lostQty: 0.5, returnedQty: undefined, differenceReason: "现场补用" },
  ]);
  const usageSuccess = redirectParams();
  assert.equal(usageSuccess.error, null);
  assert.match(usageSuccess.message ?? "", /2 个批次/);

  // New task + batch keys keep a shared batch attributable to each production task.
  resetCapture();
  const sharedUsageForm = new FormData();
  sharedUsageForm.set("orderId", "order-1");
  sharedUsageForm.set("usage.task-a.batch-b.usedQty", "2.5");
  sharedUsageForm.set("usage.task-a.batch-b.lostQty", "0.5");
  sharedUsageForm.set("usage.task-a.batch-b.reason", "任务 A 损耗");
  sharedUsageForm.set("usage.task-b.batch-b.usedQty", "1");
  await finishProductionWithUsage(sharedUsageForm);
  assert.equal(capture.productionCalls, 1);
  assert.deepEqual(capture.usage, [
    { taskId: "task-a", batchId: "batch-b", usedQty: 2.5, lostQty: 0.5, returnedQty: undefined, differenceReason: "任务 A 损耗" },
    { taskId: "task-b", batchId: "batch-b", usedQty: 1, lostQty: undefined, returnedQty: undefined, differenceReason: null },
  ]);

  // A submitted line without a used quantity fails before the service and surfaces the error.
  resetCapture();
  const missingUsed = new FormData();
  missingUsed.set("orderId", "order-1");
  missingUsed.set("usage.batch-a.lostQty", "1");
  await finishProductionWithUsage(missingUsed);
  assert.equal(capture.productionCalls, 0);
  assert.match(redirectParams().error ?? "", /实际用量必填/);

  // Revision action: passes the parsed quantity/time and enforces order capability.
  resetCapture();
  const revisionForm = new FormData();
  revisionForm.set("orderId", "order-2");
  revisionForm.set("quantity", "3");
  revisionForm.set("deliveryAt", "2030-01-02T03:04");
  await reviseOrder(revisionForm);
  assert.equal(capture.capability, "order");
  assert.ok(capture.reviseInput);
  assert.equal(capture.reviseInput.orderId, "order-2");
  assert.equal(capture.reviseInput.quantity, 3);
  assert.equal(capture.reviseInput.deliveryAt.getFullYear(), 2030);
  const revisionSuccess = redirectParams();
  assert.equal(revisionSuccess.error, null);
  assert.match(revisionSuccess.message ?? "", /第 3 版/);

  // Multi-line revision: every existing line posts itemQuantity.<orderItemId>.
  resetCapture();
  const multiRevisionForm = new FormData();
  multiRevisionForm.set("orderId", "order-4");
  multiRevisionForm.set("itemQuantity.item-a", "2");
  multiRevisionForm.set("itemQuantity.item-b", "5");
  multiRevisionForm.set("deliveryAt", "2030-01-04T03:04");
  await reviseOrder(multiRevisionForm);
  assert.equal(capture.reviseInput?.orderId, "order-4");
  assert.equal(capture.reviseInput?.quantity, undefined);
  assert.deepEqual(capture.reviseInput?.items, [
    { orderItemId: "item-a", quantity: 2 },
    { orderItemId: "item-b", quantity: 5 },
  ]);

  // Parallel orderItemId/itemQuantity rows are also accepted for multi-line revisions.
  resetCapture();
  const parallelRevisionForm = new FormData();
  parallelRevisionForm.set("orderId", "order-5");
  parallelRevisionForm.append("orderItemId", "item-c");
  parallelRevisionForm.append("itemQuantity", "4");
  parallelRevisionForm.append("orderItemId", "item-d");
  parallelRevisionForm.append("itemQuantity", "6");
  parallelRevisionForm.set("deliveryAt", "2030-01-05T03:04");
  await reviseOrder(parallelRevisionForm);
  assert.deepEqual(capture.reviseInput?.items, [
    { orderItemId: "item-c", quantity: 4 },
    { orderItemId: "item-d", quantity: 6 },
  ]);

  // A draft revision has no supply decision yet; its message must not claim a shortage.
  resetCapture();
  capture.reviseResult = { covered: false, totalShortage: 0 };
  const draftRevisionForm = new FormData();
  draftRevisionForm.set("orderId", "order-3");
  draftRevisionForm.set("quantity", "2");
  draftRevisionForm.set("deliveryAt", "2030-01-03T03:04");
  await reviseOrder(draftRevisionForm);
  assert.match(redirectParams().message ?? "", /草稿/);

  // Missing delivery time is rejected before the service sees the order.
  resetCapture();
  const invalidRevision = new FormData();
  invalidRevision.set("orderId", "order-2");
  invalidRevision.set("quantity", "3");
  await reviseOrder(invalidRevision);
  assert.equal(capture.reviseInput, undefined);
  assert.match(redirectParams().error ?? "", /交付时间/);

  // Purchase presentation helpers: all processed dispositions consume allocatable capacity.
  assert.equal(formatQuantity(1.23), "1.23");
  assert.equal(formatQuantity("2.500"), "2.5");
  assert.equal(outstandingAllocatableQty(10, 6, 4), 0);
  assert.equal(outstandingAllocatableQty(10, 6, 3), 1);
  assert.equal(outstandingAllocatableQty(10, 9, 5), 0);
  assert.equal(describeProgressState({ state: "ORDERED", processedQty: 0, remainingQty: 5 }), "待验收");
  assert.equal(describeProgressState({ state: "PARTIALLY_RECEIVED", processedQty: 2, remainingQty: 3 }), "部分验收");
  assert.equal(describeProgressState({ processedQty: 5, remainingQty: 0 }), "已全部处理");
  assert.deepEqual(toPurchaseReceiptRows([
    { disposition: "ACCEPTED", quantity: "2.000" },
    { disposition: "DOWNGRADED", quantity: 1 },
    { disposition: "REJECTED", quantity: "0.5" },
  ]), [
    { disposition: "ACCEPTED", quantity: 2 },
    { disposition: "DOWNGRADED", quantity: 1 },
    { disposition: "REJECTED", quantity: 0.5 },
  ]);

  const needBy = new Date("2030-01-05T10:00:00Z");
  const onTimeLine = { materialId: "material-1", expectedAt: new Date("2030-01-05T09:00:00Z"), allocatableQty: 2 };
  assert.equal(isEligiblePurchaseLine(onTimeLine, { materialId: "material-1", needBy }), true);
  assert.equal(isEligiblePurchaseLine({ ...onTimeLine, expectedAt: null }, { materialId: "material-1", needBy }), true);
  assert.equal(isEligiblePurchaseLine({ ...onTimeLine, expectedAt: new Date("2030-01-05T11:00:00Z") }, { materialId: "material-1", needBy }), false);
  assert.equal(isEligiblePurchaseLine({ ...onTimeLine, allocatableQty: 0 }, { materialId: "material-1", needBy }), false);
  assert.equal(isEligiblePurchaseLine({ ...onTimeLine, materialId: "material-2" }, { materialId: "material-1", needBy }), false);
  assert.equal(isLatePurchaseLine({ ...onTimeLine, expectedAt: new Date("2030-01-05T11:00:00Z") }, { materialId: "material-1", needBy }), true);

  const replacementOptions = sortReplacementMaterialOptions([
    { material: { code: "B", name: "乙" }, availableQty: 3 },
    { material: { code: "C", name: "丙" }, availableQty: 8 },
    { material: { code: "A", name: "甲" }, availableQty: 8 },
    { material: { code: "D", name: "丁" }, availableQty: 10 },
  ], 8);
  assert.deepEqual(replacementOptions.map((option) => option.material.code), ["D", "A", "C", "B"]);

  // Local order actions redirect back to the board and re-check capabilities before services.
  resetCapture();
  const cancelForm = new FormData();
  cancelForm.set("orderId", "order-cancel");
  cancelForm.set("reason", "顾客取消");
  await cancelOrderAction(cancelForm);
  assert.equal(capture.capability, "order");
  assert.equal(capture.lifecycle?.type, "cancel");
  assert.equal(capture.lifecycle?.input.orderId, "order-cancel");
  assert.equal(capture.lifecycle?.input.reason, "顾客取消");
  assert.equal(new URL(capture.redirect ?? "", "http://localhost").pathname, "/v2/orders");

  resetCapture();
  const startForm = new FormData();
  startForm.set("orderId", "order-start");
  await startOrderProductionAction(startForm);
  assert.equal(capture.capability, "production");
  assert.equal(capture.lifecycle?.type, "start");
  assert.equal(capture.lifecycle?.input.actorStaffId, "staff-1");
  assert.equal(redirectParams().error, null);

  resetCapture();
  const rescheduleForm = new FormData();
  rescheduleForm.set("orderId", "order-delivery");
  rescheduleForm.set("scheduledAt", "2030-01-06T09:30");
  rescheduleForm.set("note", "顾客改到上午");
  await rescheduleDeliveryAttemptAction(rescheduleForm);
  assert.equal(capture.capability, "delivery");
  assert.equal(capture.delivery?.type, "reschedule");
  assert.equal(capture.delivery?.input.attemptId, undefined);
  assert.equal((capture.delivery?.input.scheduledAt as Date).getFullYear(), 2030);
  assert.equal(capture.delivery?.input.note, "顾客改到上午");

  resetCapture();
  const deliveryCostForm = new FormData();
  deliveryCostForm.set("orderId", "order-delivery");
  deliveryCostForm.set("attemptId", "attempt-1");
  deliveryCostForm.set("amount", "12.50");
  deliveryCostForm.set("note", "同城跑腿");
  await recordDeliveryActualCostAction(deliveryCostForm);
  assert.equal(capture.capability, "delivery");
  assert.equal(capture.deliveryCost?.amount, 12.5);
  assert.equal(capture.deliveryCost?.attemptId, "attempt-1");
  assert.equal(capture.deliveryCost?.note, "同城跑腿");

  console.log("v2 order UI helper tests passed");
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
