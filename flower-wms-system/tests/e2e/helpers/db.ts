import { Client } from "pg";

/**
 * Read-only database assertions for browser E2E.
 *
 * The E2E run executes inside the throw-away database harness, so
 * V2_DATABASE_URL is the isolated per-run cluster. Connection strings are never
 * printed; a missing variable means the test was not started through the harness
 * and should fail loudly instead of touching a developer database.
 */
function databaseUrl(): string {
  const url = process.env.V2_DATABASE_URL;
  if (!url) {
    throw new Error("V2_DATABASE_URL is missing; run browser E2E through the isolated database harness.");
  }
  return url;
}

export async function dbQuery<T = Record<string, unknown>>(
  sql: string,
  params: readonly unknown[] = [],
): Promise<T[]> {
  const client = new Client({ connectionString: databaseUrl() });
  await client.connect();
  try {
    const result = await client.query(sql, params as unknown[]);
    return result.rows as T[];
  } finally {
    await client.end();
  }
}

export async function dbOne<T = Record<string, unknown>>(
  sql: string,
  params: readonly unknown[] = [],
): Promise<T | null> {
  const rows = await dbQuery<T>(sql, params);
  return rows[0] ?? null;
}

export type MaterialRow = { id: string; code: string; name: string; base_unit: string };
export type OrderRow = {
  id: string;
  number: string;
  commercial_state: string;
  supply_state: string;
  production_state: string;
  fulfillment_state: string;
};

export async function materialByCode(code: string): Promise<MaterialRow> {
  const row = await dbOne<MaterialRow>(
    'SELECT id, code, name, "baseUnit" AS base_unit FROM "Material" WHERE code = $1',
    [code],
  );
  if (!row) throw new Error(`Material ${code} was not created`);
  return row;
}

export async function supplierByCode(code: string): Promise<{ id: string; code: string }> {
  const row = await dbOne<{ id: string; code: string }>(
    'SELECT id, code FROM "Supplier" WHERE code = $1',
    [code],
  );
  if (!row) throw new Error(`Supplier ${code} was not created`);
  return row;
}

export async function orderByBuyer(buyerName: string): Promise<OrderRow> {
  const row = await dbOne<OrderRow>(
    `SELECT id, number,
            "commercialState" AS commercial_state,
            "supplyState" AS supply_state,
            "productionState" AS production_state,
            "fulfillmentState" AS fulfillment_state
       FROM "Order" WHERE "buyerNameSnapshot" = $1 ORDER BY "createdAt" DESC LIMIT 1`,
    [buyerName],
  );
  if (!row) throw new Error(`Order for buyer ${buyerName} was not found`);
  return row;
}

export async function productSkuByProductName(productName: string): Promise<{ id: string; code: string }> {
  const row = await dbOne<{ id: string; code: string }>(
    `SELECT s.id, s.code
       FROM "ProductSku" s
       JOIN "Product" p ON p.id = s."productId"
      WHERE p.name = $1
      ORDER BY s.code ASC LIMIT 1`,
    [productName],
  );
  if (!row) throw new Error(`SKU for product ${productName} was not found`);
  return row;
}

export async function publishedRecipeLines(skuId: string): Promise<{ material_code: string; planned_qty: string }[]> {
  return dbQuery(
    `SELECT m.code AS material_code, l."plannedQty" AS planned_qty
       FROM "RecipeLine" l
       JOIN "RecipeVersion" v ON v.id = l."versionId"
       JOIN "Recipe" r ON r.id = v."recipeId"
       JOIN "Material" m ON m.id = l."materialId"
      WHERE r."skuId" = $1 AND v.state = 'PUBLISHED'
      ORDER BY m.code ASC`,
    [skuId],
  );
}

export async function latestPurchaseOrderForSupplier(supplierCode: string): Promise<{ id: string; number: string; state: string }> {
  const row = await dbOne<{ id: string; number: string; state: string }>(
    `SELECT o.id, o.number, o.state
       FROM "PurchaseOrder" o
       JOIN "Supplier" s ON s.id = o."supplierId"
      WHERE s.code = $1
      ORDER BY o."createdAt" DESC LIMIT 1`,
    [supplierCode],
  );
  if (!row) throw new Error(`Purchase order for supplier ${supplierCode} was not found`);
  return row;
}

