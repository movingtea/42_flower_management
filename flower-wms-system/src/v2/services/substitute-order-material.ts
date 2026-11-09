import {
  CommercialState, FulfillmentState, OrderEntry, Prisma, PrismaClient,
  ProductionState, ReservationState, SupplyState,
} from "../../generated/prisma-v2/client";
import { assertMaterialQuantity } from "../domain/stock-planning";
import { getMaterialAvailableQuantities } from "./material-availability";
import { reserveOrderMaterial } from "./reserve-order-material";

export type SubstituteOrderMaterialInput = {
  tenantId: string;
  storeId: string;
  orderId: string;
  /** Latest-revision requirement whose shortage is being replaced. */
  requirementId: string;
  replacementMaterialId: string;
  replacementQty: number;
  /** Operator reason; never inferred from a suggestion. */
  reason: string;
  /** Explicit customer approval for grade/color/specification changes. */
  customerConfirmed: boolean;
  actorStaffId: string;
};

export type SubstituteOrderMaterialResult = {
  orderId: string;
  revisionId: string;
  revisionNumber: number;
  requirementId: string;
  materialId: string;
  materialCode: string;
  materialName: string;
  baseUnit: string;
  plannedQty: number;
  covered: boolean;
  totalShortage: number;
  totalReserved: number;
  customerVisibleChange: boolean;
  customerConfirmed: boolean;
  /** Availability snapshot used for the server-side stock decision. */
  replacementAvailableQty: number;
};

const EPSILON = 1e-8;

const EDITABLE_COMMERCIAL_STATES: readonly CommercialState[] = [
  CommercialState.DRAFT,
  CommercialState.PENDING_CONFIRMATION,
  CommercialState.CONFIRMED,
];

const PRE_PRODUCTION_STATES: readonly ProductionState[] = [
  ProductionState.NOT_SCHEDULED,
  ProductionState.WAITING_MATERIAL,
  ProductionState.READY,
];

/** Material identity fields customers can see. A change in any of them requires confirmation. */
const CUSTOMER_VISIBLE_FIELDS = ["grade", "color", "specification", "gradeSpecification"] as const;

type MaterialIdentity = {
  grade: string | null;
  color: string | null;
  specification: string | null;
  gradeSpecification: string | null;
};

function identitySnapshot(material: MaterialIdentity) {
  return {
    grade: material.grade,
    color: material.color,
    specification: material.specification,
    gradeSpecification: material.gradeSpecification,
  };
}

function isCustomerVisibleChange(original: MaterialIdentity, replacement: MaterialIdentity): boolean {
  return CUSTOMER_VISIBLE_FIELDS.some((field) => (original[field] ?? "") !== (replacement[field] ?? ""));
}

function normalizeReason(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error("请填写物料替换原因");
  }
  return value.trim();
}

/**
 * Explicitly replaces one latest-revision shortage material with another compatible material.
 *
 * This is a human decision: nothing is suggested, and the caller must supply the replacement and
 * a reason. Only the current revision's unmet requirement can be replaced; the old requirement
 * and its released reservations remain immutable history. If a grade/color/specification changes,
 * the caller must also assert that the customer approved it. Available stock must cover the full
 * replacement quantity; human/customer confirmation never overrides an inventory gap.
 *
 * The whole new plan lands in one transaction. The order row is always locked first, matching
 * confirmation/revision/reservation writers, then the latest requirement rows and the batches
 * touched by the new plan are locked in stable order.
 */
