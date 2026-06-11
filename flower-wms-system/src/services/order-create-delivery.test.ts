/**
 * Run: npm run test:order-create-delivery
 */
import assert from "node:assert/strict";
import {
  isMiniprogramBusinessError,
  MINIPROGRAM_ERROR_CODES,
} from "@/lib/miniprogram-business-error";
import { evaluateDeliveryAvailability } from "./delivery-settings-pure";

const SETTINGS = {
  sameDayCutoffTime: "17:00",
  deliveryTimeRange: { start: "10:00", end: "20:00" },
  sameDayEnabled: true,
  preorderEnabled: true,
  disabledDates: ["2026-06-20"],
};

const AFTER_CUTOFF = new Date("2026-06-10T10:00:00.000Z"); // 18:00 Shanghai
const BEFORE_CUTOFF = new Date("2026-06-10T08:00:00.000Z"); // 16:00 Shanghai

function testAfterCutoffSameDayRejected() {
  const result = evaluateDeliveryAvailability({
    deliveryDate: "2026-06-10 上午",
    now: AFTER_CUTOFF,
    settings: SETTINGS,
  });
  assert.equal(result.allowed, false);
  assert.equal(result.code, MINIPROGRAM_ERROR_CODES.INVALID_DELIVERY_DATE);
}

function testTimeBeforeRangeRejected() {
  const result = evaluateDeliveryAvailability({
    deliveryDate: "2026-06-11 09:59",
    now: BEFORE_CUTOFF,
    settings: SETTINGS,
  });
  assert.equal(result.allowed, false);
  assert.equal(result.code, MINIPROGRAM_ERROR_CODES.DELIVERY_SLOT_UNAVAILABLE);
}

function testTimeAfterRangeRejected() {
  const result = evaluateDeliveryAvailability({
    deliveryDate: "2026-06-11 20:01",
    now: BEFORE_CUTOFF,
    settings: SETTINGS,
  });
  assert.equal(result.allowed, false);
  assert.equal(result.code, MINIPROGRAM_ERROR_CODES.DELIVERY_SLOT_UNAVAILABLE);
}

function testDisabledDateRejected() {
  const result = evaluateDeliveryAvailability({
    deliveryDate: "2026-06-20 下午",
    now: BEFORE_CUTOFF,
    settings: SETTINGS,
  });
  assert.equal(result.allowed, false);
  assert.equal(result.code, MINIPROGRAM_ERROR_CODES.INVALID_DELIVERY_DATE);
}

function testTomorrowAllowed() {
  const result = evaluateDeliveryAvailability({
    deliveryDate: "2026-06-11 晚上",
    now: BEFORE_CUTOFF,
    settings: SETTINGS,
  });
  assert.equal(result.allowed, true);
}

function tomorrowShanghai(): string {
  const now = new Date();
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  const [y, m, d] = today.split("-").map(Number);
  const utc = Date.UTC(y, m - 1, d + 1);
  const nd = new Date(utc);
  const yy = nd.getUTCFullYear();
  const mm = `${nd.getUTCMonth() + 1}`.padStart(2, "0");
  const dd = `${nd.getUTCDate()}`.padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

async function testCreateOrderRejectsInvalidDelivery() {
  if (!process.env.DATABASE_URL) {
    console.log("skip DB tests: DATABASE_URL not set");
    return;
  }

  const { prisma } = await import("@/lib/prisma");
  const { createWechatOrder } = await import("@/services/order-lifecycle");
  const PREFIX = "TEST_ORDER_DELIVERY";
  const invalidDate = `${tomorrowShanghai()} 09:59`;

  const spu = await prisma.productSpu.create({
    data: {
      name: `${PREFIX} 商品`,
      isActive: true,
      skus: {
        create: {
          skuCode: `${PREFIX}_${Date.now()}`,
          specName: "标准款",
          price: 199,
          stock: 10,
          isMainImage: true,
          imageUrl: "https://example.com/test.jpg",
        },
      },
    },
    include: { skus: true },
  });
  const sku = spu.skus[0]!;
  const user = await prisma.user.create({
    data: {
      openId: `${PREFIX}_openid_${Date.now()}`,
      nickName: `${PREFIX}用户`,
    },
  });

  const beforeStock = sku.stock;

  try {
    await createWechatOrder(user.id, {
      receiverName: "测试",
      receiverPhone: "13800001111",
      deliveryAddress: "上海市测试路 1 号",
      deliveryDate: invalidDate,
      totalAmount: 199,
      deliveryFee: 15,
      payAmount: 214,
      items: [{ skuId: sku.id, quantity: 1 }],
    });
    assert.fail("应拒绝截单后当天配送");
  } catch (err) {
    assert.ok(isMiniprogramBusinessError(err));
    assert.equal(err.code, MINIPROGRAM_ERROR_CODES.DELIVERY_SLOT_UNAVAILABLE);
  }

  const after = await prisma.productSku.findUniqueOrThrow({
    where: { id: sku.id },
  });
  assert.equal(after.stock, beforeStock, "违规下单不得扣库存");

  const orderCount = await prisma.order.count({
    where: { userId: user.id },
  });
  assert.equal(orderCount, 0, "违规下单不得创建订单");
}

async function main() {
  testAfterCutoffSameDayRejected();
  testTimeBeforeRangeRejected();
  testTimeAfterRangeRejected();
  testDisabledDateRejected();
  testTomorrowAllowed();
  await testCreateOrderRejectsInvalidDelivery();
  console.log("order-create-delivery.test.ts: all tests passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