export async function purchaseLineProgress(purchaseOrderNumber: string): Promise<{
  line_id: string;
  ordered_qty: string;
  accepted: string;
  downgraded: string;
  rejected: string;
  relation_kind: string;
}[]> {
  return dbQuery(
    `SELECT l.id AS line_id,
            l."orderedQty" AS ordered_qty,
            COALESCE(SUM(CASE WHEN r.disposition = 'ACCEPTED' THEN r.quantity ELSE 0 END), 0) AS accepted,
            COALESCE(SUM(CASE WHEN r.disposition = 'DOWNGRADED' THEN r.quantity ELSE 0 END), 0) AS downgraded,
            COALESCE(SUM(CASE WHEN r.disposition = 'REJECTED' THEN r.quantity ELSE 0 END), 0) AS rejected,
            l."relationKind" AS relation_kind
       FROM "PurchaseOrderLine" l
       JOIN "PurchaseOrder" o ON o.id = l."purchaseOrderId"
       LEFT JOIN "GoodsReceiptLine" r ON r."purchaseLineId" = l.id
      WHERE o.number = $1
      GROUP BY l.id, l."orderedQty", l."relationKind"
      ORDER BY l."createdAt" ASC`,
    [purchaseOrderNumber],
  );
}

export async function latestBatchForMaterial(materialCode: string): Promise<{ id: string; batch_no: string }> {
  const row = await dbOne<{ id: string; batch_no: string }>(
    `SELECT b.id, b."batchNo" AS batch_no
       FROM "InventoryBatch" b
       JOIN "Material" m ON m.id = b."materialId"
      WHERE m.code = $1
      ORDER BY b."receivedAt" DESC LIMIT 1`,
    [materialCode],
  );
  if (!row) throw new Error(`Inventory batch for material ${materialCode} was not found`);
  return row;
}

export async function batchOnHand(batchId: string, locationCode = "STOCK"): Promise<number> {
  const row = await dbOne<{ on_hand: string | null }>(
    `SELECT b."onHandQty" AS on_hand
       FROM "BatchBalance" b
       JOIN "InventoryLocation" l ON l.id = b."locationId"
      WHERE b."batchId" = $1 AND l.code = $2`,
    [batchId, locationCode],
  );
  return Number(row?.on_hand ?? 0);
}

/** Total on-hand quantity for all batches of one material at a location. */
export async function totalOnHandForMaterial(materialCode: string, locationCode = "STOCK"): Promise<number> {
  const row = await dbOne<{ on_hand: string | null }>(
    `SELECT COALESCE(SUM(bb."onHandQty"), 0) AS on_hand
       FROM "BatchBalance" bb
       JOIN "InventoryBatch" b ON b.id = bb."batchId"
       JOIN "Material" m ON m.id = b."materialId"
       JOIN "InventoryLocation" l ON l.id = bb."locationId"
      WHERE m.code = $1 AND l.code = $2`,
    [materialCode, locationCode],
  );
  return Number(row?.on_hand ?? 0);
}
export async function batchAdjustmentTransactionCount(batchId: string): Promise<number> {
  const row = await dbOne<{ count: string }>(
    `SELECT COUNT(*)::text AS count
       FROM "InventoryTransaction"
      WHERE "batchId" = $1 AND kind = 'ADJUSTMENT'`,
    [batchId],
  );
  return Number(row?.count ?? 0);
}

export async function latestStocktakeForBatch(batchId: string): Promise<{
  id: string;
  state: string;
  review_note: string | null;
  review_reasons: unknown;
}> {
  const row = await dbOne<{ id: string; state: string; review_note: string | null; review_reasons: unknown }>(
    `SELECT s.id, s.state, s."reviewNote" AS review_note, s."reviewReasons" AS review_reasons
       FROM "Stocktake" s
       JOIN "StocktakeLine" l ON l."stocktakeId" = s.id
      WHERE l."batchId" = $1
      ORDER BY s."createdAt" DESC LIMIT 1`,
    [batchId],
  );
  if (!row) throw new Error("Stocktake for batch was not found");
  return row;
}

