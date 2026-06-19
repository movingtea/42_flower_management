import type { Prisma } from "@/generated/prisma/client";
import {
  CustomerSource,
  GiftOccasionType,
  OrderStatus,
  RecipientRelationType,
  ReminderStatus,
  ReminderType,
} from "@/generated/prisma/enums";
import {
  addAppCalendarDays,
  coerceDate,
  formatDateInAppTimezoneIso,
  formatDateTimeInAppTimezone,
  getAppDateRangeUtc,
  getAppDayRangeUtc,
  getTodayAppDateString,
  parseAppDateString,
} from "@/lib/datetime";
import { prisma } from "@/lib/prisma";
import { withTenant } from "@/lib/tenant/tenant-write-context";
import {
  buildCustomerDisplayName,
  buildReminderContent,
  buildReminderDate,
  calculateCustomerStats,
  getDueDateMonthDay,
  mapOccasionTypeToReminderType,
  maskPhone,
  normalizeName,
  normalizePhone,
  shouldCreateReminder,
} from "@/services/crm-pure";

type Tx = Prisma.TransactionClient;

export type CrmBuyerInfo = {
  name?: string | null;
  phone?: string | null;
};

export type CrmRecipientInfo = {
  name?: string | null;
  phone?: string | null;
  address?: string | null;
  relationType?: RecipientRelationType | null;
  relationLabel?: string | null;
  preferredColors?: string | null;
  dislikedFlowers?: string | null;
  preferenceNote?: string | null;
  saveRecipient?: boolean;
};

export type CrmGiftOccasionInput = {
  occasionType?: GiftOccasionType | null;
  occasionLabel?: string | null;
  importantDate?: Date | string | null;
  giftPurpose?: string | null;
  cardMessage?: string | null;
  note?: string | null;
};

export type CrmReminderOptions = {
  enabled?: boolean;
  daysBefore?: number;
};

export type SyncCrmFromOrderInput = {
  orderId: string;
  miniProgramUserId: string;
  wechatOpenid?: string | null;
  wechatUnionid?: string | null;
  wechatNickname?: string | null;
  buyerInfo?: CrmBuyerInfo;
  recipientInfo?: CrmRecipientInfo;
  giftOccasion?: CrmGiftOccasionInput;
  reminderOptions?: CrmReminderOptions;
  /** 支付成功后才生成提醒 */
  createReminder?: boolean;
};

export type UpsertCustomerFromOrderInput = {
  miniProgramUserId: string;
  wechatOpenid?: string | null;
  wechatUnionid?: string | null;
  wechatNickname?: string | null;
  buyerName?: string | null;
  buyerPhone?: string | null;
  orderId: string;
  orderPaidAmount?: number;
  orderCreatedAt: Date;
  source?: CustomerSource;
};

function db(tx?: Tx) {
  return tx ?? prisma;
}

function parseRelationType(
  value: string | null | undefined
): RecipientRelationType | null {
  if (!value) return null;
  if (
    Object.values(RecipientRelationType).includes(value as RecipientRelationType)
  ) {
    return value as RecipientRelationType;
  }
  return null;
}

function parseOccasionType(
  value: string | null | undefined
): GiftOccasionType | null {
  if (!value) return null;
  if (Object.values(GiftOccasionType).includes(value as GiftOccasionType)) {
    return value as GiftOccasionType;
  }
  return null;
}

export function parseCrmPayloadFromBody(raw: Record<string, unknown>): {
  buyerInfo?: CrmBuyerInfo;
  recipientInfo?: CrmRecipientInfo;
  giftOccasion?: CrmGiftOccasionInput;
  reminderOptions?: CrmReminderOptions;
} {
  const result: {
    buyerInfo?: CrmBuyerInfo;
    recipientInfo?: CrmRecipientInfo;
    giftOccasion?: CrmGiftOccasionInput;
    reminderOptions?: CrmReminderOptions;
  } = {};

  if (raw.buyerInfo && typeof raw.buyerInfo === "object") {
    const b = raw.buyerInfo as Record<string, unknown>;
    result.buyerInfo = {
      name: typeof b.name === "string" ? b.name : undefined,
      phone: typeof b.phone === "string" ? b.phone : undefined,
    };
  }

  if (raw.recipientInfo && typeof raw.recipientInfo === "object") {
    const r = raw.recipientInfo as Record<string, unknown>;
    result.recipientInfo = {
      name: typeof r.name === "string" ? r.name : undefined,
      phone: typeof r.phone === "string" ? r.phone : undefined,
      address: typeof r.address === "string" ? r.address : undefined,
      relationType: parseRelationType(
        typeof r.relationType === "string" ? r.relationType : undefined
      ),
      relationLabel:
        typeof r.relationLabel === "string" ? r.relationLabel : undefined,
      preferredColors:
        typeof r.preferredColors === "string" ? r.preferredColors : undefined,
      dislikedFlowers:
        typeof r.dislikedFlowers === "string" ? r.dislikedFlowers : undefined,
      preferenceNote:
        typeof r.preferenceNote === "string" ? r.preferenceNote : undefined,
      saveRecipient:
        typeof r.saveRecipient === "boolean" ? r.saveRecipient : undefined,
    };
  }

  if (raw.giftOccasion && typeof raw.giftOccasion === "object") {
    const g = raw.giftOccasion as Record<string, unknown>;
    result.giftOccasion = {
      occasionType: parseOccasionType(
        typeof g.occasionType === "string" ? g.occasionType : undefined
      ),
      occasionLabel:
        typeof g.occasionLabel === "string" ? g.occasionLabel : undefined,
      importantDate:
        typeof g.importantDate === "string"
          ? g.importantDate
          : g.importantDate instanceof Date
            ? g.importantDate
            : undefined,
      giftPurpose:
        typeof g.giftPurpose === "string" ? g.giftPurpose : undefined,
      cardMessage:
        typeof g.cardMessage === "string" ? g.cardMessage : undefined,
      note: typeof g.note === "string" ? g.note : undefined,
    };
  }

  if (raw.reminderOptions && typeof raw.reminderOptions === "object") {
    const ro = raw.reminderOptions as Record<string, unknown>;
    result.reminderOptions = {
      enabled: typeof ro.enabled === "boolean" ? ro.enabled : undefined,
      daysBefore:
        typeof ro.daysBefore === "number" ? ro.daysBefore : undefined,
    };
  }

  return result;
}