export async function substituteOrderMaterial(
  db: PrismaClient,
  input: SubstituteOrderMaterialInput,
): Promise<SubstituteOrderMaterialResult> {
  const reason = normalizeReason(input.reason);
  if (typeof input.actorStaffId !== "string" || input.actorStaffId.trim().length === 0) {
    throw new Error("缺少操作员工信息");
  }
  if (typeof input.customerConfirmed !== "boolean") throw new Error("顾客确认状态无效");
  if (typeof input.replacementQty !== "number" ||
    !Number.isFinite(input.replacementQty) ||
    input.replacementQty <= 0) {
    throw new Error("替换数量必须大于零");
  }

  return db.$transaction(async (tx) => {
    // Order-first lock order is shared with confirm/revise/reserve/completeProduction.
    await tx.$queryRaw`SELECT id FROM "Order" WHERE id = ${input.orderId} FOR UPDATE`;
    const order = await tx.order.findUnique({
      where: { id: input.orderId },
      include: {
        items: {
          include: {
            tasks: true,
            requirements: {
              include: {
                material: true,
                reservations: { where: { state: ReservationState.ACTIVE } },
              },
            },
          },
        },
        revisions: { orderBy: { number: "desc" }, take: 1 },
        fulfillment: true,
      },
    });
    if (!order || order.tenantId !== input.tenantId || order.storeId !== input.storeId) {
      throw new Error("订单不存在");
    }
    if (order.createdVia !== OrderEntry.STAFF_PORTAL) {
      throw new Error("仅支持后台人工订单替换物料");
    }
    if (!EDITABLE_COMMERCIAL_STATES.includes(order.commercialState)) {
      throw new Error("订单当前状态不能替换物料");
    }
    if (order.fulfillmentState === FulfillmentState.DELIVERED || order.fulfillment?.handedOverAt) {
      throw new Error("订单已交付，不能替换物料");
    }
    if (!PRE_PRODUCTION_STATES.includes(order.productionState)) {
      throw new Error("订单已开始制作，不能替换物料");
    }
    for (const item of order.items) {
      for (const task of item.tasks) {
        if (task.startedAt || task.completedAt ||
          task.state === ProductionState.IN_PROGRESS ||
          task.state === ProductionState.COMPLETED ||
          task.state === ProductionState.EXCEPTION) {
          throw new Error("订单已开始制作，不能替换物料");
        }
      }
    }

    const latestRevision = order.revisions[0];
    if (!latestRevision) throw new Error("订单缺少修订记录");
    const latestRequirements = order.items
      .flatMap((item) => item.requirements)
      .filter((requirement) => requirement.revisionId === latestRevision.id);
    if (latestRequirements.length === 0) throw new Error("订单最新版缺少物料需求");

    const target = latestRequirements.find((requirement) => requirement.id === input.requirementId);
    if (!target) throw new Error("只能替换订单最新版的物料需求");

    // Stable requirement locks, then reserveOrderMaterial locks batches per material.
    const latestRequirementIds = latestRequirements.map((requirement) => requirement.id).sort();
    for (const requirementId of latestRequirementIds) {
      await tx.$queryRaw`SELECT id FROM "OrderMaterialRequirement" WHERE id = ${requirementId} FOR UPDATE`;
    }

    const originalMaterial = target.material;
    if (originalMaterial.tenantId !== input.tenantId) {
      throw new Error("原需求物料不属于当前租户");
    }
    const plannedQty = Number(target.plannedQty);
    const reservedQty = target.reservations.reduce(
      (sum, reservation) => sum + Number(reservation.quantity),
      0,
    );
    const shortage = Math.max(0, plannedQty - reservedQty);
    if (shortage <= EPSILON) throw new Error("该物料需求已被现货覆盖，不能替换");

    const replacement = await tx.material.findUnique({
      where: { id: input.replacementMaterialId },
    });
    if (!replacement || replacement.tenantId !== input.tenantId) {
      throw new Error("替换物料不属于当前租户");
    }
    if (replacement.id === originalMaterial.id) {
      throw new Error("替换物料必须与原物料不同");
    }
    if (replacement.baseUnit !== originalMaterial.baseUnit) {
      throw new Error("替换物料必须与原物料使用相同基础单位");
    }
    try {
      assertMaterialQuantity(input.replacementQty, replacement.quantityScale);
    } catch {
      throw new Error("替换数量不符合物料计量精度");
    }

    const customerVisibleChange = isCustomerVisibleChange(originalMaterial, replacement);
    if (customerVisibleChange && input.customerConfirmed !== true) {
      throw new Error("等级、颜色或规格变化必须获得顾客确认");
    }

    // Stock sufficiency is mandatory. Human/customer confirmation covers the substitution and
    // visible identity change, never an inventory gap. The reservation pass below repeats this
    // check under batch locks, so a concurrent reservation cannot slip through a stale snapshot.
    const availability = await getMaterialAvailableQuantities(tx, {
      tenantId: input.tenantId,
      storeId: input.storeId,
      materialIds: [replacement.id],
      needBy: target.needBy,
    });
    const replacementAvailableQty = availability.get(replacement.id)?.availableQty ?? 0;
    if (replacementAvailableQty + EPSILON < input.replacementQty) {
      throw new Error(
        `替换物料可用库存不足：需要 ${input.replacementQty}${replacement.baseUnit}，` +
        `当前可用 ${replacementAvailableQty}${replacement.baseUnit}；` +
        "请补充库存或选择其他可用物料",
      );
    }

    const revisionNumber = latestRevision.number + 1;

    // Release only this order's latest active reservations. Historical reservations and every
    // other order/sample reservation remain untouched.
    await tx.inventoryReservation.updateMany({
      where: {
        requirementId: { in: latestRequirementIds },
        state: ReservationState.ACTIVE,
      },
      data: { state: ReservationState.RELEASED },
    });

    const copiedRequirements = [...latestRequirements]
      .sort((left, right) => left.id.localeCompare(right.id))
      .map((requirement) => ({
        sourceRequirementId: requirement.id,
        data: {
          orderItemId: requirement.orderItemId,
          materialId: requirement.id === target.id ? replacement.id : requirement.materialId,
          plannedQty: requirement.id === target.id ? input.replacementQty : Number(requirement.plannedQty),
          needBy: requirement.needBy,
        },
      }));

    const revision = await tx.orderRevision.create({
      data: {
        orderId: order.id,
        number: revisionNumber,
        reason: `人工替换物料 ${originalMaterial.code} → ${replacement.code}：${reason}`,
      },
    });

    const createdRequirements: {
      id: string;
      materialId: string;
      plannedQty: Prisma.Decimal;
    }[] = [];
    let newTargetRequirementId: string | null = null;
    for (const entry of copiedRequirements) {
      const stored = await tx.orderMaterialRequirement.create({
        data: { ...entry.data, revisionId: revision.id },
      });
      createdRequirements.push({
        id: stored.id,
        materialId: stored.materialId,
        plannedQty: stored.plannedQty,
      });
      if (entry.sourceRequirementId === target.id) newTargetRequirementId = stored.id;
    }
    if (!newTargetRequirementId) throw new Error("替换后的物料需求未生成");

    // Same material-order reservation sequence as reviseManualOrder, so batch locks stay stable.
    let totalShortage = 0;
    let totalReserved = 0;
    let replacementReservedQty = 0;
    let replacementShortageQty = 0;
    const reservationOrder = [...createdRequirements].sort((left, right) =>
      left.materialId.localeCompare(right.materialId) || left.id.localeCompare(right.id));
    for (const requirement of reservationOrder) {
      const allocation = await reserveOrderMaterial(tx, requirement.id);
      totalShortage += allocation.shortage;
      totalReserved += allocation.reserved;
      if (requirement.id === newTargetRequirementId) {
        replacementReservedQty = allocation.reserved;
        replacementShortageQty = allocation.shortage;
      }
    }

    // The lock-time reservation result is authoritative. If stock changed after the display
    // snapshot, fail the whole transaction; no confirmation may override an inventory gap.
    if (replacementShortageQty > EPSILON) {
      throw new Error(
        `替换物料可用库存已变化：当前实际只能覆盖 ${replacementReservedQty}${replacement.baseUnit}，` +
        `仍缺 ${replacementShortageQty}${replacement.baseUnit}；` +
        "请刷新后重试或选择其他可用物料",
      );
    }

    const covered = totalShortage <= EPSILON;
    const nextTaskState = covered ? ProductionState.READY : ProductionState.WAITING_MATERIAL;
    for (const item of order.items) {
      const task = item.tasks[0];
      if (task) {
        await tx.productionTask.update({
          where: { id: task.id },
          data: { state: nextTaskState },
        });
      } else {
        await tx.productionTask.create({
          data: { orderItemId: item.id, quantity: item.quantity, state: nextTaskState },
        });
      }
    }
    await tx.order.update({
      where: { id: order.id },
      data: {
        version: revisionNumber,
        commercialState: covered ? CommercialState.CONFIRMED : CommercialState.PENDING_CONFIRMATION,
        supplyState: covered ? SupplyState.ON_HAND_COVERED : SupplyState.PURCHASE_REQUIRED,
        productionState: nextTaskState,
      },
    });

    const summary = `人工替换 ${originalMaterial.code}(${originalMaterial.name}) ${plannedQty}${originalMaterial.baseUnit} → ` +
      `${replacement.code}(${replacement.name}) ${input.replacementQty}${replacement.baseUnit}；` +
      `原因：${reason}；顾客确认：${input.customerConfirmed ? "是" : "否"}；` +
      `覆盖：${covered ? "是" : "否"}；剩余缺口：${totalShortage}${replacement.baseUnit}`;
    await tx.auditEvent.create({
      data: {
        tenantId: order.tenantId,
        storeId: order.storeId,
        actorStaffId: input.actorStaffId,
        action: "ORDER_MATERIAL_SUBSTITUTED",
        entityType: "Order",
        entityId: order.id,
        beforeSnapshot: {
          orderId: order.id,
          revisionId: latestRevision.id,
          revisionNumber: latestRevision.number,
          requirementId: target.id,
          materialId: originalMaterial.id,
          materialCode: originalMaterial.code,
          materialName: originalMaterial.name,
          plannedQty,
          reservedQty,
          shortage,
          baseUnit: originalMaterial.baseUnit,
          identity: identitySnapshot(originalMaterial),
          orderVersion: order.version,
        },
        afterSnapshot: {
          orderId: order.id,
          revisionId: revision.id,
          revisionNumber,
          requirementId: newTargetRequirementId,
          materialId: replacement.id,
          materialCode: replacement.code,
          materialName: replacement.name,
          plannedQty: input.replacementQty,
          baseUnit: replacement.baseUnit,
          identity: identitySnapshot(replacement),
          reason,
          customerConfirmed: input.customerConfirmed,
          customerVisibleChange,
          replacementAvailableQty,
          replacementReservedQty,
          replacementShortageQty,
          covered,
          totalShortage,
          totalReserved,
          orderVersion: revisionNumber,
          summary,
        },
      },
    });

    return {
      orderId: order.id,
      revisionId: revision.id,
      revisionNumber,
      requirementId: newTargetRequirementId,
      materialId: replacement.id,
      materialCode: replacement.code,
      materialName: replacement.name,
      baseUnit: replacement.baseUnit,
      plannedQty: input.replacementQty,
      covered,
      totalShortage,
      totalReserved,
      customerVisibleChange,
      customerConfirmed: input.customerConfirmed,
      replacementAvailableQty,
    };
  }, { timeout: 30_000 });
}
