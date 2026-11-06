import {
  CommercialState, CostKind, CostStage, FulfillmentKind, FulfillmentState,
  LocationKind, LossReason, PrismaClient, ProductionState, ReservationState,
  TransactionKind,
} from "../../generated/prisma-v2-draft/client";
import { assertMaterialQuantity } from "../domain/stock-planning";

const EPSILON = 1e-8;

/**
 * One explicit actual-usage line. The identity is task + batch, because the same batch may
 * be reserved by several production tasks. taskId is optional for legacy single-task callers.
 */
export type ActualMaterialUsageInput = {
  taskId?: string;
  batchId: string;
  usedQty: number;
  lostQty?: number;
  returnedQty?: number;
  differenceReason?: string | null;
};

export type ActualUsageEntry = ActualMaterialUsageInput;
export type ActualUsageInput = readonly ActualMaterialUsageInput[];

type ReservationGroup = {
  taskId: string;
  batchId: string;
  materialId: string;
  quantity: number;
  entries: { id: string; quantity: number }[];
};

type SettlementRow = {
  taskId: string;
  batchId: string;
  materialId: string;
  reservationIds: string[];
  reservationQty: number;
  usedQty: number;
  lostQty: number;
  returnedQty: number;
  differenceReason: string | null;
  explicit: boolean;
};

function nonnegativeQuantity(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error(`${label}必须为非负有限数`);
  }
  return value;
}

function assertUnitQuantity(value: number, quantityScale: number, label: string): void {
  try {
    assertMaterialQuantity(value, quantityScale);
  } catch {
    throw new Error(`${label}不符合物料单位精度`);
  }
}

