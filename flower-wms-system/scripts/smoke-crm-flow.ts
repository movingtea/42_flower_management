/**
 * CRM 端到端 smoke（需要 DATABASE_URL 且已 migrate）
 * Run: npm run smoke:crm
 */
import assert from "node:assert/strict";
import { GiftOccasionType, OrderStatus } from "../src/generated/prisma/enums";
import { prisma } from "../src/lib/prisma";
import { completeCrmOnOrderPaid, syncCrmFromOrder } from "../src/services/crm";

const PREFIX = "CRM_SMOKE_TEST";

async function main() {
  const openId = `${PREFIX}_openid_${Date.now()}`;
  const user = await prisma.user.create({
    data: {
      openId,
      nickName: `${PREFIX}用户`,
      defaultReceiverName: "测试收花人",
      defaultReceiverPhone: "13800001111",
      defaultAddress: "上海市测试路 1 号",
    },
  });

  const order = await prisma.order.create({
    data: {
      orderNo: `${PREFIX}_ORD_${Date.now()}`,
      userId: user.id,
      totalAmount: 368,
      deliveryFee: 0,
      payAmount: 368,
      receiverName: "李女士",
      receiverPhone: "13900002222",
      deliveryAddress: "上海市浦东新区测试路 88 号",
      deliveryDate: "尽快送达",
      greetingCard: "生日快乐",
      status: OrderStatus.PENDING_PAYMENT,
    },
  });

  const synced = await syncCrmFromOrder({
    orderId: order.id,
    miniProgramUserId: user.id,
    wechatOpenid: user.openId,
    wechatNickname: user.nickName,
    buyerInfo: { name: "王先生", phone: "13800001111" },
    recipientInfo: {
      name: "李女士",
      phone: "13900002222",
      address: order.deliveryAddress,
      relationLabel: "女友",
      preferredColors: "粉色",
      saveRecipient: true,
    },
    giftOccasion: {
      occasionType: GiftOccasionType.BIRTHDAY,
      importantDate: "2025-06-18",
      cardMessage: order.greetingCard,
    },
    reminderOptions: { enabled: true, daysBefore: 7 },
    createReminder: false,
  });

  assert.ok(synced.customer, "Customer should be created");
  assert.ok(synced.recipient, "Recipient should be created");
  assert.ok(synced.occasion, "GiftOccasion should be created");
  assert.equal(synced.reminder, null, "Reminder should not exist before pay");

  await prisma.order.update({
    where: { id: order.id },
    data: { status: OrderStatus.PAID, paidAt: new Date() },
  });

  const paid = await completeCrmOnOrderPaid(order.id);
  assert.ok(paid?.customer, "Customer should exist after pay");
  assert.ok(paid?.reminder, "Reminder should be created after pay");

  const customer = await prisma.customer.findUniqueOrThrow({
    where: { id: synced.customer.id },
  });
  assert.equal(customer.totalOrders, 1);
  assert.equal(Number(customer.totalSpent), 368);

  console.log("smoke-crm-flow passed", {
    customerId: customer.id,
    reminderId: paid.reminder?.id,
  });
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
