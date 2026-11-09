import {
  PaymentState, Prisma, RefundState, type PrismaClient, type RefundTransaction,
} from "../../generated/prisma-v2/client";

/**
 * A completed manual refund. The refund is recorded as its own transaction; the original payment,
 * order, cost snapshot and inventory/production facts are never rewritten.
 *
 * `idempotencyKey` is globally unique in the v2 schema. Replaying the exact same request returns
 * the original refund instead of creating a second one. Reusing the key with different content is
 * rejected so a retry can never silently change the amount or payee order.
 */
export type RecordRefundInput = {
  tenantId: string;
  storeId: string;
  orderId: string;
  paymentId: string;
  amount: number | string;
  reason: string;
  idempotencyKey: string;
  externalReference?: string | null;
};

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
  if (!Number.isFinite(amount)) throw new Error("已记录的退款金额无效");
  return Math.round(amount * 100);
}

function centsToAmount(cents: number | bigint): string {
  const value = typeof cents === "bigint" ? cents : BigInt(cents);
  const zero = BigInt(0);
  const hundred = BigInt(100);
  const negative = value < zero;
  const absolute = negative ? -value : value;
  return `${negative ? "-" : ""}${absolute / hundred}.${(absolute % hundred).toString().padStart(2, "0")}`;
}

function optionalText(value: unknown, label: string): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") throw new Error(`${label}格式无效`);
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function isUniqueConstraintError(error: unknown): boolean {
  return typeof error === "object"
    && error !== null
    && "code" in error
    && (error as { code?: unknown }).code === "P2002";
}

type ExpectedRefund = {
  orderId: string;
  paymentId: string;
  amountCents: number;
  reason: string;
  externalReference: string | null;
};

type RefundDb = PrismaClient | Prisma.TransactionClient;

/**
 * Every path that can return an already committed refund must first prove that the refund's own
 * order belongs to the caller's tenant/store. Otherwise a caller who knows another tenant's order,
 * payment and idempotency key could read that refund through the replay path. Use the same
 * non-disclosing error as a normal ownership failure.
 */
async function assertExistingRefundOwnership(
  db: RefundDb,
  existing: RefundTransaction,
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

function assertIdempotentReplay(existing: RefundTransaction, expected: ExpectedRefund): void {
  if (existing.state !== RefundState.SUCCEEDED) {
    throw new Error("幂等键对应的退款尚未成功，不能重复记录");
  }
  const same = existing.orderId === expected.orderId
    && existing.paymentId === expected.paymentId
    && decimalToCents(existing.amount) === expected.amountCents
    && existing.reason === expected.reason
    && (existing.externalReference ?? null) === expected.externalReference;
  if (!same) throw new Error("幂等键已被不同的退款请求使用");
}

/**
 * Records a completed manual refund against a succeeded payment.
 *
 * The payment row is locked before the accumulated successful refunds are read, so concurrent
 * refunds on the same payment cannot both pass the cap check. Only the RefundTransaction row is
 * written; payment state, order status, inventory and production facts are untouched.
 */
export async function recordRefund(
  db: PrismaClient,
  input: RecordRefundInput,
): Promise<RefundTransaction> {
  const tenantId = requiredText(input.tenantId, "租户");
  const storeId = requiredText(input.storeId, "门店");
  const orderId = requiredText(input.orderId, "订单");
  const paymentId = requiredText(input.paymentId, "支付记录");
  const amountCents = amountToCents(input.amount, "退款金额");
  const reason = requiredText(input.reason, "退款原因");
  const idempotencyKey = requiredText(input.idempotencyKey, "幂等键");
  const externalReference = optionalText(input.externalReference, "外部退款单号");
  const expected: ExpectedRefund = {
    orderId, paymentId, amountCents, reason, externalReference,
  };

  // Fast path for an already committed replay. The in-transaction check below still protects
  // against two first attempts racing with the same key.
  const committed = await db.refundTransaction.findUnique({ where: { idempotencyKey } });
  if (committed) {
    await assertExistingRefundOwnership(db, committed, tenantId, storeId);
    assertIdempotentReplay(committed, expected);
    return committed;
  }

  try {
    return await db.$transaction(async (tx) => {
      const order = await tx.order.findUnique({
        where: { id: orderId },
        select: { id: true, tenantId: true, storeId: true },
      });
      if (!order || order.tenantId !== tenantId || order.storeId !== storeId) {
        throw new Error("订单不存在");
      }

      // Serialize all refunds for one payment. The lock is taken before reading the accumulated
      // refunds, which makes the cap check safe under concurrency.
      const lockedPayment = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM "PaymentTransaction" WHERE id = ${paymentId} FOR UPDATE
      `;
      if (lockedPayment.length !== 1) throw new Error("支付记录不存在");

      const payment = await tx.paymentTransaction.findUnique({ where: { id: paymentId } });
      if (!payment) throw new Error("支付记录不存在");
      if (payment.orderId !== orderId) throw new Error("支付记录不属于该订单");
      if (payment.state !== PaymentState.SUCCEEDED) {
        throw new Error("仅成功的支付可以退款");
      }

      // A concurrent retry with the same key may have committed while this transaction waited for
      // the payment lock.
      const existing = await tx.refundTransaction.findUnique({ where: { idempotencyKey } });
      if (existing) {
        await assertExistingRefundOwnership(tx, existing, tenantId, storeId);
        assertIdempotentReplay(existing, expected);
        return existing;
      }

      const accumulated = await tx.refundTransaction.aggregate({
        where: { paymentId, state: RefundState.SUCCEEDED },
        _sum: { amount: true },
      });
      const refundedCents = accumulated._sum.amount === null
        ? 0
        : decimalToCents(accumulated._sum.amount);
      const paymentCents = decimalToCents(payment.amount);
      if (refundedCents + amountCents > paymentCents) {
        throw new Error("累计退款金额不能超过支付金额");
      }

      return tx.refundTransaction.create({
        data: {
          orderId,
          paymentId,
          state: RefundState.SUCCEEDED,
          amount: centsToAmount(amountCents),
          reason,
          externalReference,
          idempotencyKey,
          completedAt: new Date(),
        },
      });
    }, { timeout: 30_000 });
  } catch (error) {
    // The unique index is the last line of defence for two first attempts that race on the same
    // key. Re-read after the failed transaction and replay the committed row if it is identical.
    if (!isUniqueConstraintError(error)) throw error;
    const existing = await db.refundTransaction.findUnique({ where: { idempotencyKey } });
    if (!existing) throw error;
    await assertExistingRefundOwnership(db, existing, tenantId, storeId);
    assertIdempotentReplay(existing, expected);
    return existing;
  }
}