export async function upsertCustomerFromMiniProgramOrder(
  input: UpsertCustomerFromOrderInput,
  tx?: Tx
) {
  const client = db(tx);
  const phone = normalizePhone(input.buyerPhone);
  const name = normalizeName(input.buyerName);
  const displayName = buildCustomerDisplayName({
    buyerName: name,
    wechatNickname: input.wechatNickname,
    phone,
  });
  const source = input.source ?? CustomerSource.MINI_PROGRAM;

  let customer = await client.customer.findFirst({
    where: { miniProgramUserId: input.miniProgramUserId },
  });

  if (!customer && input.wechatOpenid) {
    customer = await client.customer.findFirst({
      where: { wechatOpenid: input.wechatOpenid },
    });
  }

  if (!customer && phone) {
    customer = await client.customer.findFirst({
      where: {
        phone,
        OR: [
          { miniProgramUserId: null },
          { miniProgramUserId: input.miniProgramUserId },
        ],
      },
    });
  }

  if (customer) {
    customer = await client.customer.update({
      where: { id: customer.id },
      data: {
        miniProgramUserId:
          customer.miniProgramUserId ?? input.miniProgramUserId,
        name: customer.name ?? name ?? displayName,
        phone: customer.phone ?? phone,
        wechatNickname: customer.wechatNickname ?? input.wechatNickname,
        wechatOpenid: customer.wechatOpenid ?? input.wechatOpenid,
        wechatUnionid: customer.wechatUnionid ?? input.wechatUnionid,
        lastOrderAt: input.orderCreatedAt,
        firstOrderAt: customer.firstOrderAt ?? input.orderCreatedAt,
      },
    });
  } else {
    customer = await client.customer.create({
      data: withTenant({
        miniProgramUserId: input.miniProgramUserId,
        name: name ?? displayName,
        phone,
        wechatNickname: input.wechatNickname,
        wechatOpenid: input.wechatOpenid,
        wechatUnionid: input.wechatUnionid,
        source,
        firstOrderAt: input.orderCreatedAt,
        lastOrderAt: input.orderCreatedAt,
      }),
    });
  }

  return customer;
}

export async function upsertRecipientFromOrder(
  input: {
    customerId: string;
    recipientName: string;
    recipientPhone?: string | null;
    recipientAddress?: string | null;
    relationType?: RecipientRelationType | null;
    relationLabel?: string | null;
    preferredColors?: string | null;
    dislikedFlowers?: string | null;
    preferenceNote?: string | null;
    saveRecipient?: boolean;
  },
  tx?: Tx
) {
  const client = db(tx);
  const name = normalizeName(input.recipientName);
  if (!name) {
    throw new Error("收花人姓名不能为空");
  }

  const phone = normalizePhone(input.recipientPhone);
  const address = normalizeName(input.recipientAddress);

  const relations = await client.customerRecipientRelation.findMany({
    where: {
      customerId: input.customerId,
      isActive: true,
    },
    include: { recipient: true },
  });

  let matchedRelation = relations.find(
    (row) => phone && normalizePhone(row.recipient.phone) === phone
  );

  if (!matchedRelation && phone) {
    matchedRelation = relations.find(
      (row) =>
        normalizeName(row.recipient.name) === name &&
        normalizePhone(row.recipient.phone) === phone
    );
  }

  if (!matchedRelation) {
    matchedRelation = relations.find(
      (row) => normalizeName(row.recipient.name) === name
    );
  }

  if (matchedRelation) {
    const recipient = await client.recipient.update({
      where: { id: matchedRelation.recipientId },
      data: {
        phone: matchedRelation.recipient.phone ?? phone,
        address: matchedRelation.recipient.address ?? address,
        preferredColors:
          matchedRelation.recipient.preferredColors ?? input.preferredColors,
        dislikedFlowers:
          matchedRelation.recipient.dislikedFlowers ?? input.dislikedFlowers,
        preferenceNote:
          matchedRelation.recipient.preferenceNote ?? input.preferenceNote,
      },
    });

    const relation = await client.customerRecipientRelation.update({
      where: { id: matchedRelation.id },
      data: {
        relationType: matchedRelation.relationType ?? input.relationType,
        relationLabel: matchedRelation.relationLabel ?? input.relationLabel,
        lastUsedAt: new Date(),
        isActive: true,
      },
    });

    return { recipient, relation };
  }

  const recipient = await client.recipient.create({
    data: {
      name,
      phone,
      address,
      preferredColors: input.preferredColors,
      dislikedFlowers: input.dislikedFlowers,
      preferenceNote: input.preferenceNote,
    },
  });

  const relation = await client.customerRecipientRelation.create({
    data: {
      customerId: input.customerId,
      recipientId: recipient.id,
      relationType: input.relationType,
      relationLabel: input.relationLabel,
      isDefault: input.saveRecipient !== false,
      isActive: true,
      source: CustomerSource.MINI_PROGRAM,
      lastUsedAt: new Date(),
    },
  });

  return { recipient, relation };
}