function normalizeReason(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") throw new Error("差异原因格式无效");
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function usagePairKey(taskId: string, batchId: string): string {
  return `${taskId}\u0000${batchId}`;
}

/**
 * Resolves explicit usage entries to task + batch pairs.
 *
 * A batch-only entry remains valid when the batch belongs to exactly one task. If several
 * tasks reserved the same batch, every entry must name its task so one task's usage can never
 * settle another task's reservations.
 */
function normalizeActualUsage(
  input: ActualUsageInput | undefined,
  groups: readonly { taskId: string; batchId: string }[],
): Map<string, ActualMaterialUsageInput> | undefined {
  if (input === undefined || input === null) return undefined;
  if (!Array.isArray(input)) throw new Error("实际用料必须为数组");

  const tasksByBatch = new Map<string, Set<string>>();
  const reservedPairs = new Set<string>();
  for (const group of groups) {
    reservedPairs.add(usagePairKey(group.taskId, group.batchId));
    const tasks = tasksByBatch.get(group.batchId) ?? new Set<string>();
    tasks.add(group.taskId);
    tasksByBatch.set(group.batchId, tasks);
  }

  const byPair = new Map<string, ActualMaterialUsageInput>();
  for (const entry of input) {
    if (!entry || typeof entry !== "object") throw new Error("实际用料条目无效");
    if (typeof entry.batchId !== "string" || entry.batchId.trim().length === 0) {
      throw new Error("实际用料缺少批次");
    }
    if (entry.taskId !== undefined && entry.taskId !== null &&
      typeof entry.taskId !== "string") {
      throw new Error("实际用料制作任务无效");
    }
    const batchId = entry.batchId.trim();
    const batchTasks = tasksByBatch.get(batchId);
    const providedTaskId = typeof entry.taskId === "string" ? entry.taskId.trim() : "";
    if (!providedTaskId && !batchTasks) {
      throw new Error("实际用料包含非本订单最新预留批次");
    }
    if (!providedTaskId && batchTasks && batchTasks.size > 1) {
      throw new Error("同一批次关联多个制作任务，需提供 taskId 拆分实际用料");
    }
    const taskId = providedTaskId || [...(batchTasks ?? [])][0];
    if (!taskId) throw new Error("实际用料包含非本订单最新预留批次");
    const key = usagePairKey(taskId, batchId);
    if (!reservedPairs.has(key)) {
      throw new Error(batchTasks
        ? "实际用料包含非本订单的制作任务或批次组合"
        : "实际用料包含非本订单最新预留批次");
    }
    if (byPair.has(key)) throw new Error("实际用料批次重复，不能重复登记同一批次");
    byPair.set(key, entry);
  }

  if (byPair.size !== reservedPairs.size) {
    throw new Error("最新预留批次必须全部登记实际用料");
  }
  return byPair;
}

/**
 * Completes a v2 production task.
 *
 * Without the fifth argument it keeps the original one-click behaviour: every latest active
 * reservation is consumed at its planned quantity.
 *
 * With explicit actual usage, every latest active reservation batch must appear exactly once.
 * The input contains used, lost and returned quantities. Returned stock is never moved out of the
 * warehouse. Consumed stock is used + lost. A deviation from the reserved plan requires a reason.
 */
export async function completeProduction(
  db: PrismaClient,
  orderId: string,
  tenantId: string,
  storeId: string,
  actualUsage?: ActualUsageInput,
) {
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Order" WHERE id = ${orderId} FOR UPDATE`;
    const order = await tx.order.findUnique({
      where: { id: orderId },
      include: {
        items: {
          include: {
            tasks: true,
            requirements: {
              include: { material: true, reservations: true },
            },
          },
        },
        fulfillment: true,
        revisions: { orderBy: { number: "desc" }, take: 1 },
      },
    });
    if (!order || order.tenantId !== tenantId || order.storeId !== storeId) throw new Error("订单不存在");
    if (order.commercialState !== CommercialState.CONFIRMED || order.supplyState !== "ON_HAND_COVERED") {
      throw new Error("订单尚未确认现货保障");
    }
    if (order.productionState === ProductionState.COMPLETED) return;
    if (order.productionState !== ProductionState.READY && order.productionState !== ProductionState.IN_PROGRESS) {
      throw new Error("订单当前不能完成制作");
    }
    const latestRevision = order.revisions[0];
    if (!latestRevision) throw new Error("订单缺少修订记录");

    const taskByOrderItem = new Map<string, (typeof order.items)[number]["tasks"][number]>();
    for (const item of order.items) {
      const task = item.tasks[0];
      if (!task) throw new Error("制作任务不存在");
      taskByOrderItem.set(item.id, task);
    }

    // Group the latest active reservations by task and batch. A task may have several
    // reservations for the same batch (for example two requirement lines); they are settled
    // together for explicit input.
    const groupByTaskBatch = new Map<string, ReservationGroup>();
    const latestReservations: { id: string; batchId: string; quantity: number }[] = [];
    for (const item of order.items) {
      const task = taskByOrderItem.get(item.id);
      if (!task) throw new Error("制作任务不存在");
      for (const requirement of item.requirements.filter((entry) => entry.revisionId === latestRevision.id)) {
        if (requirement.material.tenantId !== order.tenantId) {
          throw new Error("预留物料不属于当前租户，需人工处理");
        }
        const active = requirement.reservations.filter((entry) => entry.state === ReservationState.ACTIVE);
        const total = active.reduce((sum, entry) => sum + Number(entry.quantity), 0);
        if (Math.abs(total - Number(requirement.plannedQty)) > EPSILON) {
          throw new Error("预留数量与计划不符，需人工处理");
        }
        for (const reservation of active) {
          const quantity = Number(reservation.quantity);
          latestReservations.push({ id: reservation.id, batchId: reservation.batchId, quantity });
          const key = `${task.id}\u0000${reservation.batchId}`;
          let group = groupByTaskBatch.get(key);
          if (!group) {
            group = {
              taskId: task.id,
              batchId: reservation.batchId,
              materialId: requirement.materialId,
              quantity: 0,
              entries: [],
            };
            groupByTaskBatch.set(key, group);
          }
          if (group.materialId !== requirement.materialId) {
            throw new Error("同一批次对应多个物料，需人工处理");
          }
          group.entries.push({ id: reservation.id, quantity });
          group.quantity += quantity;
        }
      }
    }
    const groups = [...groupByTaskBatch.values()];

    const explicitByPair = normalizeActualUsage(actualUsage, groups);
    let rows: SettlementRow[];
    if (!explicitByPair) {
      rows = groups.flatMap((group) => group.entries.map((entry) => ({
        taskId: group.taskId,
        batchId: group.batchId,
        materialId: group.materialId,
        reservationIds: [entry.id],
        reservationQty: entry.quantity,
        usedQty: entry.quantity,
        lostQty: 0,
        returnedQty: 0,
        differenceReason: null,
        explicit: false,
      })));
    } else {
      rows = groups.map((group) => {
        const entry = explicitByPair.get(usagePairKey(group.taskId, group.batchId));
        if (!entry) throw new Error("最新预留批次必须全部登记实际用料");
        const usedQty = nonnegativeQuantity(entry.usedQty, "实际用量");
        const lostQty = entry.lostQty === undefined
          ? 0 : nonnegativeQuantity(entry.lostQty, "损耗数量");
        const expectedReturned = Math.max(0, group.quantity - usedQty - lostQty);
        const returnedQty = entry.returnedQty === undefined
          ? expectedReturned : nonnegativeQuantity(entry.returnedQty, "退料数量");
        if (Math.abs(returnedQty - expectedReturned) > EPSILON) {
          throw new Error("退料数量必须等于预留未消耗数量");
        }
        const differenceReason = normalizeReason(entry.differenceReason);
        const deviates = Math.abs(usedQty - group.quantity) > EPSILON
          || lostQty > EPSILON
          || returnedQty > EPSILON;
        if (deviates && !differenceReason) {
          throw new Error("实际用料与预留存在差异时必须填写差异原因");
        }
        return {
          taskId: group.taskId,
          batchId: group.batchId,
          materialId: group.materialId,
          reservationIds: group.entries.map((reservation) => reservation.id),
          reservationQty: group.quantity,
          usedQty,
          lostQty,
          returnedQty,
          differenceReason,
          explicit: true,
        };
      });
    }

    const batchIds = [...new Set(latestReservations.map((entry) => entry.batchId))].sort();
    for (const batchId of batchIds) {
      await tx.$queryRaw`SELECT id FROM "InventoryBatch" WHERE id = ${batchId} FOR UPDATE`;
    }
    const batches = await tx.inventoryBatch.findMany({
      where: { id: { in: batchIds }, storeId },
      include: { balances: { include: { location: true } }, material: true },
    });
    if (batches.length !== batchIds.length) throw new Error("预留批次不属于当前门店");
    const byBatch = new Map(batches.map((batch) => [batch.id, batch]));

    for (const row of rows) {
      const batch = byBatch.get(row.batchId);
      if (!batch) throw new Error("预留批次不属于当前门店");
      if (batch.materialId !== row.materialId) throw new Error("同一批次对应多个物料，需人工处理");
      const scale = batch.material.quantityScale;
      assertUnitQuantity(row.reservationQty, scale, "预留数量");
      assertUnitQuantity(row.usedQty, scale, "实际用量");
      assertUnitQuantity(row.lostQty, scale, "损耗数量");
      assertUnitQuantity(row.returnedQty, scale, "退料数量");
    }

    const activeOrders = await tx.inventoryReservation.groupBy({
      by: ["batchId"], where: { batchId: { in: batchIds }, state: ReservationState.ACTIVE }, _sum: { quantity: true },
    });
    const activeSamples = await tx.sampleInventoryReservation.groupBy({
      by: ["batchId"], where: { batchId: { in: batchIds }, state: ReservationState.ACTIVE }, _sum: { quantity: true },
    });
    const ownByBatch = new Map<string, number>();
    for (const reservation of latestReservations) {
      ownByBatch.set(reservation.batchId, (ownByBatch.get(reservation.batchId) ?? 0) + reservation.quantity);
    }
    const consumedByBatch = new Map<string, number>();
    for (const row of rows) {
      const quantity = row.usedQty + row.lostQty;
      consumedByBatch.set(row.batchId, (consumedByBatch.get(row.batchId) ?? 0) + quantity);
    }

    for (const batch of batches) {
      const onHand = batch.balances.reduce((sum, balance) => sum + Number(balance.onHandQty), 0);
      const frozen = batch.balances.reduce((sum, balance) => sum + Number(balance.frozenQty), 0);
      const warehouseOnHand = batch.balances
        .filter((balance) => balance.location.kind === LocationKind.WAREHOUSE)
        .reduce((sum, balance) => sum + Number(balance.onHandQty), 0);
      const reserved = Number(activeOrders.find((row) => row.batchId === batch.id)?._sum.quantity ?? 0)
        + Number(activeSamples.find((row) => row.batchId === batch.id)?._sum.quantity ?? 0);
      // Keep the original one-click guard: all active reservations must be physically backed.
      if (onHand - frozen + EPSILON < reserved) {
        throw new Error("批次实存低于有效预留，需先处理库存差异");
      }
      const own = ownByBatch.get(batch.id) ?? 0;
      const consumed = consumedByBatch.get(batch.id) ?? 0;
      const extraConsumption = consumed - own;
      const extraAvailable = onHand - frozen - reserved;
      // Higher-than-planned usage may only take stock that is not frozen or reserved by another
      // order or sample.
      if (extraConsumption > extraAvailable + EPSILON) {
        throw new Error("实际用料超出批次可用库存，需先处理库存差异");
      }
      if (warehouseOnHand + EPSILON < consumed) {
        throw new Error("仓库实存不足或批次位置不明，需人工处理");
      }
    }

    const productionLocation = await tx.inventoryLocation.findFirst({ where: { storeId, kind: LocationKind.PRODUCTION } });
    if (!productionLocation) throw new Error("缺少制作区库位");

    // Keep a transaction-local projection because several settlement rows can share a batch.
    // The database rows are locked above; this map prevents a later row from using a stale
    // balance snapshot after an earlier row debited the same location.
    const balanceOnHand = new Map<string, number>();
    for (const batch of batches) {
      for (const balance of batch.balances) balanceOnHand.set(balance.id, Number(balance.onHandQty));
    }
    const debitWarehouse = async (
      batch: (typeof batches)[number],
      quantity: number,
    ): Promise<{ locationId: string; quantity: number }[]> => {
      if (quantity <= EPSILON) return [];
      const balances = batch.balances
        .filter((balance) => balance.location.kind === LocationKind.WAREHOUSE)
        .sort((left, right) => left.locationId.localeCompare(right.locationId) || left.id.localeCompare(right.id));
      let remaining = quantity;
      const debits: { locationId: string; quantity: number }[] = [];
      for (const balance of balances) {
        if (remaining <= EPSILON) break;
        const available = balanceOnHand.get(balance.id) ?? 0;
        const take = Math.min(available, remaining);
        if (take <= EPSILON) continue;
        const updated = await tx.batchBalance.updateMany({
          where: { id: balance.id, onHandQty: { gte: take } },
          data: { onHandQty: { decrement: take } },
        });
        if (updated.count !== 1) throw new Error("仓库实存不足，需人工处理");
        balanceOnHand.set(balance.id, available - take);
        debits.push({ locationId: balance.locationId, quantity: take });
        remaining -= take;
      }
      if (remaining > EPSILON) throw new Error("仓库实存不足或批次位置不明，需人工处理");
      return debits;
    };

    const rowsByTask = new Map<string, SettlementRow[]>();
    for (const row of rows) {
      const taskRows = rowsByTask.get(row.taskId) ?? [];
      taskRows.push(row);
      rowsByTask.set(row.taskId, taskRows);
    }

    for (const item of order.items) {
      const task = taskByOrderItem.get(item.id);
      if (!task) throw new Error("制作任务不存在");
      const taskRows = rowsByTask.get(task.id) ?? [];
      let materialCost = 0;
      let materialCostEstimated = false;
      let lossCost = 0;
      let lossCostEstimated = false;

      for (const row of taskRows) {
        const batch = byBatch.get(row.batchId);
        if (!batch) throw new Error("预留批次不属于当前门店");
        const consumedQty = row.usedQty + row.lostQty;
        const debits = await debitWarehouse(batch, consumedQty);
        const transferBase = row.explicit
          ? `v2-transfer-actual-${task.id}-${row.batchId}`
          : `v2-transfer-${task.id}-${row.reservationIds[0]}`;
        for (const debit of debits) {
          const idempotencyKey = !row.explicit && debits.length === 1
            ? transferBase
            : `${transferBase}-${debit.locationId}`;
          await tx.inventoryTransaction.create({ data: {
            batchId: batch.id, kind: TransactionKind.TRANSFER, quantity: debit.quantity,
            fromLocationId: debit.locationId, toLocationId: productionLocation.id,
            referenceType: "PRODUCTION_TASK", referenceId: task.id,
            idempotencyKey,
          } });
        }
        if (consumedQty > EPSILON) {
          // Used and lost material both leave the production area. The loss detail is kept in
          // MaterialUsage and LossRecord; inventory carries the total consumed quantity once.
          await tx.inventoryTransaction.create({ data: {
            batchId: batch.id, kind: TransactionKind.CONSUME, quantity: consumedQty,
            fromLocationId: productionLocation.id,
            referenceType: "PRODUCTION_TASK", referenceId: task.id,
            idempotencyKey: row.explicit
              ? `v2-consume-actual-${task.id}-${row.batchId}`
              : `v2-consume-${task.id}-${row.reservationIds[0]}`,
          } });
        }

        const settled = await tx.inventoryReservation.updateMany({
          where: { id: { in: row.reservationIds }, state: ReservationState.ACTIVE },
          data: { state: ReservationState.CONSUMED },
        });
        if (settled.count !== row.reservationIds.length) {
          throw new Error("预留状态已变化，需重试");
        }
        await tx.materialUsage.create({ data: {
          taskId: task.id,
          batchId: batch.id,
          usedQty: row.usedQty,
          lostQty: row.lostQty,
          returnedQty: row.returnedQty,
          differenceReason: row.differenceReason,
        } });
        if (row.lostQty > EPSILON) {
          await tx.lossRecord.create({ data: {
            storeId,
            batchId: batch.id,
            orderId,
            reason: LossReason.PRODUCTION_ERROR,
            quantity: row.lostQty,
            note: row.differenceReason,
          } });
        }

        const unitCost = Number(batch.unitCost);
        materialCost += row.usedQty * unitCost;
        materialCostEstimated ||= batch.costEstimated;
        lossCost += row.lostQty * unitCost;
        lossCostEstimated ||= batch.costEstimated;
      }

      if (materialCost > 0) await tx.costEntry.create({ data: {
        orderId, kind: CostKind.MATERIAL, stage: CostStage.ACTUAL,
        amount: Math.round(materialCost * 100) / 100,
        estimated: materialCostEstimated,
        sourceType: "PRODUCTION_TASK", sourceId: task.id,
      } });
      // Loss is a separate actual cost. The material entry above only contains usedQty, so the
      // consumed loss is never counted twice.
      if (lossCost > 0) await tx.costEntry.create({ data: {
        orderId, kind: CostKind.LOSS, stage: CostStage.ACTUAL,
        amount: Math.round(lossCost * 100) / 100,
        estimated: lossCostEstimated,
        sourceType: "PRODUCTION_TASK", sourceId: task.id,
      } });
      for (const [kind, amount] of [
        [CostKind.CONSUMABLE, Number(item.estimatedConsumableCostSnapshot) * item.quantity],
        [CostKind.LABOR, Number(item.estimatedLaborCostSnapshot) * item.quantity],
      ] as const) {
        if (amount <= 0) continue;
        await tx.costEntry.create({ data: {
          orderId, kind, stage: CostStage.ACTUAL, amount: Math.round(amount * 100) / 100,
          estimated: true, sourceType: "ORDER_ITEM", sourceId: item.id,
        } });
      }
      await tx.productionTask.update({ where: { id: task.id }, data: { state: ProductionState.COMPLETED, startedAt: task.startedAt ?? new Date(), completedAt: new Date() } });
    }
    await tx.order.update({
      where: { id: orderId },
      data: {
        productionState: ProductionState.COMPLETED,
        fulfillmentState: order.fulfillment?.kind === FulfillmentKind.PICKUP
          ? FulfillmentState.WAITING_PICKUP : FulfillmentState.WAITING_DELIVERY,
      },
    });
  }, { timeout: 30_000 });
}
