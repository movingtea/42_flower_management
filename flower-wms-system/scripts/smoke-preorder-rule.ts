/**
 * 大批量提前预订 smoke（需要 DATABASE_URL）
 * Run: npm run smoke:preorder-rule
 */
import "dotenv/config";
import assert from "node:assert/strict";
import { MINIPROGRAM_ERROR_CODES } from "../src/lib/miniprogram-business-error";
import { prisma } from "../src/lib/prisma";
import { createWechatOrder } from "../src/services/order-lifecycle";
import { isMiniprogramBusinessError } from "../src/lib/miniprogram-business-error";
import { getTodayAppDateString, addAppCalendarDays, parseAppDateString, appDateStringFromParts } from "../src/lib/datetime";

const PREFIX = "SMOKE_TEST_PREORDER";

async function main() {
  const now = new Date();
  const today = getTodayAppDateString(now);
  const todayParts = parseAppDateString(today)!;
  const tomorrow = appDateStringFromParts(addAppCalendarDays(todayParts, 1));

  const skuCode = `${PREFIX}_${Date.now()}`;
  const spu = await prisma.productSpu.create({
    data: {
      name: `${PREFIX} 提前预订商品`,
      isActive: true,
      skus: {
        create: {
          skuCode,
          specName: "标准款",
          price: 199,
          stock: 10,
          isMainImage: true,
          imageUrl: "https://example.com/smoke.jpg",
          bulkPreorderEnabled: true,
          bulkOrderThreshold: 3,
          bulkMinLeadDays: 1,
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

  let blocked = false;
  try {
    await createWechatOrder(user.id, {
      receiverName: "测试",
      receiverPhone: "13800001111",
      deliveryAddress: "上海市测试路 1 号",
      deliveryDate: `${today} 14:00`,
      totalAmount: 597,
      deliveryFee: 15,
      payAmount: 612,
      items: [{ skuId: sku.id, quantity: 3 }],
    });
  } catch (err) {
    blocked = true;
    assert.ok(isMiniprogramBusinessError(err));
    assert.equal(err.code, MINIPROGRAM_ERROR_CODES.BULK_ORDER_REQUIRES_PREORDER);
  }
  assert.equal(blocked, true);

  const stockAfterBlock = (
    await prisma.productSku.findUniqueOrThrow({ where: { id: sku.id } })
  ).stock;
  assert.equal(stockAfterBlock, 10, "违规时不得扣库存");

  const order = await createWechatOrder(user.id, {
    receiverName: "测试",
    receiverPhone: "13800001111",
    deliveryAddress: "上海市测试路 1 号",
    deliveryDate: `${tomorrow} 14:00`,
    totalAmount: 597,
    deliveryFee: 15,
    payAmount: 612,
    items: [{ skuId: sku.id, quantity: 3 }],
  });
  assert.ok(order.id);

  console.log("smoke-preorder-rule passed", { orderId: order.id });
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
