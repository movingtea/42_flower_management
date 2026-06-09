import { Prisma } from "@/generated/prisma/client";
import { OrderStatus, StockLogType } from "@/generated/prisma/enums";
import { prisma } from "@/lib/prisma";
import {
  calculateFlowerMaterialCostFromInputs,
  calculateGrossValues,
  calculatePackagingCostFromInputs,
  decimalToString,
  money,
  type FlowerMaterialCostLine,
  type FlowerMaterialCostResult,
  type PackagingCostLine,
} from "@/services/order-cost-pure";

type Tx = Prisma.TransactionClient;

export type OrderCostSnapshotDto = {
  id: string | null;
  orderId: string;
  paidAmount: string;
  flowerMaterialCost: string;
  packagingCost: string;
  deliveryCostActual: string;
  platformFee: string;
  floristLaborCost: string;
  otherCost: string;
  totalCost: string;
  grossProfit: string;
  grossMargin: string;
  costCalculatedAt: string;
  costVersion: string;
  isPreview?: boolean;
};

export type LossAdjustedCostPreview = {
  flowerMaterialCostRaw: string;
  flowerMaterialCostLossAdjusted: string;
  lossModelExtraCost: string;
  totalCostLossAdjusted: string;
  grossProfitLossAdjusted: string;
  grossMarginLossAdjusted: string;
};

export type CalculatedOrderCost = {
  snapshot: Omit<OrderCostSnapshotDto, "id" | "isPreview">;
  lossAdjustedPreview: LossAdjustedCostPreview;
  data: {
    orderId: string;
    paidAmount: Prisma.Decimal;
    flowerMaterialCost: Prisma.Decimal;
    packagingCost: Prisma.Decimal;
    deliveryCostActual: Prisma.Decimal;
    platformFee: Prisma.Decimal;
    floristLaborCost: Prisma.Decimal;
    otherCost: Prisma.Decimal;
    totalCost: Prisma.Decimal;
    grossProfit: Prisma.Decimal;
    grossMargin: Prisma.Decimal;
    costCalculatedAt: Date;
    costVersion: string;
  };
  flowerMaterialCostLines: FlowerMaterialCostLine[];
  packagingCostLines: PackagingCostLine[];
  warnings: string[];
};

function mapSnapshot(snapshot: {
  id: string;
  orderId: string;
  paidAmount: Prisma.Decimal;
  flowerMaterialCost: Prisma.Decimal;
  packagingCost: Prisma.Decimal;
  deliveryCostActual: Prisma.Decimal;
  platformFee: Prisma.Decimal;
  floristLaborCost: Prisma.Decimal;
  otherCost: Prisma.Decimal;
  totalCost: Prisma.Decimal;
  grossProfit: Prisma.Decimal;
  grossMargin: Prisma.Decimal;
  costCalculatedAt: Date;
  costVersion: string;
}): OrderCostSnapshotDto {
  return {
    id: snapshot.id,
    orderId: snapshot.orderId,
    paidAmount: decimalToString(snapshot.paidAmount),
    flowerMaterialCost: decimalToString(snapshot.flowerMaterialCost),
    packagingCost: decimalToString(snapshot.packagingCost),
    deliveryCostActual: decimalToString(snapshot.deliveryCostActual),
    platformFee: decimalToString(snapshot.platformFee),
    floristLaborCost: decimalToString(snapshot.floristLaborCost),
    otherCost: decimalToString(snapshot.otherCost),
    totalCost: decimalToString(snapshot.totalCost),
    grossProfit: decimalToString(snapshot.grossProfit),
    grossMargin: decimalToString(snapshot.grossMargin, 4),
    costCalculatedAt: snapshot.costCalculatedAt.toISOString(),
    costVersion: snapshot.costVersion,
  };
}

