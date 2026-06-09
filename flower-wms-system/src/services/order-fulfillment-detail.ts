import { StockLogType } from "@/generated/prisma/enums";
import type { FloralRole } from "@/generated/prisma/enums";
import { prisma } from "@/lib/prisma";
import { FLORAL_ROLE_LABEL } from "@/lib/wiki-constants";
import { ORDER_STATUS_LABEL } from "@/services/order-lifecycle";
import { expandAndAggregateWikiDemands } from "@/services/order-fifo-pure";
import type { OrderStatus } from "@/generated/prisma/client";

export type OrderPhysicalConsumptionRow = {
  id: string;
  wikiName: string;
  floralRoleLabel: string;
  batchNo: string | null;
  quantity: number;
  /** locked = 支付后 FIFO 实扣；projected = 配方预估（待支付） */
  source: "locked" | "projected";
};

export type OrderFulfillmentDetail = {
  id: string;
  orderNo: string;
  status: string;
  statusLabel: string;
  payAmount: string;
  receiverName: string;
  receiverPhone: string;
  deliveryAddress: string;
  deliveryDate: string;
  greetingCard: string | null;
  deliveryInfo: string | null;
  deliveryCostActual: string;
  deliveryCostNote: string | null;
  createdAt: string;
  items: { label: string; quantity: number }[];
  physicalConsumption: OrderPhysicalConsumptionRow[];
  consumptionMode: "locked" | "projected" | "empty";
};

function wikiDisplayName(
  chineseName: string | null | undefined,
  fallback?: string
) {
  return chineseName?.trim() || fallback || "未知花材";
}

function roleLabel(role: FloralRole | null | undefined) {
  return role ? FLORAL_ROLE_LABEL[role] : "—";
}

function buildProjectedConsumption(
  orderItems: NonNullable<
    Awaited<ReturnType<typeof fetchOrderWithRelations>>
  >["items"]
): OrderPhysicalConsumptionRow[] {
  const itemLikes = orderItems.map((item) => ({
    id: item.id,
    quantity: item.quantity,
    snapshotProductName: `${item.snapshotProductName}（${item.snapshotSpecName}）`,
    recipeId: item.sku.recipeId,
    recipeLines:
      item.sku.recipe?.lines.map((line) => ({
        flowerWikiId: line.flowerWikiId,
        quantityNeeded: line.quantityNeeded,
        wiki: line.wiki,
      })) ?? [],
  }));

  let aggregated;
  try {
    aggregated = expandAndAggregateWikiDemands(itemLikes);
  } catch {
    return [];
  }

  const wikiMeta = new Map<
    string,
    { chineseName: string; floralRole: FloralRole }
  >();
  for (const item of orderItems) {
    for (const line of item.sku.recipe?.lines ?? []) {
      wikiMeta.set(line.flowerWikiId, {
        chineseName: line.wiki.chineseName,
        floralRole: line.wiki.floralRole,
      });
    }
  }

  return aggregated.map((demand) => {
    const meta = wikiMeta.get(demand.flowerWikiId);
    return {
      id: `projected-${demand.flowerWikiId}`,
      wikiName: wikiDisplayName(meta?.chineseName, demand.chineseName),
      floralRoleLabel: roleLabel(meta?.floralRole),
      batchNo: null,
      quantity: demand.quantity,
      source: "projected" as const,
    };
  });
}

async function fetchOrderWithRelations(orderId: string) {
  return prisma.order.findUnique({
    where: { id: orderId },
    include: {
      items: {
        include: {
          sku: {
            include: {
              recipe: {
                include: {
                  lines: {
                    include: {
                      wiki: {
                        select: {
                          chineseName: true,
                          floralRole: true,
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
      stockLogs: {
        where: { type: StockLogType.SALE_OUT },
        include: {
          batch: { select: { batchNo: true } },
          material: {
            include: {
              wiki: {
                select: { chineseName: true, floralRole: true },
              },
            },
          },
        },
        orderBy: { createdAt: "asc" },
      },
    },
  });
}

export async function getOrderFulfillmentDetail(
  orderId: string
): Promise<OrderFulfillmentDetail> {
  const order = await fetchOrderWithRelations(orderId);
  if (!order) {
    throw new Error("订单不存在");
  }

  let physicalConsumption: OrderPhysicalConsumptionRow[];
  let consumptionMode: OrderFulfillmentDetail["consumptionMode"];

  if (order.stockLogs.length > 0) {
    physicalConsumption = order.stockLogs.map((log) => ({
      id: log.id,
      wikiName: wikiDisplayName(
        log.material.wiki?.chineseName,
        log.material.name
      ),
      floralRoleLabel: roleLabel(log.material.wiki?.floralRole),
      batchNo: log.batch.batchNo,
      quantity: log.quantity,
      source: "locked",
    }));
    consumptionMode = "locked";
  } else if (order.status === "PENDING_PAYMENT") {
    physicalConsumption = buildProjectedConsumption(order.items);
    consumptionMode = physicalConsumption.length ? "projected" : "empty";
  } else {
    physicalConsumption = [];
    consumptionMode = "empty";
  }

  return {
    id: order.id,
    orderNo: order.orderNo,
    status: order.status,
    statusLabel:
      ORDER_STATUS_LABEL[order.status as OrderStatus] ?? order.status,
    payAmount: order.payAmount.toFixed(2),
    receiverName: order.receiverName,
    receiverPhone: order.receiverPhone,
    deliveryAddress: order.deliveryAddress,
    deliveryDate: order.deliveryDate,
    greetingCard: order.greetingCard,
    deliveryInfo: order.deliveryInfo,
    deliveryCostActual: Number(order.deliveryCostActual ?? 0).toFixed(2),
    deliveryCostNote: order.deliveryCostNote,
    createdAt: order.createdAt.toISOString(),
    items: order.items.map((line) => ({
      label: `${line.snapshotProductName}（${line.snapshotSpecName}）`,
      quantity: line.quantity,
    })),
    physicalConsumption,
    consumptionMode,
  };
}
