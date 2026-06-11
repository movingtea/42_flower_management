/**
 * 小程序下单链路 smoke（需要 DATABASE_URL）
 * Run: npm run smoke:miniprogram-order-flow
 */
import "dotenv/config";
import assert from "node:assert/strict";
import { OrderStatus } from "../src/generated/prisma/enums";
import { prisma } from "../src/lib/prisma";
import {
  closePendingOrder,
  createWechatOrder,
} from "../src/services/order-lifecycle";

const PREFIX = "SMOKE_TEST_ORDER_FLOW";

async function main() {
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
          stock: 5,
          isMainImage: true,
          imageUrl: "https://example.com/smoke.jpg",
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

  const order = await createWechatOrder(user.id, {
    receiverName: "测试",
    receiverPhone: "13800001111",
    deliveryAddress: "上海市测试路 1 号",
    deliveryDate: "2026-06-15 14:00",
    totalAmount: 199,
    deliveryFee: 15,
    payAmount: 214,
    items: [{ skuId: sku.id, quantity: 2 }],
  });
  assert.equal(order.status, OrderStatus.PENDING_PAYMENT);

  const afterCreate = await prisma.productSku.findUniqueOrThrow({
    where: { id: sku.id },
  });
  assert.equal(afterCreate.stock, 3);

  await closePendingOrder(order.id, user.id);
  const afterCancel = await prisma.productSku.findUniqueOrThrow({
    where: { id: sku.id },
  });
  assert.equal(afterCancel.stock, 5, "取消待支付订单应回补 stock");

  const saleOutCount = await prisma.stockLog.count({
    where: { orderId: order.id, type: "SALE_OUT" },
  });
  assert.equal(saleOutCount, 0, "待支付取消不得生成 SALE_OUT");

  console.log("smoke-miniprogram-order-flow passed", { orderId: order.id });
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
