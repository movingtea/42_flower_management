import type { Prisma } from "@/generated/prisma-v2-draft/client";

/** Compact list projection for the board: no Decimal or nested production payload. */
export const orderBoardInclude = {
  items: {
    select: {
      id: true,
      nameSnapshot: true,
      quantity: true,
      unitPrice: true,
    },
  },
  revisions: {
    select: { number: true },
    orderBy: { number: "desc" },
    take: 1,
  },
  fulfillment: {
    select: {
      kind: true,
      scheduledAt: true,
      deliveryFeeCharged: true,
      attempts: { select: { state: true } },
    },
  },
} satisfies Prisma.OrderInclude;

export type OrderBoardOrder = Prisma.OrderGetPayload<{ include: typeof orderBoardInclude }>;

/**
 * Full detail for exactly one selected order. The page always queries this with
 * `{ id, tenantId, storeId }`, so a foreign orderId behaves like a missing order.
 */
export const orderDetailInclude = {
  items: {
    include: {
      sku: { include: { product: true } },
      recipeVersion: true,
      tasks: {
        include: {
          usages: {
            include: {
              batch: { include: { material: true } },
            },
          },
        },
      },
      requirements: {
        include: {
          material: true,
          reservations: {
            include: {
              batch: { select: { batchNo: true, materialId: true } },
            },
          },
          purchaseAllocations: {
            include: {
              purchaseLine: {
                include: {
                  material: true,
                  purchaseOrder: true,
                  receiptLines: {
                    select: {
                      id: true,
                      disposition: true,
                      quantity: true,
                      rejectionReason: true,
                      receipt: { select: { receivedAt: true } },
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
  revisions: { orderBy: { number: "desc" } },
  fulfillment: {
    include: {
      attempts: { orderBy: { attemptNo: "asc" } },
    },
  },
  payments: {
    include: { refunds: { orderBy: { createdAt: "desc" } } },
    orderBy: { createdAt: "desc" },
  },
  costEntries: { orderBy: { calculatedAt: "desc" } },
  costSnapshots: { orderBy: { revisionNo: "desc" } },
  costAdjustments: { orderBy: { createdAt: "desc" } },
} satisfies Prisma.OrderInclude;

export type OrderDetailData = Prisma.OrderGetPayload<{ include: typeof orderDetailInclude }>;

export type OrderAuditEvent = {
  id: string;
  action: string;
  afterSnapshot: unknown;
  occurredAt: Date;
};