export async function calculateFlowerMaterialCostFromSaleOut(
  orderId: string,
  tx: Tx = prisma
): Promise<FlowerMaterialCostResult> {
  const logs = await tx.stockLog.findMany({
    where: { orderId, type: StockLogType.SALE_OUT },
    include: {
      batch: {
        select: {
          id: true,
          batchNo: true,
          unitCost: true,
          lossAdjustedUnitCost: true,
          usableRate: true,
          lossRate: true,
        },
      },
      material: {
        select: {
          name: true,
          wiki: { select: { chineseName: true } },
        },
      },
    },
    orderBy: { createdAt: "asc" },
  });

  const result = calculateFlowerMaterialCostFromInputs(
    logs.map((log) => ({
      stockLogId: log.id,
      batchId: log.batchId,
      batchNo: log.batch.batchNo,
      quantity: log.quantity,
      unitCost: log.batch.unitCost,
      lossAdjustedUnitCost: log.batch.lossAdjustedUnitCost,
      usableRate: log.batch.usableRate,
      lossRate: log.batch.lossRate,
      materialName: log.material.name,
      wikiName: log.material.wiki?.chineseName ?? null,
    }))
  );

  if (logs.length === 0) {
    result.warnings.push("订单暂无 SALE_OUT 库存流水，花材实际成本按 0 计算");
  }

  return result;
}