export async function createGiftOccasionFromOrder(
  input: {
    customerId: string;
    recipientId?: string | null;
    relationId?: string | null;
    orderId: string;
    occasionType?: GiftOccasionType | null;
    occasionLabel?: string | null;
    importantDate?: Date | string | null;
    giftPurpose?: string | null;
    cardMessage?: string | null;
    preferenceSnapshot?: Prisma.InputJsonValue;
    note?: string | null;
  },
  tx?: Tx
) {
  const client = db(tx);
  const importantDate = coerceDate(input.importantDate);

  return client.giftOccasion.create({
    data: {
      customerId: input.customerId,
      recipientId: input.recipientId,
      relationId: input.relationId,
      orderId: input.orderId,
      occasionType: input.occasionType ?? GiftOccasionType.OTHER,
      occasionLabel: input.occasionLabel,
      importantDate,
      giftPurpose: input.giftPurpose,
      cardMessage: input.cardMessage,
      preferenceSnapshot: input.preferenceSnapshot ?? undefined,
      note: input.note,
    },
  });
}

export async function createReminderFromOccasion(
  input: {
    customerId: string;
    recipientId?: string | null;
    occasionId?: string | null;
    orderId?: string | null;
    occasionType: GiftOccasionType;
    importantDate: Date;
    reminderEnabled?: boolean;
    daysBefore?: number;
    customerName?: string | null;
    recipientName?: string | null;
    relationLabel?: string | null;
    lastProductName?: string | null;
    lastOrderAmount?: number | null;
  },
  tx?: Tx
) {
  const client = db(tx);
  const daysBefore = input.daysBefore ?? 7;

  if (
    !shouldCreateReminder({
      importantDate: input.importantDate,
      reminderEnabled: input.reminderEnabled,
      occasionType: input.occasionType,
    })
  ) {
    return null;
  }

  const reminderType = mapOccasionTypeToReminderType(input.occasionType);
  const { remindAt, dueDate } = buildReminderDate(
    input.importantDate,
    reminderType,
    daysBefore
  );

  const dueMonthDay = getDueDateMonthDay(dueDate);
  const existing = await client.customerReminder.findFirst({
    where: {
      customerId: input.customerId,
      recipientId: input.recipientId ?? undefined,
      type: reminderType,
      status: ReminderStatus.PENDING,
    },
  });

  if (existing?.dueDate) {
    const existingMonthDay = getDueDateMonthDay(existing.dueDate);
    if (existingMonthDay === dueMonthDay) {
      return existing;
    }
  }

  const { title, content } = buildReminderContent({
    customerName: input.customerName,
    recipientName: input.recipientName,
    relationLabel: input.relationLabel,
    occasionType: input.occasionType,
    daysBefore,
    lastProductName: input.lastProductName,
    lastOrderAmount: input.lastOrderAmount,
  });

  return client.customerReminder.create({
    data: {
      customerId: input.customerId,
      recipientId: input.recipientId,
      occasionId: input.occasionId,
      orderId: input.orderId,
      type: reminderType,
      status: ReminderStatus.PENDING,
      title,
      content,
      remindAt,
      dueDate,
    },
  });
}

export async function recalculateCustomerStats(customerId: string, tx?: Tx) {
  const client = db(tx);
  const orders = await client.order.findMany({
    where: { customerId },
    select: {
      status: true,
      payAmount: true,
      createdAt: true,
      paidAt: true,
      refundAmount: true,
      refundTime: true,
      cancelSource: true,
    },
  });

  const stats = calculateCustomerStats(orders);

  return client.customer.update({
    where: { id: customerId },
    data: {
      totalOrders: stats.totalOrders,
      totalSpent: stats.totalSpent,
      averageOrderValue: stats.averageOrderValue,
      firstOrderAt: stats.firstOrderAt,
      lastOrderAt: stats.lastOrderAt,
    },
  });
}

