import {
  OrderEntry, PaymentKind, PaymentState, Prisma, type PaymentTransaction, type PrismaClient,
} from "../../generated/prisma-v2/client";

/**
 * A completed offline payment recorded against a v2 staff-created manual order.
 *
 * Only the PaymentTransaction row is written. Order state, inventory balances, reservations,
 * production tasks, cost entries and cost snapshots are untouched, so recording a payment can
 * never be a prerequisite for confirming an already authorised manual order.
 *
 * `idempotencyKey` is globally unique in the v2 schema. Replaying the exact same request returns
 * the original payment instead of creating a second one. Reusing the key with different content is
 * rejected, so a network retry can never silently change the amount, order or method.
 */
export type RecordManualPaymentInput = {
  tenantId: string;
  storeId: string;
  orderId: string;
  amount: number | string;
  method: PaymentKind | string;
  externalReference?: string | null;
  idempotencyKey: string;
  confirmedById?: string | null;
};

/** Payment methods that represent money already received outside the mini-program checkout. */
export const OFFLINE_PAYMENT_KINDS: readonly PaymentKind[] = [
  PaymentKind.CASH,
  PaymentKind.BANK_TRANSFER,
  PaymentKind.CARD,
  PaymentKind.WECHAT_TRANSFER,
  PaymentKind.OTHER,
];

const MAX_AMOUNT_CENTS = 99_999_999_999_999; // Decimal(14, 2)

function requiredText(value: unknown, label: string): string {
  if (typeof value !== "string") throw new Error(`${label}不能为空`);
  const trimmed = value.trim();
  if (trimmed.length === 0) throw new Error(`${label}不能为空`);
  return trimmed;
}

function finiteNumber(value: unknown, label: string): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  throw new Error(`${label}必须为有效数字`);
}

function amountToCents(value: unknown, label: string): number {
  const amount = finiteNumber(value, label);
  if (amount <= 0) throw new Error(`${label}必须为正数`);
  const scaled = amount * 100;
  const cents = Math.round(scaled);
  // 0.1 * 100 is not exactly 10 in binary floating point; allow only a negligible epsilon.
  if (Math.abs(scaled - cents) > 1e-6) throw new Error(`${label}最多保留两位小数`);
  if (cents <= 0) throw new Error(`${label}必须为正数`);
  if (cents > MAX_AMOUNT_CENTS) throw new Error(`${label}超出可记录范围`);
  return cents;
}

function decimalToCents(value: unknown): number {
  const amount = Number(value);
  if (!Number.isFinite(amount)) throw new Error("已记录的收款金额无效");
  return Math.round(amount * 100);
}

function centsToAmount(cents: number): string {
  const whole = Math.trunc(cents / 100);
  const fraction = cents % 100;
  return `${whole}.${String(fraction).padStart(2, "0")}`;
}

function optionalText(value: unknown, label: string): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") throw new Error(`${label}格式无效`);
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function offlinePaymentKind(value: unknown): PaymentKind {
  const method = typeof value === "string" ? value.trim() : "";
  if (!Object.values(PaymentKind).includes(method as PaymentKind)) {
    throw new Error("支付方式无效");
  }
  if (!OFFLINE_PAYMENT_KINDS.includes(method as PaymentKind)) {
    throw new Error("仅支持记录线下收款方式");
  }
  return method as PaymentKind;
}

function isUniqueConstraintError(error: unknown): boolean {
  return typeof error === "object"
    && error !== null
    && "code" in error
    && (error as { code?: unknown }).code === "P2002";
}

type ExpectedPayment = {
  orderId: string;
  method: PaymentKind;
  amountCents: number;
  externalReference: string | null;
  confirmedById: string | null;
};

type PaymentDb = PrismaClient | Prisma.TransactionClient;

/**
 * Every replay path must first prove that the payment's own order belongs to the caller's
 * tenant/store. Otherwise a caller who knows another tenant's order and idempotency key could read
 * that payment through the replay path. Use the same non-disclosing error as an ownership failure.
 */
async function assertExistingPaymentOwnership(
  db: PaymentDb,
  existing: PaymentTransaction,
  tenantId: string,
  storeId: string,
): Promise<void> {
  const order = await db.order.findUnique({
    where: { id: existing.orderId },
    select: { tenantId: true, storeId: true },
  });
  if (!order || order.tenantId !== tenantId || order.storeId !== storeId) {
    throw new Error("订单不存在");
  }
}

