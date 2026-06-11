/**
 * CRM 订单同步 smoke（需要 DATABASE_URL）
 * Run: npm run smoke:crm-order-sync
 */
import "dotenv/config";
import assert from "node:assert/strict";
import { GiftOccasionType, OrderStatus } from "../src/generated/prisma/enums";
import { MINIPROGRAM_ERROR_CODES } from "../src/lib/miniprogram-business-error";
import { prisma } from "../src/lib/prisma";
import { createWechatOrder } from "../src/services/order-lifecycle";
import { isMiniprogramBusinessError } from "../src/lib/miniprogram-business-error";
import { isSystemReminderExpired, SYSTEM_REMINDER_EXPIRY_MS } from "../src/services/crm-pure";
import { completeCrmOnOrderPaid } from "../src/services/crm";

const PREFIX = "SMOKE_TEST_CRM_SYNC";

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
          stock: 0,
          isMainImage: true,
          imageUrl: "https://example.com/smoke.jpg",
        },
      },
    },
    include: { skus: true },
  });

  const user = await prisma.user.create({
    data: {
      openId: `${PREFIX}_openid_${Date.now()}`,
      nickName: `${PREFIX}用户`,
    },
  });

  let failed = false;
  try {
    await createWechatOrder(user.id, {
      receiverName: "测试",
      receiverPhone: "13800001111",
      deliveryAddress: "上海市测试路 1 号",
      deliveryDate: "2026-06-15 14:00",
      totalAmount: 199,
      deliveryFee: 15,
      payAmount: 214,
      items: [{ skuId: spu.skus[0]!.id, quantity: 1 }],
    });
  } catch (err) {
    failed = true;
    assert.ok(isMiniprogramBusinessError(err));
    assert.equal(err.code, MINIPROGRAM_ERROR_CODES.INSUFFICIENT_STOCK);
  }
  assert.equal(failed, true);

  const crmAfterFail = await prisma.customer.count({
    where: { miniProgramUserId: user.id },
  });
  assert.equal(crmAfterFail, 0, "订单创建失败不得写 CRM");

  const skuCode2 = `${PREFIX}_ok_${Date.now()}`;
  const spu2 = await prisma.productSpu.create({
    data: {
      name: `${PREFIX} 可下单商品`,
      isActive: true,
      skus: {
        create: {
          skuCode: skuCode2,
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

  const user2 = await prisma.user.create({
    data: {
      openId: `${PREFIX}_openid2_${Date.now()}`,
      nickName: `${PREFIX}用户2`,
    },
  });

  const order = await createWechatOrder(user2.id, {
    receiverName: "测试",
    receiverPhone: "13800002222",
    deliveryAddress: "上海市测试路 2 号",
    deliveryDate: "2026-06-15 14:00",
    totalAmount: 199,
    deliveryFee: 15,
    payAmount: 214,
    items: [{ skuId: spu2.skus[0]!.id, quantity: 1 }],
  });

  await prisma.order.update({
    where: { id: order.id },
    data: { status: OrderStatus.PAID, paidAt: new Date() },
  });

  const crmPaid = await completeCrmOnOrderPaid(order.id);
  assert.ok(crmPaid?.customer);

  const expired = isSystemReminderExpired({
    createdAt: new Date(Date.now() - SYSTEM_REMINDER_EXPIRY_MS - 1000),
    status: "PENDING",
  });
  assert.equal(expired, true);

  void GiftOccasionType;
  console.log("smoke-crm-order-sync passed", { orderId: order.id });
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