export async function syncCrmFromOrder(input: SyncCrmFromOrderInput, tx?: Tx) {
  const run = async (innerTx: Tx) => {
    const order = await innerTx.order.findUniqueOrThrow({
      where: { id: input.orderId },
      include: {
        items: {
          select: {
            snapshotProductName: true,
            snapshotSpecName: true,
          },
          take: 1,
        },
      },
    });

    const buyerName =
      normalizeName(input.buyerInfo?.name) ?? normalizeName(order.receiverName);
    const buyerPhone =
      normalizePhone(input.buyerInfo?.phone) ??
      normalizePhone(order.receiverPhone);

    const customer = await upsertCustomerFromMiniProgramOrder(
      {
        miniProgramUserId: input.miniProgramUserId,
        wechatOpenid: input.wechatOpenid,
        wechatUnionid: input.wechatUnionid,
        wechatNickname: input.wechatNickname,
        buyerName,
        buyerPhone,
        orderId: order.id,
        orderPaidAmount: order.payAmount,
        orderCreatedAt: order.createdAt,
        source: CustomerSource.MINI_PROGRAM,
      },
      innerTx
    );

    const recipientName =
      normalizeName(input.recipientInfo?.name) ??
      normalizeName(order.receiverName);
    const recipientPhone =
      normalizePhone(input.recipientInfo?.phone) ??
      normalizePhone(order.receiverPhone);
    const recipientAddress =
      normalizeName(input.recipientInfo?.address) ??
      normalizeName(order.deliveryAddress);

    let recipient = null;
    let relation = null;

    if (recipientName) {
      const upserted = await upsertRecipientFromOrder(
        {
          customerId: customer.id,
          recipientName,
          recipientPhone,
          recipientAddress,
          relationType: input.recipientInfo?.relationType,
          relationLabel: input.recipientInfo?.relationLabel,
          preferredColors: input.recipientInfo?.preferredColors,
          dislikedFlowers: input.recipientInfo?.dislikedFlowers,
          preferenceNote: input.recipientInfo?.preferenceNote,
          saveRecipient: input.recipientInfo?.saveRecipient,
        },
        innerTx
      );
      recipient = upserted.recipient;
      relation = upserted.relation;
    }

    const preferenceSnapshot = {
      preferredColors: input.recipientInfo?.preferredColors ?? null,
      dislikedFlowers: input.recipientInfo?.dislikedFlowers ?? null,
      preferenceNote: input.recipientInfo?.preferenceNote ?? null,
      reminderOptions: input.reminderOptions ?? null,
    };

    const occasion = await createGiftOccasionFromOrder(
      {
        customerId: customer.id,
        recipientId: recipient?.id,
        relationId: relation?.id,
        orderId: order.id,
        occasionType: input.giftOccasion?.occasionType,
        occasionLabel: input.giftOccasion?.occasionLabel,
        importantDate: input.giftOccasion?.importantDate,
        giftPurpose: input.giftOccasion?.giftPurpose,
        cardMessage:
          input.giftOccasion?.cardMessage ?? order.greetingCard ?? undefined,
        preferenceSnapshot,
        note: input.giftOccasion?.note,
      },
      innerTx
    );

    await innerTx.order.update({
      where: { id: order.id },
      data: {
        customerId: customer.id,
        recipientId: recipient?.id,
        giftOccasionId: occasion.id,
      },
    });

    let reminder = null;
    const importantDate = coerceDate(input.giftOccasion?.importantDate);
    if (
      input.createReminder &&
      importantDate &&
      input.reminderOptions?.enabled !== false
    ) {
      const firstItem = order.items[0];
      reminder = await createReminderFromOccasion(
        {
          customerId: customer.id,
          recipientId: recipient?.id,
          occasionId: occasion.id,
          orderId: order.id,
          occasionType: input.giftOccasion?.occasionType ?? GiftOccasionType.OTHER,
          importantDate,
          reminderEnabled: input.reminderOptions?.enabled ?? true,
          daysBefore: input.reminderOptions?.daysBefore,
          customerName: customer.name,
          recipientName: recipient?.name,
          relationLabel: relation?.relationLabel,
          lastProductName: firstItem
            ? `${firstItem.snapshotProductName}${firstItem.snapshotSpecName ? ` · ${firstItem.snapshotSpecName}` : ""}`
            : null,
          lastOrderAmount: order.payAmount,
        },
        innerTx
      );
    }

    if (
      order.status !== OrderStatus.PENDING_PAYMENT &&
      order.status !== OrderStatus.CANCELLED
    ) {
      await recalculateCustomerStats(customer.id, innerTx);
    }

    return {
      customer,
      recipient,
      relation,
      occasion,
      reminder,
    };
  };

  if (tx) {
    return run(tx);
  }

  return prisma.$transaction(run, {
    maxWait: 10000,
    timeout: 30000,
  });
}

/** 支付成功后补充 CRM：更新统计并生成提醒（失败不影响支付主链路） */
export async function completeCrmOnOrderPaid(orderId: string) {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: {
      customer: true,
      recipient: true,
      giftOccasion: true,
      items: {
        select: {
          snapshotProductName: true,
          snapshotSpecName: true,
        },
        take: 1,
      },
    },
  });

  if (!order?.customerId || !order.customer) {
    return null;
  }

  await recalculateCustomerStats(order.customerId);

  const occasion = order.giftOccasion;
  if (!occasion?.importantDate) {
    return { customer: order.customer, reminder: null };
  }

  const snapshot = occasion.preferenceSnapshot as
    | {
        reminderOptions?: CrmReminderOptions;
      }
    | null
    | undefined;

  const reminderOptions = snapshot?.reminderOptions;
  if (reminderOptions?.enabled === false) {
    return { customer: order.customer, reminder: null };
  }

  const relation = occasion.relationId
    ? await prisma.customerRecipientRelation.findUnique({
        where: { id: occasion.relationId },
      })
    : null;

  const firstItem = order.items[0];
  const reminder = await createReminderFromOccasion({
    customerId: order.customerId,
    recipientId: order.recipientId,
    occasionId: occasion.id,
    orderId: order.id,
    occasionType: occasion.occasionType,
    importantDate: occasion.importantDate,
    reminderEnabled: reminderOptions?.enabled ?? true,
    daysBefore: reminderOptions?.daysBefore,
    customerName: order.customer.name,
    recipientName: order.recipient?.name,
    relationLabel: relation?.relationLabel,
    lastProductName: firstItem
      ? `${firstItem.snapshotProductName}${firstItem.snapshotSpecName ? ` · ${firstItem.snapshotSpecName}` : ""}`
      : null,
    lastOrderAmount: order.payAmount,
  });

  return { customer: order.customer, reminder };
}

export async function getCustomerByMiniProgramUserId(userId: string) {
  return prisma.customer.findFirst({
    where: { miniProgramUserId: userId },
  });
}

export type ListCustomersParams = {
  keyword?: string;
  source?: CustomerSource;
  minOrders?: number;
  page?: number;
  pageSize?: number;
};

export async function listCustomers(params: ListCustomersParams = {}) {
  const page = Math.max(1, params.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, params.pageSize ?? 20));
  const skip = (page - 1) * pageSize;

  const where: Prisma.CustomerWhereInput = {};

  if (params.keyword?.trim()) {
    const kw = params.keyword.trim();
    where.OR = [
      { name: { contains: kw, mode: "insensitive" } },
      { phone: { contains: kw } },
      { wechatNickname: { contains: kw, mode: "insensitive" } },
    ];
  }

  if (params.source) {
    where.source = params.source;
  }

  if (params.minOrders != null && params.minOrders > 0) {
    where.totalOrders = { gte: params.minOrders };
  }

  const [total, customers] = await Promise.all([
    prisma.customer.count({ where }),
    prisma.customer.findMany({
      where,
      orderBy: { lastOrderAt: "desc" },
      skip,
      take: pageSize,
      include: {
        _count: {
          select: {
            recipientRelations: { where: { isActive: true } },
            reminders: { where: { status: ReminderStatus.PENDING } },
          },
        },
      },
    }),
  ]);

  return {
    customers: customers.map((c) => ({
      id: c.id,
      name: c.name ?? buildCustomerDisplayName(c),
      phone: maskPhone(c.phone),
      source: c.source,
      totalOrders: c.totalOrders,
      totalSpent: Number(c.totalSpent),
      averageOrderValue: Number(c.averageOrderValue),
      lastOrderAt: c.lastOrderAt,
      recipientCount: c._count.recipientRelations,
      pendingReminderCount: c._count.reminders,
      tags: c.tags,
    })),
    pagination: {
      page,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize),
    },
  };
}