function assertIdempotentReplay(existing: PaymentTransaction, expected: ExpectedPayment): void {
  if (existing.state !== PaymentState.SUCCEEDED) {
    throw new Error("幂等键对应的收款尚未成功，不能重复记录");
  }
  const same = existing.orderId === expected.orderId
    && existing.method === expected.method
    && decimalToCents(existing.amount) === expected.amountCents
    && (existing.externalReference ?? null) === expected.externalReference
    && (existing.confirmedById ?? null) === expected.confirmedById;
  if (!same) throw new Error("幂等键已被不同的收款请求使用");
}

/**
 * Records a successful offline/manual payment. The service is intentionally bounded:
 * - the order must belong to the caller's tenant and store and be a v2 staff-created manual order;
 * - the amount must be positive, fit Decimal(14, 2) and have at most two decimal places;
 * - only non-online PaymentKind values are accepted;
 * - retries with the same idempotency key return the committed row, never a duplicate.
 */
export async function recordManualPayment(
  db: PrismaClient,
  input: RecordManualPaymentInput,
): Promise<PaymentTransaction> {
  const tenantId = requiredText(input.tenantId, "租户");
  const storeId = requiredText(input.storeId, "门店");
  const orderId = requiredText(input.orderId, "订单");
  const amountCents = amountToCents(input.amount, "收款金额");
  const method = offlinePaymentKind(input.method);
  const externalReference = optionalText(input.externalReference, "收款凭证");
  const idempotencyKey = requiredText(input.idempotencyKey, "幂等键");
  const confirmedById = optionalText(input.confirmedById, "收款人");
  const expected: ExpectedPayment = {
    orderId, method, amountCents, externalReference, confirmedById,
  };

  // Fast path for an already committed retry. The in-transaction check still protects against two
  // first attempts racing with the same key.
  const committed = await db.paymentTransaction.findUnique({ where: { idempotencyKey } });
  if (committed) {
    await assertExistingPaymentOwnership(db, committed, tenantId, storeId);
    assertIdempotentReplay(committed, expected);
    return committed;
  }

  try {
    return await db.$transaction(async (tx) => {
      const order = await tx.order.findUnique({
        where: { id: orderId },
        select: { id: true, tenantId: true, storeId: true, createdVia: true },
      });
      if (!order || order.tenantId !== tenantId || order.storeId !== storeId) {
        throw new Error("订单不存在");
      }
      if (order.createdVia !== OrderEntry.STAFF_PORTAL) {
        throw new Error("仅 v2 后台人工订单可记录线下收款");
      }

      // A concurrent retry with the same key may have committed while this transaction waited.
      const existing = await tx.paymentTransaction.findUnique({ where: { idempotencyKey } });
      if (existing) {
        await assertExistingPaymentOwnership(tx, existing, tenantId, storeId);
        assertIdempotentReplay(existing, expected);
        return existing;
      }

      const payment = await tx.paymentTransaction.create({
        data: {
          orderId,
          method,
          state: PaymentState.SUCCEEDED,
          amount: centsToAmount(amountCents),
          externalReference,
          idempotencyKey,
          confirmedById,
          confirmedAt: new Date(),
        },
      });
      // Only a newly committed payment is audited; both replay paths above return the
      // existing row without writing another event.
      await tx.auditEvent.create({
        data: {
          tenantId,
          storeId,
          actorStaffId: confirmedById,
          action: "PAYMENT_RECORDED",
          entityType: "PaymentTransaction",
          entityId: payment.id,
          afterSnapshot: {
            paymentId: payment.id,
            orderId,
            method: payment.method,
            amount: payment.amount.toString(),
          },
        },
      });
      return payment;
    }, { timeout: 30_000 });
  } catch (error) {
    // The unique index is the last line of defence for two first attempts that race on the same
    // key. Re-read after the failed transaction and replay the committed row if it is identical.
    if (!isUniqueConstraintError(error)) throw error;
    const existing = await db.paymentTransaction.findUnique({ where: { idempotencyKey } });
    if (!existing) throw error;
    await assertExistingPaymentOwnership(db, existing, tenantId, storeId);
    assertIdempotentReplay(existing, expected);
    return existing;
  }
}
