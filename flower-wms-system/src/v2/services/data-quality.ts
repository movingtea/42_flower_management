import type { PrismaClient } from "../../generated/prisma-v2/client";
import {
  createDataQualityIssue,
  issueBrokenReference,
  issueCrossTenantReference,
  issueDeliveredWithoutSnapshot,
  issueExpiredStock,
  issueIllegalQuantity,
  issueInactiveSupplierOnOpenPurchase,
  issueInventoryAnomaly,
  issueMissingRecipe,
  issueMissingStandardCost,
  issueMissingTenantStore,
  issuePublishedRecipeWithoutLines,
  issueZeroCostSnapshot,
  issueUnreceiveablePurchaseLine,
  sortDataQualityIssues,
  summarizeDataQualityIssues,
  type DataQualityCheckResult,
  type DataQualityDomain,
  type DataQualityIssue,
  type DataQualityResult,
} from "../domain/data-quality";

export type V2DataQualityScope = { tenantId: string; storeId: string };

const OPEN_PURCHASE_STATES = ["ORDERED", "PARTIALLY_RECEIVED"] as const;

/**
 * Scan caps for checks that need the raw rows instead of a display page. A
 * check that reaches its cap feeds `truncated` so the page can tell the user
 * that the anomaly count may be incomplete; the caps also keep every query
 * bounded on a large tenant.
 */
const STORE_SCAN_LIMIT = 500;
const MATERIAL_SCAN_LIMIT = 1000;
const PACKAGING_KIT_SCAN_LIMIT = 500;
const RESERVATION_SCAN_LIMIT = 2000;
const PURCHASE_OPEN_LINE_SCAN_LIMIT = 1000;
const SNAPSHOT_SCAN_LIMIT = 2000;

function text(value: unknown): string {
  return value == null ? "" : String(value);
}

/**
 * Read-only V2 data-quality collection.
 *
 * Every query is scoped to the active tenant/store and capped. The service never
 * repairs, rewrites or deletes a row; the page only links to the owning module.
 */