export async function getCustomerDetail(id: string) {
  const customer = await prisma.customer.findUnique({
    where: { id },
    include: {
      recipientRelations: {
        where: { isActive: true },
        include: { recipient: true },
        orderBy: { lastUsedAt: "desc" },
      },
      orders: {
        orderBy: { createdAt: "desc" },
        take: 50,
        select: {
          id: true,
          orderNo: true,
          status: true,
          payAmount: true,
          receiverName: true,
          createdAt: true,
          paidAt: true,
        },
      },
      occasions: {
        orderBy: { createdAt: "desc" },
        take: 50,
      },
      reminders: {
        orderBy: { remindAt: "asc" },
        take: 50,
      },
    },
  });

  if (!customer) return null;

  return {
    customer: {
      id: customer.id,
      name: customer.name,
      phone: customer.phone,
      phoneMasked: maskPhone(customer.phone),
      wechatNickname: customer.wechatNickname,
      source: customer.source,
      note: customer.note,
      tags: customer.tags,
      totalOrders: customer.totalOrders,
      totalSpent: Number(customer.totalSpent),
      averageOrderValue: Number(customer.averageOrderValue),
      firstOrderAt: customer.firstOrderAt,
      lastOrderAt: customer.lastOrderAt,
      createdAt: customer.createdAt,
    },
    recipients: customer.recipientRelations.map((rel) => ({
      relationId: rel.id,
      recipientId: rel.recipient.id,
      name: rel.recipient.name,
      phone: rel.recipient.phone,
      phoneMasked: maskPhone(rel.recipient.phone),
      address: rel.recipient.address,
      relationType: rel.relationType,
      relationLabel: rel.relationLabel,
      isDefault: rel.isDefault,
      lastUsedAt: rel.lastUsedAt,
      preferredColors: rel.recipient.preferredColors,
      dislikedFlowers: rel.recipient.dislikedFlowers,
      preferenceNote: rel.recipient.preferenceNote,
    })),
    relations: customer.recipientRelations.map((rel) => ({
      id: rel.id,
      recipientId: rel.recipientId,
      relationType: rel.relationType,
      relationLabel: rel.relationLabel,
      isDefault: rel.isDefault,
      lastUsedAt: rel.lastUsedAt,
    })),
    orders: customer.orders.map((o) => ({
      ...o,
      createdAtLabel: formatDateTimeInAppTimezone(o.createdAt),
      paidAtLabel: o.paidAt ? formatDateTimeInAppTimezone(o.paidAt) : null,
    })),
    occasions: customer.occasions.map((o) => ({
      ...o,
      importantDateLabel: o.importantDate
        ? formatDateInAppTimezoneIso(o.importantDate)
        : null,
    })),
    reminders: customer.reminders.map((r) => ({
      ...r,
      remindAtLabel: formatDateTimeInAppTimezone(r.remindAt),
      dueDateLabel: r.dueDate
        ? formatDateInAppTimezoneIso(r.dueDate)
        : null,
    })),
    stats: {
      totalOrders: customer.totalOrders,
      totalSpent: Number(customer.totalSpent),
      averageOrderValue: Number(customer.averageOrderValue),
      firstOrderAt: customer.firstOrderAt,
      lastOrderAt: customer.lastOrderAt,
    },
  };
}

export type ListRecipientsParams = {
  customerId?: string;
  keyword?: string;
  relationType?: RecipientRelationType;
  page?: number;
  pageSize?: number;
};

export async function listRecipients(params: ListRecipientsParams = {}) {
  const page = Math.max(1, params.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, params.pageSize ?? 20));
  const skip = (page - 1) * pageSize;

  const where: Prisma.CustomerRecipientRelationWhereInput = {
    isActive: true,
  };

  if (params.customerId) {
    where.customerId = params.customerId;
  }

  if (params.relationType) {
    where.relationType = params.relationType;
  }

  if (params.keyword?.trim()) {
    const kw = params.keyword.trim();
    where.recipient = {
      OR: [
        { name: { contains: kw, mode: "insensitive" } },
        { phone: { contains: kw } },
      ],
    };
  }

  const [total, rows] = await Promise.all([
    prisma.customerRecipientRelation.count({ where }),
    prisma.customerRecipientRelation.findMany({
      where,
      include: {
        recipient: true,
        customer: { select: { id: true, name: true } },
      },
      orderBy: { lastUsedAt: "desc" },
      skip,
      take: pageSize,
    }),
  ]);

  return {
    recipients: rows.map((row) => ({
      relationId: row.id,
      customerId: row.customerId,
      customerName: row.customer.name,
      recipientId: row.recipient.id,
      name: row.recipient.name,
      phone: maskPhone(row.recipient.phone),
      address: row.recipient.address,
      relationType: row.relationType,
      relationLabel: row.relationLabel,
      isDefault: row.isDefault,
      lastUsedAt: row.lastUsedAt,
      preferredColors: row.recipient.preferredColors,
      dislikedFlowers: row.recipient.dislikedFlowers,
      preferenceNote: row.recipient.preferenceNote,
    })),
    pagination: {
      page,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize),
    },
  };
}

