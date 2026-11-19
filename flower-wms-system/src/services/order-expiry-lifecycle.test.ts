/**
 * Run: npm run test:order-expiry-lifecycle
 */
import assert from "node:assert/strict";
import { OrderStatus } from "@/generated/prisma/enums";
import { PENDING_PAYMENT_TIMEOUT_MS } from "./order-invariants-pure";

// Delivery dates must stay in the future so delivery-availability validation
// never rejects the fixture. Derive them from the run day in the store time
// zone (Asia/Shanghai) instead of pinning calendar dates that expire.
function shanghaiDateAfter(daysFromToday: number): string {
  const target = new Date(Date.now() + daysFromToday * 24 * 60 * 60 * 1000);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(target);
  const value = (type: "year" | "month" | "day") =>
    parts.find((part) => part.type === type)?.value ?? "";
  return `${value("year")}-${value("month")}-${value("day")}`;
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.log("skip: DATABASE_URL not set");
    return;
  }

  const deliveryDateForExpired = `${shanghaiDateAfter(7)} 下午`;
  const deliveryDateForRecent = `${shanghaiDateAfter(8)} 下午`;
  const deliveryDateForPaid = `${shanghaiDateAfter(9)} 下午`;

  const { prisma } = await import("@/lib/prisma");
  const {
    closeExpiredPendingOrders,
    closeExpiredPendingOrder,
    createWechatOrder,
    mockPayWechatOrder,
  } = await import("@/services/order-lifecycle");

  const PREFIX = "TEST_ORDER_EXPIRY";
  const skuCode = `${PREFIX}_${Date.now()}`;

  const spu = await prisma.productSpu.create({
    data: {
      name: `${PREFIX} 商品`,
      isActive: true,
      skus: {
        create: {
          skuCode,
          specName: "标准款",
          price: 199,
          stock: 11,
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

  const expiredOrder = await createWechatOrder(user.id, {
    receiverName: "测试",
    receiverPhone: "13800001111",
    deliveryAddress: "上海市测试路 1 号",
    deliveryDate: deliveryDateForExpired,
    totalAmount: 597,
    deliveryFee: 15,
    payAmount: 612,
    items: [{ skuId: sku.id, quantity: 3 }],
  });

  const expiredCreatedAt = new Date(
    Date.now() - PENDING_PAYMENT_TIMEOUT_MS - 60_000
  );
  await prisma.order.update({
    where: { id: expiredOrder.id },
    data: { createdAt: expiredCreatedAt },
  });

  const afterDeduct = await prisma.productSku.findUniqueOrThrow({
    where: { id: sku.id },
  });
  assert.equal(afterDeduct.stock, 8);

  const recentOrder = await createWechatOrder(user.id, {
    receiverName: "测试",
    receiverPhone: "13800001111",
    deliveryAddress: "上海市测试路 1 号",
    deliveryDate: deliveryDateForRecent,
    totalAmount: 199,
    deliveryFee: 15,
    payAmount: 214,
    items: [{ skuId: sku.id, quantity: 1 }],
  });

  const paidOrder = await createWechatOrder(user.id, {
    receiverName: "测试",
    receiverPhone: "13800001111",
    deliveryAddress: "上海市测试路 1 号",
    deliveryDate: deliveryDateForPaid,
    totalAmount: 199,
    deliveryFee: 15,
    payAmount: 214,
    items: [{ skuId: sku.id, quantity: 1 }],
  });
  await mockPayWechatOrder(user.id, paidOrder.id);

  const result = await closeExpiredPendingOrders();
  assert.ok(result.closed >= 1);

  const expiredRow = await prisma.order.findUniqueOrThrow({
    where: { id: expiredOrder.id },
  });
  assert.equal(expiredRow.status, OrderStatus.CANCELLED);

  const stockAfterExpiry = await prisma.productSku.findUniqueOrThrow({
    where: { id: sku.id },
  });
  assert.equal(stockAfterExpiry.stock, 9, "超时关闭应回补一次库存");

  const recentRow = await prisma.order.findUniqueOrThrow({
    where: { id: recentOrder.id },
  });
  assert.equal(recentRow.status, OrderStatus.PENDING_PAYMENT);

  const paidRow = await prisma.order.findUniqueOrThrow({
    where: { id: paidOrder.id },
  });
  assert.notEqual(paidRow.status, OrderStatus.CANCELLED);

  await assert.rejects(
    () => closeExpiredPendingOrder(expiredOrder.id),
    /仅待支付订单可关闭/,
    "重复关闭已完成订单应被拒绝"
  );
  const stockAfterRepeat = await prisma.productSku.findUniqueOrThrow({
    where: { id: sku.id },
  });
  assert.equal(stockAfterRepeat.stock, 9, "重复执行不得重复回补");

  const saleOutCount = await prisma.stockLog.count({
    where: { orderId: expiredOrder.id, type: "SALE_OUT" },
  });
  assert.equal(saleOutCount, 0);

  console.log("order-expiry-lifecycle.test.ts: all tests passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