export async function collectDataQualityIssues(
  db: PrismaClient,
  scope: V2DataQualityScope,
  options: { now?: Date; take?: number } = {},
): Promise<DataQualityResult> {
  const now = options.now ?? new Date();
  const take = Math.min(200, Math.max(1, options.take ?? 50));
  const issues: DataQualityIssue[] = [];
  const checks: DataQualityCheckResult[] = [];
  let truncated = false;

  function addCheck(
    key: string,
    domain: DataQualityDomain,
    title: string,
    items: DataQualityIssue[],
  ) {
    issues.push(...items);
    checks.push({ key, domain, title, issueCount: items.length });
    if (items.length >= take) truncated = true;
  }

  /** Flags a scan that hit its hard cap, even when it produced no issue. */
  function markScan(rows: readonly unknown[], limit: number) {
    if (rows.length >= limit) truncated = true;
  }

  // ---------------------------------------------------------------- tenancy
  const stores = await db.store.findMany({
    where: { tenantId: scope.tenantId },
    select: {
      id: true,
      code: true,
      name: true,
      locations: { select: { id: true, kind: true } },
    },
    take: STORE_SCAN_LIMIT,
  });
  markScan(stores, STORE_SCAN_LIMIT);

  const tenancyIssues: DataQualityIssue[] = [];
  if (stores.length === 0) {
    tenancyIssues.push(
      issueMissingTenantStore("Tenant", scope.tenantId, "当前租户没有任何门店，V2 业务数据无法归属。"),
    );
  }
  for (const store of stores) {
    if (!store.locations.some((location) => location.kind === "WAREHOUSE")) {
      tenancyIssues.push(issueMissingTenantStore(
        "Store",
        store.id,
        `门店「${store.name}」（${store.code}）没有仓库库位，验收入库和损耗登记会失败。`,
      ));
    }
  }
  addCheck("store_ownership", "TENANCY", "门店与仓库库位归属", tenancyIssues);

  const crossTenantOrders = await db.order.findMany({
    where: { tenantId: scope.tenantId, store: { tenantId: { not: scope.tenantId } } },
    select: { id: true, number: true, tenantId: true, storeId: true },
    take,
  });
  addCheck(
    "order_store_tenant",
    "TENANCY",
    "订单门店归属",
    crossTenantOrders.map((order) => issueCrossTenantReference(
      "Order",
      order.id,
      `订单 ${order.number} 的 tenantId=${order.tenantId} 与门店 storeId=${order.storeId} 归属不一致。`,
    )),
  );

  const crossTenantOrderItems = await db.orderItem.findMany({
    where: {
      order: { tenantId: scope.tenantId, storeId: scope.storeId },
      sku: { is: { product: { tenantId: { not: scope.tenantId } } } },
    },
    select: {
      id: true,
      nameSnapshot: true,
      order: { select: { number: true } },
    },
    take,
  });
  addCheck(
    "order_item_sku_tenant",
    "TENANCY",
    "订单明细商品租户归属",
    crossTenantOrderItems.map((item) => issueCrossTenantReference(
      "OrderItem",
      item.id,
      `订单 ${item.order.number} 的「${item.nameSnapshot}」引用了其他租户的 SKU。`,
    )),
  );

  const crossTenantPurchases = await db.purchaseOrder.findMany({
    where: {
      tenantId: scope.tenantId,
      OR: [
        { store: { tenantId: { not: scope.tenantId } } },
        { supplier: { tenantId: { not: scope.tenantId } } },
      ],
    },
    select: { id: true, number: true },
    take,
  });
  addCheck(
    "purchase_tenant",
    "TENANCY",
    "采购单租户归属",
    crossTenantPurchases.map((purchase) => issueCrossTenantReference(
      "PurchaseOrder",
      purchase.id,
      `采购单 ${purchase.number} 的门店或供应商不属于当前租户。`,
    )),
  );

  const crossTenantBatches = await db.inventoryBatch.findMany({
    where: {
      storeId: scope.storeId,
      OR: [
        { store: { tenantId: { not: scope.tenantId } } },
        { material: { tenantId: { not: scope.tenantId } } },
      ],
    },
    select: { id: true, batchNo: true },
    take,
  });
  addCheck(
    "batch_tenant",
    "TENANCY",
    "批次租户归属",
    crossTenantBatches.map((batch) => issueCrossTenantReference(
      "InventoryBatch",
      batch.id,
      `批次 ${batch.batchNo} 的门店或物料不属于当前租户。`,
    )),
  );

  const storeMembers = await db.storeMember.findMany({
    where: { storeId: scope.storeId, active: true },
    select: {
      staffUserId: true,
      staffUser: {
        select: {
          username: true,
          tenantMembers: {
            where: { tenantId: scope.tenantId },
            select: { active: true },
          },
        },
      },
    },
    take,
  });
  markScan(storeMembers, take);
  addCheck(
    "member_tenant_link",
    "TENANCY",
    "门店成员租户归属",
    storeMembers
      .filter((member) => !member.staffUser.tenantMembers.some((tenantMember) => tenantMember.active))
      .map((member) => issueMissingTenantStore(
        "StoreMember",
        member.staffUserId,
        `门店成员 ${member.staffUser.username} 缺少同租户的有效 TenantMember。`,
      )),
  );

  const tenantMembers = await db.tenantMember.findMany({
    where: { tenantId: scope.tenantId, active: true },
    select: {
      staffUserId: true,
      staffUser: {
        select: {
          username: true,
          storeMembers: {
            where: { active: true, store: { tenantId: scope.tenantId } },
            select: { id: true },
          },
        },
      },
    },
    take,
  });
  markScan(tenantMembers, take);
  addCheck(
    "member_store_link",
    "TENANCY",
    "租户成员门店归属",
    tenantMembers
      .filter((member) => member.staffUser.storeMembers.length === 0)
      .map((member) => issueMissingTenantStore(
        "TenantMember",
        member.staffUserId,
        `租户成员 ${member.staffUser.username} 没有任何有效 StoreMember，无法进入 V2 工作台。`,
      )),
  );

  // ------------------------------------------------------------ master data
  const materials = await db.material.findMany({
    where: { tenantId: scope.tenantId, active: true },
    select: {
      id: true,
      name: true,
      kind: true,
      standardUnitCost: true,
      categories: { select: { categoryId: true } },
    },
    orderBy: { code: "asc" },
    take: MATERIAL_SCAN_LIMIT,
  });
  markScan(materials, MATERIAL_SCAN_LIMIT);
  addCheck(
    "material_cost",
    "MASTER_DATA",
    "花材标准成本",
    materials
      .filter((material) =>
        (material.kind === "FLOWER" || material.kind === "FOLIAGE")
        && (material.standardUnitCost == null || Number(material.standardUnitCost) <= 0),
      )
      .slice(0, take)
      .map((material) => issueMissingStandardCost(material.id, material.name)),
  );
  addCheck(
    "material_category",
    "MASTER_DATA",
    "物料分类",
    materials
      .filter((material) => material.categories.length === 0)
      .slice(0, take)
      .map((material) => createDataQualityIssue({
        severity: "SUGGESTION",
        domain: "MASTER_DATA",
        entityType: "Material",
        entityId: material.id,
        title: "物料未关联分类",
        message: `物料「${material.name}」未关联任何原材料分类。`,
        actionLabel: "维护分类",
        actionHref: "/v2/material-categories",
      })),
  );

  const inactiveSupplierPurchases = await db.purchaseOrder.findMany({
    where: {
      tenantId: scope.tenantId,
      storeId: scope.storeId,
      state: { in: [...OPEN_PURCHASE_STATES] },
      supplier: { active: false },
    },
    select: { id: true, number: true, supplier: { select: { name: true } } },
    take,
  });
  addCheck(
    "inactive_supplier",
    "MASTER_DATA",
    "进行中采购单供应商",
    inactiveSupplierPurchases.map((purchase) => issueInactiveSupplierOnOpenPurchase(
      purchase.id,
      purchase.number,
      purchase.supplier.name,
    )),
  );

  const packagingKits = await db.packagingKit.findMany({
    where: { tenantId: scope.tenantId, active: true },
    select: { id: true, name: true, _count: { select: { lines: true } } },
    take: PACKAGING_KIT_SCAN_LIMIT,
  });
  markScan(packagingKits, PACKAGING_KIT_SCAN_LIMIT);
  addCheck(
    "packaging_kit_lines",
    "MASTER_DATA",
    "包装方案明细",
    packagingKits
      .filter((kit) => kit._count.lines === 0)
      .slice(0, take)
      .map((kit) => createDataQualityIssue({
        severity: "WARNING",
        domain: "MASTER_DATA",
        entityType: "PackagingKit",
        entityId: kit.id,
        title: "包装方案没有明细",
        message: `包装方案「${kit.name}」没有包装物料明细。`,
        actionLabel: "维护包装方案",
        actionHref: "/v2/packaging-kits",
      })),
  );

  // --------------------------------------------------------------- recipes
  const skusWithoutRecipe = await db.productSku.findMany({
    where: {
      active: true,
      product: { tenantId: scope.tenantId, active: true },
      OR: [
        { recipe: { is: null } },
        { recipe: { versions: { none: { state: "PUBLISHED" } } } },
      ],
    },
    select: {
      id: true,
      name: true,
      product: { select: { name: true } },
    },
    take,
  });
  addCheck(
    "sku_recipe",
    "RECIPE",
    "在售 SKU 配方",
    skusWithoutRecipe.map((sku) => issueMissingRecipe(sku.id, sku.product.name, sku.name)),
  );

  const emptyPublishedVersions = await db.recipeVersion.findMany({
    where: {
      state: "PUBLISHED",
      lines: { none: {} },
      recipe: { sku: { product: { tenantId: scope.tenantId } } },
    },
    select: {
      id: true,
      recipe: { select: { sku: { select: { name: true, product: { select: { name: true } } } } } },
    },
    take,
  });
  addCheck(
    "recipe_lines",
    "RECIPE",
    "已发布配方明细",
    emptyPublishedVersions.map((version) => issuePublishedRecipeWithoutLines(
      version.id,
      version.recipe.sku.product.name,
      version.recipe.sku.name,
    )),
  );

  const invalidRecipeLines = await db.recipeLine.findMany({
    where: {
      OR: [{ plannedQty: { lte: 0 } }, { expectedLossRate: { lt: 0 } }],
      version: { recipe: { sku: { product: { tenantId: scope.tenantId } } } },
    },
    select: {
      id: true,
      plannedQty: true,
      expectedLossRate: true,
      material: { select: { name: true } },
      version: { select: { recipe: { select: { sku: { select: { name: true } } } } } },
    },
    take,
  });
  addCheck(
    "recipe_quantities",
    "RECIPE",
    "配方数量与损耗率",
    invalidRecipeLines.map((line) => issueIllegalQuantity(
      "RECIPE",
      "RecipeLine",
      line.id,
      `配方「${line.version.recipe.sku.name}」的物料「${line.material.name}」计划数量为 ${text(line.plannedQty)}、损耗率为 ${text(line.expectedLossRate)}，必须为非负数且计划数量大于 0。`,
      "/v2/recipes",
    )),
  );

  // ------------------------------------------------------------- inventory
  type BalanceAnomaly = {
    id: string;
    onHandQty: string;
    frozenQty: string;
    batchNo: string;
    materialName: string;
  };
  const balanceAnomalies = await db.$queryRaw<BalanceAnomaly[]>`
    SELECT bb.id,
           bb."onHandQty"::text AS "onHandQty",
           bb."frozenQty"::text AS "frozenQty",
           b."batchNo" AS "batchNo",
           m."name" AS "materialName"
    FROM "BatchBalance" bb
    JOIN "InventoryBatch" b ON b.id = bb."batchId"
    JOIN "Material" m ON m.id = b."materialId"
    WHERE b."storeId" = ${scope.storeId}
      AND (bb."onHandQty" < 0 OR bb."frozenQty" < 0 OR bb."frozenQty" > bb."onHandQty")
    LIMIT ${take}
  `;
  addCheck(
    "balance_anomaly",
    "INVENTORY",
    "批次库存数量",
    balanceAnomalies.map((balance) => issueInventoryAnomaly(
      "BatchBalance",
      balance.id,
      "批次库存数量异常",
      `批次「${balance.batchNo}」的物料「${balance.materialName}」实存 ${balance.onHandQty}、冻结 ${balance.frozenQty}；实存/冻结不能为负，冻结不能大于实存。`,
      "/v2/inventory",
    )),
  );

  const crossStoreBalances = await db.batchBalance.findMany({
    where: {
      batch: { storeId: scope.storeId },
      location: { storeId: { not: scope.storeId } },
    },
    select: {
      id: true,
      batch: { select: { batchNo: true } },
      location: { select: { code: true, storeId: true } },
    },
    take,
  });
  addCheck(
    "balance_location_tenant",
    "TENANCY",
    "库存库位门店归属",
    crossStoreBalances.map((balance) => issueCrossTenantReference(
      "BatchBalance",
      balance.id,
      `批次「${balance.batch.batchNo}」的库存位于另一门店（${balance.location.storeId}）的库位「${balance.location.code}」，库存归属不一致。`,
    )),
  );

  const expiredBatches = await db.inventoryBatch.findMany({
    where: {
      storeId: scope.storeId,
      usableUntil: { lt: now },
      balances: { some: { onHandQty: { gt: 0 } } },
    },
    select: {
      id: true,
      batchNo: true,
      material: { select: { name: true } },
      balances: { select: { onHandQty: true } },
    },
    take,
  });
  addCheck(
    "expired_stock",
    "INVENTORY",
    "过期库存",
    expiredBatches.map((batch) => issueExpiredStock(
      batch.id,
      batch.batchNo,
      batch.material.name,
      batch.balances.reduce((sum, balance) => sum + Number(balance.onHandQty), 0),
    )),
  );

  const invalidBatches = await db.inventoryBatch.findMany({
    where: { storeId: scope.storeId, unitCost: { lte: 0 } },
    select: { id: true, batchNo: true, unitCost: true },
    take,
  });
  addCheck(
    "batch_cost",
    "INVENTORY",
    "批次单位成本",
    invalidBatches.map((batch) => createDataQualityIssue({
      severity: "WARNING",
      domain: "INVENTORY",
      entityType: "InventoryBatch",
      entityId: batch.id,
      title: "批次单位成本无效",
      message: `批次「${batch.batchNo}」的单位成本为 ${text(batch.unitCost)}，应大于 0。`,
      actionLabel: "查看库存",
      actionHref: "/v2/inventory",
    })),
  );

  const activeReservations = await db.inventoryReservation.findMany({
    where: { state: "ACTIVE", batch: { storeId: scope.storeId } },
    select: {
      id: true,
      quantity: true,
      batch: {
        select: {
          materialId: true,
          batchNo: true,
          material: { select: { name: true } },
        },
      },
      requirement: {
        select: {
          materialId: true,
          material: { select: { name: true } },
        },
      },
    },
    take: RESERVATION_SCAN_LIMIT,
  });
  markScan(activeReservations, RESERVATION_SCAN_LIMIT);
  const reservationIssues: DataQualityIssue[] = [];
  for (const reservation of activeReservations) {
    if (Number(reservation.quantity) <= 0) {
      reservationIssues.push(issueIllegalQuantity(
        "INVENTORY",
        "InventoryReservation",
        reservation.id,
        `有效预留数量为 ${text(reservation.quantity)}，必须大于 0。`,
        "/v2/orders",
      ));
    }
    if (reservation.batch.materialId !== reservation.requirement.materialId) {
      reservationIssues.push(issueBrokenReference(
        "INVENTORY",
        "InventoryReservation",
        reservation.id,
        `批次「${reservation.batch.batchNo}」的物料「${reservation.batch.material.name}」与订单需求的物料「${reservation.requirement.material.name}」不一致，预留引用了错误的批次。`,
        "/v2/orders",
      ));
    }
  }
  addCheck("reservation_integrity", "INVENTORY", "有效预留引用与数量", reservationIssues.slice(0, take));

  // ---------------------------------------------------------------- orders
  const invalidOrderItems = await db.orderItem.findMany({
    where: {
      order: { tenantId: scope.tenantId, storeId: scope.storeId },
      OR: [{ quantity: { lte: 0 } }, { unitPrice: { lt: 0 } }],
    },
    select: {
      id: true,
      quantity: true,
      unitPrice: true,
      nameSnapshot: true,
      order: { select: { number: true } },
    },
    take,
  });
  addCheck(
    "order_item_quantity",
    "ORDER",
    "订单明细数量与价格",
    invalidOrderItems.map((item) => issueIllegalQuantity(
      "ORDER",
      "OrderItem",
      item.id,
      `订单 ${item.order.number} 的「${item.nameSnapshot}」数量 ${item.quantity}、单价 ${text(item.unitPrice)}；数量必须大于 0，单价不能为负。`,
      `/v2/orders`,
    )),
  );

  const deliveredWithoutSnapshot = await db.order.findMany({
    where: {
      tenantId: scope.tenantId,
      storeId: scope.storeId,
      fulfillmentState: "DELIVERED",
      costSnapshots: { none: {} },
    },
    select: { id: true, number: true },
    take,
  });
  addCheck(
    "delivered_cost_snapshot",
    "COST",
    "已交付订单成本快照",
    deliveredWithoutSnapshot.map((order) => issueDeliveredWithoutSnapshot(order.id, order.number)),
  );

  // -------------------------------------------------------------- purchase
  const invalidPurchaseLines = await db.purchaseOrderLine.findMany({
    where: {
      purchaseOrder: { tenantId: scope.tenantId, storeId: scope.storeId },
      OR: [{ orderedQty: { lte: 0 } }, { expectedBaseQty: { lte: 0 } }],
    },
    select: {
      id: true,
      orderedQty: true,
      expectedBaseQty: true,
      material: { select: { name: true } },
      purchaseOrder: { select: { number: true } },
    },
    take,
  });
  addCheck(
    "purchase_line_quantity",
    "PURCHASE",
    "采购明细数量",
    invalidPurchaseLines.map((line) => issueIllegalQuantity(
      "PURCHASE",
      "PurchaseOrderLine",
      line.id,
      `采购单 ${line.purchaseOrder.number} 的「${line.material.name}」订购数量 ${text(line.orderedQty)}、基础数量 ${text(line.expectedBaseQty)}；必须大于 0。`,
      "/v2/purchase-orders",
    )),
  );

  const invalidReceiptLines = await db.goodsReceiptLine.findMany({
    where: {
      receipt: { storeId: scope.storeId },
      quantity: { lte: 0 },
    },
    select: { id: true, quantity: true, receipt: { select: { id: true } } },
    take,
  });
  addCheck(
    "receipt_quantity",
    "PURCHASE",
    "验收明细数量",
    invalidReceiptLines.map((line) => issueIllegalQuantity(
      "PURCHASE",
      "GoodsReceiptLine",
      line.id,
      `验收单 ${line.receipt.id} 存在数量 ${text(line.quantity)} 的明细，必须大于 0。`,
      "/v2/purchase-orders",
    )),
  );

  const purchaseLinesWithoutBase = await db.purchaseOrderLine.findMany({
    where: {
      expectedBaseQty: null,
      purchaseOrder: { tenantId: scope.tenantId, storeId: scope.storeId, state: { in: [...OPEN_PURCHASE_STATES] } },
    },
    select: {
      id: true,
      purchaseUnit: true,
      material: { select: { name: true, baseUnit: true } },
      purchaseOrder: { select: { number: true } },
    },
    take: PURCHASE_OPEN_LINE_SCAN_LIMIT,
  });
  markScan(purchaseLinesWithoutBase, PURCHASE_OPEN_LINE_SCAN_LIMIT);
  addCheck(
    "purchase_base_quantity",
    "PURCHASE",
    "采购基础数量可验收性",
    purchaseLinesWithoutBase
      .filter((line) => line.purchaseUnit !== line.material.baseUnit)
      .slice(0, take)
      .map((line) => issueUnreceiveablePurchaseLine(
        line.id,
        line.purchaseOrder.number,
        line.material.name,
      )),
  );

  // ------------------------------------------------------------------ cost
  const lossBadQuantity = await db.lossRecord.findMany({
    where: {
      storeId: scope.storeId,
      store: { tenantId: scope.tenantId },
      quantity: { lte: 0 },
    },
    select: { id: true, quantity: true, reason: true },
    take,
  });
  addCheck(
    "loss_quantity",
    "COST",
    "损耗数量",
    lossBadQuantity.map((loss) => issueIllegalQuantity(
      "COST",
      "LossRecord",
      loss.id,
      `损耗记录数量为 ${text(loss.quantity)}，必须大于 0。`,
      "/v2/operations#loss",
    )),
  );

  const badUsages = await db.materialUsage.findMany({
    where: {
      task: { orderItem: { order: { tenantId: scope.tenantId, storeId: scope.storeId } } },
      OR: [
        { usedQty: { lt: 0 } },
        { lostQty: { lt: 0 } },
        { returnedQty: { lt: 0 } },
      ],
    },
    select: {
      id: true,
      usedQty: true,
      lostQty: true,
      returnedQty: true,
      batch: { select: { batchNo: true } },
    },
    take,
  });
  addCheck(
    "usage_quantity",
    "COST",
    "制作实际用料数量",
    badUsages.map((usage) => issueIllegalQuantity(
      "COST",
      "MaterialUsage",
      usage.id,
      `批次「${usage.batch.batchNo}」的用料为 ${text(usage.usedQty)}、损耗 ${text(usage.lostQty)}、退料 ${text(usage.returnedQty)}，均不能为负。`,
      "/v2/orders",
    )),
  );

  const badStocktakeLines = await db.stocktakeLine.findMany({
    where: {
      stocktake: { storeId: scope.storeId },
      countedQty: { lt: 0 },
    },
    select: { id: true, countedQty: true },
    take,
  });
  addCheck(
    "stocktake_quantity",
    "COST",
    "盘点数量",
    badStocktakeLines.map((line) => issueIllegalQuantity(
      "COST",
      "StocktakeLine",
      line.id,
      `盘点实盘数量为 ${text(line.countedQty)}，不能为负。`,
      "/v2/operations#stocktake",
    )),
  );

  const snapshots = await db.orderCostSnapshot.findMany({
    where: {
      order: { tenantId: scope.tenantId, storeId: scope.storeId },
      revenue: { gt: 0 },
    },
    select: {
      id: true,
      materialCost: true,
      packagingCost: true,
      consumableCost: true,
      laborCost: true,
      deliveryCost: true,
      platformCost: true,
      attributedLossCost: true,
      revenue: true,
      order: { select: { id: true, number: true } },
    },
    orderBy: [{ orderId: "asc" }, { revisionNo: "desc" }],
    take: SNAPSHOT_SCAN_LIMIT,
  });
  markScan(snapshots, SNAPSHOT_SCAN_LIMIT);
  // Snapshots are versioned per order. Only the latest revision is authoritative;
  // older zero-cost revisions would otherwise repeat an issue for the same order.
  const latestSnapshotByOrder = new Map<string, (typeof snapshots)[number]>();
  for (const snapshot of snapshots) {
    if (!latestSnapshotByOrder.has(snapshot.order.id)) {
      latestSnapshotByOrder.set(snapshot.order.id, snapshot);
    }
  }
  const zeroSnapshots = [...latestSnapshotByOrder.values()].filter((snapshot) =>
    Number(snapshot.materialCost)
      + Number(snapshot.packagingCost)
      + Number(snapshot.consumableCost)
      + Number(snapshot.laborCost)
      + Number(snapshot.deliveryCost)
      + Number(snapshot.platformCost)
      + Number(snapshot.attributedLossCost) === 0,
  );
  addCheck(
    "zero_cost_snapshot",
    "COST",
    "成本快照金额",
    zeroSnapshots.slice(0, take).map((snapshot) => issueZeroCostSnapshot(
      snapshot.order.id,
      snapshot.order.number,
      Number(snapshot.revenue),
    )),
  );

  const summary = summarizeDataQualityIssues(issues, checks);
  return {
    summary,
    issues: sortDataQualityIssues(issues),
    checks,
    truncated,
    generatedAt: now,
  };
}