export type ListRemindersParams = {
  status?: ReminderStatus;
  startDate?: string;
  endDate?: string;
  customerId?: string;
  type?: ReminderType;
  page?: number;
  pageSize?: number;
};

export async function listReminders(params: ListRemindersParams = {}) {
  const page = Math.max(1, params.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, params.pageSize ?? 20));
  const skip = (page - 1) * pageSize;

  const where: Prisma.CustomerReminderWhereInput = {};

  if (params.status) {
    where.status = params.status;
  }

  if (params.customerId) {
    where.customerId = params.customerId;
  }

  if (params.type) {
    where.type = params.type;
  }

  if (params.startDate || params.endDate) {
    const { startUtc, endUtcExclusive } = getAppDateRangeUtc(
      params.startDate,
      params.endDate
    );
    where.remindAt = {};
    if (startUtc) where.remindAt.gte = startUtc;
    if (endUtcExclusive) where.remindAt.lt = endUtcExclusive;
  }

  const [total, reminders] = await Promise.all([
    prisma.customerReminder.count({ where }),
    prisma.customerReminder.findMany({
      where,
      include: {
        customer: { select: { id: true, name: true } },
        recipient: { select: { id: true, name: true } },
      },
      orderBy: { remindAt: "asc" },
      skip,
      take: pageSize,
    }),
  ]);

  return {
    reminders: reminders.map((r) => ({
      id: r.id,
      customerId: r.customerId,
      customerName: r.customer.name,
      recipientId: r.recipientId,
      recipientName: r.recipient?.name,
      type: r.type,
      status: r.status,
      title: r.title,
      content: r.content,
      remindAt: r.remindAt,
      remindAtLabel: formatDateTimeInAppTimezone(r.remindAt),
      dueDate: r.dueDate,
      dueDateLabel: r.dueDate
        ? formatDateInAppTimezoneIso(r.dueDate)
        : null,
      completedAt: r.completedAt,
      snoozedUntil: r.snoozedUntil,
      note: r.note,
    })),
    pagination: {
      page,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize),
    },
  };
}

export async function updateReminderStatus(
  id: string,
  status: ReminderStatus,
  options?: { note?: string; snoozedUntil?: Date | string | null }
) {
  const data: Prisma.CustomerReminderUpdateInput = {
    status,
    note: options?.note,
  };

  if (status === ReminderStatus.DONE) {
    data.completedAt = new Date();
    data.snoozedUntil = null;
  } else if (status === ReminderStatus.SNOOZED) {
    const snoozedUntil =
      coerceDate(options?.snoozedUntil) ??
      new Date(Date.now() + 24 * 60 * 60 * 1000);
    data.snoozedUntil = snoozedUntil;
  } else if (status === ReminderStatus.PENDING) {
    data.completedAt = null;
    data.snoozedUntil = null;
  } else if (status === ReminderStatus.CANCELLED) {
    data.completedAt = null;
  }

  return prisma.customerReminder.update({
    where: { id },
    data,
  });
}

export async function listMiniProgramRecipients(userId: string) {
  const customer = await getCustomerByMiniProgramUserId(userId);
  if (!customer) {
    return { recipients: [] };
  }

  const rows = await prisma.customerRecipientRelation.findMany({
    where: {
      customerId: customer.id,
      isActive: true,
    },
    include: { recipient: true },
    orderBy: [{ isDefault: "desc" }, { lastUsedAt: "desc" }],
  });

  return {
    recipients: rows.map((row) => ({
      relationId: row.id,
      recipientId: row.recipient.id,
      name: row.recipient.name,
      phone: row.recipient.phone,
      address: row.recipient.address,
      relationType: row.relationType,
      relationLabel: row.relationLabel,
      isDefault: row.isDefault,
      preferredColors: row.recipient.preferredColors,
      dislikedFlowers: row.recipient.dislikedFlowers,
      preferenceNote: row.recipient.preferenceNote,
      birthday: row.recipient.birthday
        ? formatDateInAppTimezoneIso(row.recipient.birthday).slice(0, 10)
        : null,
      anniversary: row.recipient.note?.trim() || null,
      lastUsedAt: row.lastUsedAt,
    })),
  };
}

export async function createMiniProgramRecipient(
  userId: string,
  input: {
    name: string;
    phone?: string | null;
    address?: string | null;
    relationType?: RecipientRelationType | null;
    relationLabel?: string | null;
    preferredColors?: string | null;
    dislikedFlowers?: string | null;
    preferenceNote?: string | null;
    birthday?: string | null;
    anniversary?: string | null;
    isDefault?: boolean;
  }
) {
  let customer = await getCustomerByMiniProgramUserId(userId);
  if (!customer) {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    customer = await prisma.customer.create({
      data: withTenant({
        miniProgramUserId: userId,
        wechatOpenid: user.openId,
        wechatNickname: user.nickName,
        name: buildCustomerDisplayName({
          wechatNickname: user.nickName,
          phone: user.defaultReceiverPhone,
        }),
        phone: normalizePhone(user.defaultReceiverPhone),
        source: CustomerSource.MINI_PROGRAM,
      }),
    });
  }

  const { recipient, relation } = await upsertRecipientFromOrder({
    customerId: customer.id,
    recipientName: input.name,
    recipientPhone: input.phone,
    recipientAddress: input.address,
    relationType: input.relationType,
    relationLabel: input.relationLabel,
    preferredColors: input.preferredColors,
    dislikedFlowers: input.dislikedFlowers,
    preferenceNote: input.preferenceNote,
    saveRecipient: true,
  });

  const birthdayDate = input.birthday?.trim()
    ? getAppDayRangeUtc(input.birthday.trim()).startUtc
    : null;

  const recipientUpdates: { birthday?: Date | null; note?: string | null } = {};
  if (birthdayDate) {
    recipientUpdates.birthday = birthdayDate;
  }
  if (input.anniversary !== undefined) {
    recipientUpdates.note = input.anniversary?.trim() || null;
  }

  if (Object.keys(recipientUpdates).length > 0) {
    await prisma.recipient.update({
      where: { id: recipient.id },
      data: recipientUpdates,
    });
  }

  if (input.isDefault) {
    await prisma.customerRecipientRelation.updateMany({
      where: { customerId: customer.id, id: { not: relation.id } },
      data: { isDefault: false },
    });
    await prisma.customerRecipientRelation.update({
      where: { id: relation.id },
      data: { isDefault: true },
    });
  }

  return { recipient, relation };
}

