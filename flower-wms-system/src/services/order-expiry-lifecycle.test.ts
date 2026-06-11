/**
 * Run: npm run test:order-expiry-lifecycle
 */
import assert from "node:assert/strict";
import { OrderStatus } from "../src/generated/prisma/enums";
import { PENDING_PAYMENT_TIMEOUT_MS } from "./order-invariants-pure";

async function main() {
  if (!process.env.DATABASE_URL) {
    console.log("skip: DATABASE_URL not set");
    return;
  }

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

  const expiredOrder = await createWechatOrder(user.id, {
    receiverName: "测试",
    receiverPhone: "13800001111",
    deliveryAddress: "上海市测试路 1 号",
    deliveryDate: "2026-12-25 下午",
    totalAmount: 199,
    deliveryFee: 15,
    payAmount: 214,
    items: [{ skuId: sku.id, quantity: 2 }],
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
    deliveryDate: "2026-12-26 下午",
    totalAmount: 199,
    deliveryFee: 15,
    payAmount: 214,
    items: [{ skuId: sku.id, quantity: 1 }],
  });

  const paidOrder = await createWechatOrder(user.id, {
    receiverName: "测试",
    receiverPhone: "13800001111",
    deliveryAddress: "上海市测试路 1 号",
    deliveryDate: "2026-12-27 下午",
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

  await closeExpiredPendingOrder(expiredOrder.id);
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