export async function getPackagingCostForOrder(
  orderId: string,
  tx: Tx = prisma
): Promise<{
  totalCost: Prisma.Decimal;
  lines: PackagingCostLine[];
  warnings: string[];
}> {
  const order = await tx.order.findUnique({
    where: { id: orderId },
    select: {
      items: {
        select: {
          id: true,
          skuId: true,
          quantity: true,
          snapshotProductName: true,
          snapshotSpecName: true,
          sku: {
            select: {
              recipeId: true,
              recipe: {
                select: {
                  id: true,
                  name: true,
                  packagingKitId: true,
                  packagingKit: {
                    select: {
                      id: true,
                      name: true,
                      standardCost: true,
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  });

  if (!order) throw new Error("订单不存在");

  return calculatePackagingCostFromInputs(
    order.items.map((item) => ({
      orderItemId: item.id,
      skuId: item.skuId,
      productName: item.snapshotProductName,
      specName: item.snapshotSpecName,
      quantity: item.quantity,
      recipeId: item.sku.recipeId,
      recipeName: item.sku.recipe?.name ?? null,
      packagingKitId: item.sku.recipe?.packagingKitId ?? null,
      packagingKitName: item.sku.recipe?.packagingKit?.name ?? null,
      standardCost: item.sku.recipe?.packagingKit?.standardCost ?? null,
    }))
  );
}

export async function calculateOrderCostSnapshot(
  orderId: string,
  tx: Tx = prisma
): Promise<CalculatedOrderCost> {
  const order = await tx.order.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      status: true,
      payAmount: true,
      totalAmount: true,
      deliveryCostActual: true,
    },
  });
  if (!order) throw new Error("订单不存在");

  const paidAmount = money(
    Number.isFinite(order.payAmount) ? order.payAmount : order.totalAmount
  );
  const deliveryCostActual = money(order.deliveryCostActual);
  const platformFee = money(0);
  const floristLaborCost = money(0);
  const otherCost = money(0);

  const [flowerResult, packagingResult] = await Promise.all([
    calculateFlowerMaterialCostFromSaleOut(orderId, tx),
    getPackagingCostForOrder(orderId, tx),
  ]);

  const { totalCost, grossProfit, grossMargin } = calculateGrossValues({
    paidAmount,
    flowerMaterialCost: flowerResult.rawTotalCost,
    packagingCost: packagingResult.totalCost,
    deliveryCostActual,
    platformFee,
    floristLaborCost,
    otherCost,
  });
  const lossAdjustedGross = calculateGrossValues({
    paidAmount,
    flowerMaterialCost: flowerResult.lossAdjustedTotalCost,
    packagingCost: packagingResult.totalCost,
    deliveryCostActual,
    platformFee,
    floristLaborCost,
    otherCost,
  });
  const lossAdjustedPreview: LossAdjustedCostPreview = {
    flowerMaterialCostRaw: decimalToString(flowerResult.rawTotalCost),
    flowerMaterialCostLossAdjusted: decimalToString(
      flowerResult.lossAdjustedTotalCost
    ),
    lossModelExtraCost: decimalToString(flowerResult.lossModelExtraCost),
    totalCostLossAdjusted: decimalToString(lossAdjustedGross.totalCost),
    grossProfitLossAdjusted: decimalToString(lossAdjustedGross.grossProfit),
    grossMarginLossAdjusted: decimalToString(
      lossAdjustedGross.grossMargin,
      4
    ),
  };
  const costCalculatedAt = new Date();
  const costVersion = "v1";
  const warnings = [...flowerResult.warnings, ...packagingResult.warnings];

  if (order.status === OrderStatus.PENDING_PAYMENT) {
    warnings.push("订单未支付，成本仅为预览；支付后会基于实际 SALE_OUT 重新生成快照");
  }

  const data = {
    orderId,
    paidAmount,
    flowerMaterialCost: flowerResult.rawTotalCost,
    packagingCost: packagingResult.totalCost,
    deliveryCostActual,
    platformFee,
    floristLaborCost,
    otherCost,
    totalCost,
    grossProfit,
    grossMargin,
    costCalculatedAt,
    costVersion,
  };

  return {
    lossAdjustedPreview,
    snapshot: {
      orderId,
      paidAmount: decimalToString(paidAmount),
      flowerMaterialCost: decimalToString(flowerResult.rawTotalCost),
      packagingCost: decimalToString(packagingResult.totalCost),
      deliveryCostActual: decimalToString(deliveryCostActual),
      platformFee: decimalToString(platformFee),
      floristLaborCost: decimalToString(floristLaborCost),
      otherCost: decimalToString(otherCost),
      totalCost: decimalToString(totalCost),
      grossProfit: decimalToString(grossProfit),
      grossMargin: decimalToString(grossMargin, 4),
      costCalculatedAt: costCalculatedAt.toISOString(),
      costVersion,
    },
    data,
    flowerMaterialCostLines: flowerResult.lines,
    packagingCostLines: packagingResult.lines,
    warnings,
  };
}

export async function upsertOrderCostSnapshot(
  orderId: string,
  tx: Tx = prisma
): Promise<OrderCostSnapshotDto> {
  const calculated = await calculateOrderCostSnapshot(orderId, tx);
  const snapshot = await tx.orderCostSnapshot.upsert({
    where: { orderId },
    create: calculated.data,
    update: {
      paidAmount: calculated.data.paidAmount,
      flowerMaterialCost: calculated.data.flowerMaterialCost,
      packagingCost: calculated.data.packagingCost,
      deliveryCostActual: calculated.data.deliveryCostActual,
      platformFee: calculated.data.platformFee,
      floristLaborCost: calculated.data.floristLaborCost,
      otherCost: calculated.data.otherCost,
      totalCost: calculated.data.totalCost,
      grossProfit: calculated.data.grossProfit,
      grossMargin: calculated.data.grossMargin,
      costCalculatedAt: calculated.data.costCalculatedAt,
      costVersion: calculated.data.costVersion,
    },
  });
  return mapSnapshot(snapshot);
}

export async function getOrderCostSnapshotDetail(orderId: string): Promise<{
  snapshot: OrderCostSnapshotDto;
  lossAdjustedPreview: LossAdjustedCostPreview;
  flowerMaterialCostLines: FlowerMaterialCostLine[];
  packagingCostLines: PackagingCostLine[];
  warnings: string[];
}> {
  const [existing, calculated] = await Promise.all([
    prisma.orderCostSnapshot.findUnique({ where: { orderId } }),
    calculateOrderCostSnapshot(orderId),
  ]);

  if (existing) {
    return {
      snapshot: mapSnapshot(existing),
      lossAdjustedPreview: calculated.lossAdjustedPreview,
      flowerMaterialCostLines: calculated.flowerMaterialCostLines,
      packagingCostLines: calculated.packagingCostLines,
      warnings: calculated.warnings,
    };
  }

  return {
    snapshot: { id: null, ...calculated.snapshot, isPreview: true },
    lossAdjustedPreview: calculated.lossAdjustedPreview,
    flowerMaterialCostLines: calculated.flowerMaterialCostLines,
    packagingCostLines: calculated.packagingCostLines,
    warnings: calculated.warnings,
  };
}