export async function updateMiniProgramRecipient(
  userId: string,
  relationId: string,
  input: {
    name?: string;
    phone?: string | null;
    address?: string | null;
    relationType?: RecipientRelationType | null;
    relationLabel?: string | null;
    preferredColors?: string | null;
    dislikedFlowers?: string | null;
    preferenceNote?: string | null;
    birthday?: string | null;
    anniversary?: string | null;
    isDefault?: boolean;
  }
) {
  const customer = await getCustomerByMiniProgramUserId(userId);
  if (!customer) {
    throw new Error("客户不存在");
  }

  const relation = await prisma.customerRecipientRelation.findFirst({
    where: {
      id: relationId,
      customerId: customer.id,
      isActive: true,
    },
    include: { recipient: true },
  });

  if (!relation) {
    throw new Error("收花人不存在");
  }

  const name = input.name ? normalizeName(input.name) : relation.recipient.name;
  if (!name) throw new Error("收花人姓名不能为空");

  await prisma.recipient.update({
    where: { id: relation.recipientId },
    data: {
      name,
      phone:
        input.phone !== undefined
          ? normalizePhone(input.phone)
          : relation.recipient.phone,
      address:
        input.address !== undefined ? input.address : relation.recipient.address,
      preferredColors:
        input.preferredColors !== undefined
          ? input.preferredColors
          : relation.recipient.preferredColors,
      dislikedFlowers:
        input.dislikedFlowers !== undefined
          ? input.dislikedFlowers
          : relation.recipient.dislikedFlowers,
      preferenceNote:
        input.preferenceNote !== undefined
          ? input.preferenceNote
          : relation.recipient.preferenceNote,
      ...(input.birthday !== undefined
        ? {
            birthday: input.birthday?.trim()
              ? getAppDayRangeUtc(input.birthday.trim()).startUtc
              : null,
          }
        : {}),
      ...(input.anniversary !== undefined
        ? { note: input.anniversary?.trim() || null }
        : {}),
    },
  });

  await prisma.customerRecipientRelation.update({
    where: { id: relation.id },
    data: {
      relationType:
        input.relationType !== undefined
          ? input.relationType
          : relation.relationType,
      relationLabel:
        input.relationLabel !== undefined
          ? input.relationLabel
          : relation.relationLabel,
      isDefault: input.isDefault ?? relation.isDefault,
    },
  });

  if (input.isDefault) {
    await prisma.customerRecipientRelation.updateMany({
      where: { customerId: customer.id, id: { not: relation.id } },
      data: { isDefault: false },
    });
  }

  return prisma.customerRecipientRelation.findUniqueOrThrow({
    where: { id: relation.id },
    include: { recipient: true },
  });
}

export async function deleteMiniProgramRecipient(
  userId: string,
  relationId: string
) {
  const customer = await getCustomerByMiniProgramUserId(userId);
  if (!customer) {
    throw new Error("客户不存在");
  }

  const relation = await prisma.customerRecipientRelation.findFirst({
    where: {
      id: relationId,
      customerId: customer.id,
      isActive: true,
    },
  });

  if (!relation) {
    throw new Error("收花人不存在");
  }

  await prisma.customerRecipientRelation.update({
    where: { id: relation.id },
    data: { isActive: false, isDefault: false },
  });

  return { success: true };
}

const HIGH_VALUE_SPENT_THRESHOLD = 500;
const HIGH_VALUE_ORDERS_THRESHOLD = 3;