/** Table counts used to prove a capability-gated request created no rows. */
export async function tableCounts(): Promise<{ materials: number; orders: number; purchases: number }> {
  const row = await dbOne<{ materials: string; orders: string; purchases: string }>(
    `SELECT (SELECT COUNT(*)::text FROM "Material") AS materials,
            (SELECT COUNT(*)::text FROM "Order") AS orders,
            (SELECT COUNT(*)::text FROM "PurchaseOrder") AS purchases`,
  );
  return {
    materials: Number(row?.materials ?? 0),
    orders: Number(row?.orders ?? 0),
    purchases: Number(row?.purchases ?? 0),
  };
}

/** Sum of active reservation quantities for one order. */
export async function activeReservationQty(orderId: string): Promise<number> {
  const row = await dbOne<{ quantity: string | null }>(
    `SELECT SUM(r.quantity) AS quantity
       FROM "InventoryReservation" r
       JOIN "OrderMaterialRequirement" req ON req.id = r."requirementId"
       JOIN "OrderItem" item ON item.id = req."orderItemId"
      WHERE item."orderId" = $1 AND r.state = 'ACTIVE'`,
    [orderId],
  );
  return Number(row?.quantity ?? 0);
}

export async function activeReservationsByMaterial(orderId: string): Promise<{ code: string; quantity: string }[]> {
  return dbQuery(
    `SELECT m.code, SUM(r.quantity) AS quantity
       FROM "InventoryReservation" r
       JOIN "OrderMaterialRequirement" req ON req.id = r."requirementId"
       JOIN "OrderItem" item ON item.id = req."orderItemId"
       JOIN "Material" m ON m.id = req."materialId"
      WHERE item."orderId" = $1 AND r.state = 'ACTIVE'
      GROUP BY m.code`,
    [orderId],
  );
}

export async function materialUsageForOrder(orderId: string): Promise<{
  material_code: string;
  used_qty: string;
  lost_qty: string;
  returned_qty: string;
  difference_reason: string | null;
}[]> {
  return dbQuery(
    `SELECT m.code AS material_code, u."usedQty" AS used_qty, u."lostQty" AS lost_qty,
            u."returnedQty" AS returned_qty, u."differenceReason" AS difference_reason
       FROM "MaterialUsage" u
       JOIN "ProductionTask" t ON t.id = u."taskId"
       JOIN "OrderItem" i ON i.id = t."orderItemId"
       JOIN "InventoryBatch" b ON b.id = u."batchId"
       JOIN "Material" m ON m.id = b."materialId"
      WHERE i."orderId" = $1
      ORDER BY m.code`,
    [orderId],
  );
}

export async function costSnapshotsForOrder(orderId: string): Promise<{
  revision_no: number;
  delivery_cost: string;
  estimated: boolean;
}[]> {
  return dbQuery(
    `SELECT "revisionNo" AS revision_no, "deliveryCost" AS delivery_cost, estimated
       FROM "OrderCostSnapshot" WHERE "orderId" = $1 ORDER BY "revisionNo"`,
    [orderId],
  );
}

export async function costAdjustmentsForOrder(orderId: string): Promise<{ kind: string; amount_delta: string; reason: string }[]> {
  return dbQuery(
    `SELECT kind, "amountDelta" AS amount_delta, reason
       FROM "CostAdjustment" WHERE "orderId" = $1 ORDER BY "createdAt"`,
    [orderId],
  );
}

export async function deliveryAttemptsForOrder(orderId: string): Promise<{
  attempt_no: number;
  state: string;
  failure_reason: string | null;
  delivery_cost: string | null;
}[]> {
  return dbQuery(
    `SELECT a."attemptNo" AS attempt_no, a.state, a."failureReason" AS failure_reason,
            a."deliveryCost" AS delivery_cost
       FROM "DeliveryAttempt" a
       JOIN "Fulfillment" f ON f.id = a."fulfillmentId"
      WHERE f."orderId" = $1 ORDER BY a."attemptNo"`,
    [orderId],
  );
}

/** Serializes the Prisma JSON-ish snapshot columns for readable assertions. */
export function parseJson(value: unknown): unknown {
  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }
  return value;
}