export async function getCrmSummary() {
  const todayKey = getTodayAppDateString();
  const todayParts = parseAppDateString(todayKey)!;
  const monthStartKey = `${todayParts.year}-${String(todayParts.month).padStart(2, "0")}-01`;
  const weekEndParts = addAppCalendarDays(todayParts, 7);
  const weekEndKey = `${weekEndParts.year}-${String(weekEndParts.month).padStart(2, "0")}-${String(weekEndParts.day).padStart(2, "0")}`;

  const { startUtc: todayStart, endUtcExclusive: todayEnd } =
    getAppDayRangeUtc(todayKey);
  const { startUtc: weekStart, endUtcExclusive: weekEnd } = getAppDateRangeUtc(
    todayKey,
    weekEndKey
  );
  const { startUtc: monthStart } = getAppDayRangeUtc(monthStartKey);

  const [
    customerCount,
    recipientCount,
    pendingReminderCount,
    weekPendingCount,
    todayPendingCount,
    miniProgramCount,
    monthNewCustomers,
    highValueCount,
    spentAgg,
    recentCustomers,
    todayReminders,
    weekReminders,
  ] = await Promise.all([
    prisma.customer.count(),
    prisma.recipient.count(),
    prisma.customerReminder.count({ where: { status: ReminderStatus.PENDING } }),
    prisma.customerReminder.count({
      where: {
        status: ReminderStatus.PENDING,
        remindAt: { gte: weekStart!, lt: weekEnd! },
      },
    }),
    prisma.customerReminder.count({
      where: {
        status: ReminderStatus.PENDING,
        remindAt: { gte: todayStart, lt: todayEnd },
      },
    }),
    prisma.customer.count({ where: { source: CustomerSource.MINI_PROGRAM } }),
    prisma.customer.count({ where: { createdAt: { gte: monthStart } } }),
    prisma.customer.count({
      where: {
        OR: [
          { totalSpent: { gte: HIGH_VALUE_SPENT_THRESHOLD } },
          { totalOrders: { gte: HIGH_VALUE_ORDERS_THRESHOLD } },
        ],
      },
    }),
    prisma.customer.aggregate({
      _avg: { averageOrderValue: true },
      _sum: { totalSpent: true },
    }),
    prisma.customer.findMany({
      orderBy: { createdAt: "desc" },
      take: 8,
      select: {
        id: true,
        name: true,
        phone: true,
        source: true,
        totalOrders: true,
        totalSpent: true,
        lastOrderAt: true,
      },
    }),
    prisma.customerReminder.findMany({
      where: {
        status: ReminderStatus.PENDING,
        remindAt: { gte: todayStart, lt: todayEnd },
      },
      include: {
        customer: { select: { id: true, name: true } },
        recipient: { select: { id: true, name: true } },
      },
      orderBy: { remindAt: "asc" },
      take: 20,
    }),
    prisma.customerReminder.findMany({
      where: {
        status: ReminderStatus.PENDING,
        remindAt: { gte: weekStart!, lt: weekEnd! },
      },
      include: {
        customer: { select: { id: true, name: true } },
        recipient: { select: { id: true, name: true } },
      },
      orderBy: { remindAt: "asc" },
      take: 30,
    }),
  ]);

  const topCustomers = await prisma.customer.findMany({
    orderBy: [{ totalSpent: "desc" }, { totalOrders: "desc" }],
    take: 8,
    select: {
      id: true,
      name: true,
      phone: true,
      source: true,
      totalOrders: true,
      totalSpent: true,
      lastOrderAt: true,
      tags: true,
    },
  });

  return {
    metrics: {
      customerCount,
      recipientCount,
      pendingReminderCount,
      weekPendingCount,
      todayPendingCount,
      highValueCount,
      monthNewCustomers,
      miniProgramCount,
      averageOrderValue: Number(spentAgg._avg.averageOrderValue ?? 0),
      totalSpent: Number(spentAgg._sum.totalSpent ?? 0),
    },
    recentCustomers: recentCustomers.map((c) => ({
      ...c,
      name: c.name ?? buildCustomerDisplayName(c),
      phoneMasked: maskPhone(c.phone),
      totalSpent: Number(c.totalSpent),
    })),
    topCustomers: topCustomers.map((c) => ({
      ...c,
      name: c.name ?? buildCustomerDisplayName(c),
      phoneMasked: maskPhone(c.phone),
      totalSpent: Number(c.totalSpent),
    })),
    todayReminders: todayReminders.map((r) => ({
      id: r.id,
      title: r.title,
      customerId: r.customerId,
      customerName: r.customer.name,
      recipientName: r.recipient?.name,
      type: r.type,
      remindAt: r.remindAt,
      remindAtLabel: formatDateTimeInAppTimezone(r.remindAt),
      dueDateLabel: r.dueDate
        ? formatDateInAppTimezoneIso(r.dueDate)
        : null,
    })),
    weekReminders: weekReminders.map((r) => ({
      id: r.id,
      title: r.title,
      customerId: r.customerId,
      customerName: r.customer.name,
      recipientName: r.recipient?.name,
      type: r.type,
      remindAt: r.remindAt,
      remindAtLabel: formatDateTimeInAppTimezone(r.remindAt),
      dueDateLabel: r.dueDate
        ? formatDateInAppTimezoneIso(r.dueDate)
        : null,
    })),
  };
}

export async function getOccasionProductRecommendations(
  occasionType: GiftOccasionType,
  limit = 5
) {
  const spus = await prisma.productSpu.findMany({
    where: {
      isActive: true,
      isDeleted: false,
      occasionTags: { has: occasionType },
    },
    include: {
      skus: {
        where: { stock: { gt: 0 } },
        orderBy: { sortOrder: "asc" },
        take: 3,
      },
    },
    take: 20,
  });

  if (spus.length === 0) {
    return [];
  }

  let decisionMap = new Map<
    string,
    { healthStatus: string; healthLabel: string; marginLabel: string }
  >();

  try {
    const { getProductDecisionReport } = await import(
      "@/services/product-decision"
    );
    const report = await getProductDecisionReport({
      limit: 100,
      includeInactive: false,
      includeAll: true,
    });
    for (const item of report.products) {
      if (
        item.health.status === "RECOMMENDED" ||
        item.health.status === "HEALTHY"
      ) {
        const standardMargin = item.marginEstimates.standard;
        decisionMap.set(item.productId, {
          healthStatus: item.health.status,
          healthLabel: item.health.statusLabel,
          marginLabel:
            standardMargin != null
              ? `${(standardMargin * 100).toFixed(1)}%`
              : "—",
        });
      }
    }
  } catch {
    decisionMap = new Map();
  }

  const ranked = spus
    .map((spu) => {
      const sku = spu.skus[0];
      const decision = decisionMap.get(spu.id);
      const score =
        (decision?.healthStatus === "RECOMMENDED" ? 2 : decision ? 1 : 0) +
        (sku ? 1 : 0);
      return { spu, sku, decision, score };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  return ranked.map(({ spu, sku, decision }) => ({
    productId: spu.id,
    productName: spu.name,
    skuId: sku?.id ?? null,
    skuName: sku?.specName ?? null,
    price: sku ? Number(sku.price) : null,
    healthStatus: decision?.healthStatus ?? null,
    healthLabel: decision?.healthLabel ?? null,
    marginLabel: decision?.marginLabel ?? null,
  }));
}
