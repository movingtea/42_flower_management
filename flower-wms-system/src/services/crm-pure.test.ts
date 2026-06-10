/**
 * Run with: npm run test:crm
 */
import assert from "node:assert/strict";
import { GiftOccasionType, OrderStatus } from "@/generated/prisma/enums";
import {
  buildCustomerDisplayName,
  buildReminderContent,
  buildReminderDate,
  calculateCustomerStats,
  maskPhone,
  normalizePhone,
  shouldCreateReminder,
} from "@/services/crm-pure";
import { formatDateInAppTimezoneIso as formatIso } from "@/lib/datetime";

function testNormalizePhone() {
  assert.equal(normalizePhone(" 138-1234-5678 "), "13812345678");
  assert.equal(normalizePhone("+8613812345678"), "13812345678");
  assert.equal(normalizePhone(""), null);
  assert.equal(normalizePhone(null), null);
}

function testMaskPhone() {
  assert.equal(maskPhone("13812345678"), "138****5678");
  assert.equal(maskPhone(null), null);
}

function testBuildCustomerDisplayName() {
  assert.equal(
    buildCustomerDisplayName({
      buyerName: " 王先生 ",
      wechatNickname: "wx",
      phone: "13812345678",
    }),
    "王先生"
  );
  assert.equal(
    buildCustomerDisplayName({ wechatNickname: "花花", phone: "13812345678" }),
    "花花"
  );
  assert.equal(
    buildCustomerDisplayName({ phone: "13812345678" }),
    "138****5678"
  );
  assert.equal(buildCustomerDisplayName({}), "小程序客户");
}

function testCalculateCustomerStats() {
  const stats = calculateCustomerStats([
    {
      status: OrderStatus.PAID,
      payAmount: 100,
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      paidAt: new Date("2026-01-02T00:00:00.000Z"),
    },
    {
      status: OrderStatus.COMPLETED,
      payAmount: 200,
      createdAt: new Date("2026-02-01T00:00:00.000Z"),
      paidAt: new Date("2026-02-02T00:00:00.000Z"),
    },
    {
      status: OrderStatus.CANCELLED,
      payAmount: 50,
      createdAt: new Date("2026-03-01T00:00:00.000Z"),
    },
    {
      status: OrderStatus.PAID,
      payAmount: 80,
      createdAt: new Date("2026-04-01T00:00:00.000Z"),
      refundAmount: 80,
      refundTime: new Date("2026-04-02T00:00:00.000Z"),
      cancelSource: "REFUND",
    },
  ]);

  assert.equal(stats.totalOrders, 2);
  assert.equal(stats.totalSpent, 300);
  assert.equal(stats.averageOrderValue, 150);
  assert.equal(stats.firstOrderAt?.toISOString(), "2026-01-02T00:00:00.000Z");
  assert.equal(stats.lastOrderAt?.toISOString(), "2026-02-02T00:00:00.000Z");
}

function testBuildReminderDateUpcomingThisYear() {
  const importantDate = new Date("2025-06-18T00:00:00.000Z");
  const now = new Date("2026-06-10T12:00:00.000Z");
  const { remindAt, dueDate } = buildReminderDate(
    importantDate,
    GiftOccasionType.BIRTHDAY,
    7,
    now
  );

  assert.equal(formatIso(remindAt), "2026-06-11");
  assert.equal(formatIso(dueDate), "2026-06-18");
}

function testBuildReminderDateNextYearWhenPassed() {
  const importantDate = new Date("2025-06-18T00:00:00.000Z");
  const now = new Date("2026-06-20T12:00:00.000Z");
  const { remindAt, dueDate } = buildReminderDate(
    importantDate,
    GiftOccasionType.BIRTHDAY,
    7,
    now
  );

  assert.equal(formatIso(remindAt), "2027-06-11");
  assert.equal(formatIso(dueDate), "2027-06-18");
}

function testBuildReminderDateUtcPlus8NoShift() {
  const importantDate = new Date("2025-03-01T00:00:00.000Z");
  const now = new Date("2026-01-15T00:00:00.000Z");
  const { remindAt, dueDate } = buildReminderDate(
    importantDate,
    GiftOccasionType.ANNIVERSARY,
    7,
    now
  );

  assert.equal(formatIso(dueDate), "2026-03-01");
  assert.equal(formatIso(remindAt), "2026-02-22");
}

function testShouldCreateReminder() {
  assert.equal(
    shouldCreateReminder({
      importantDate: new Date("2025-06-18T00:00:00.000Z"),
      reminderEnabled: true,
      occasionType: GiftOccasionType.BIRTHDAY,
      now: new Date("2026-06-10T00:00:00.000Z"),
    }),
    true
  );

  assert.equal(
    shouldCreateReminder({
      importantDate: new Date("2025-06-18T00:00:00.000Z"),
      reminderEnabled: false,
      occasionType: GiftOccasionType.BIRTHDAY,
    }),
    false
  );

  assert.equal(
    shouldCreateReminder({
      importantDate: null,
      reminderEnabled: true,
      occasionType: GiftOccasionType.BIRTHDAY,
    }),
    false
  );
}

function testBuildReminderContent() {
  const { title, content } = buildReminderContent({
    customerName: "王先生",
    recipientName: "李女士",
    relationLabel: "女友",
    occasionType: GiftOccasionType.BIRTHDAY,
    daysBefore: 7,
    lastProductName: "夏日来信",
    lastOrderAmount: 368,
  });

  assert.equal(title, "生日复购提醒");
  assert.ok(content.includes("王先生"));
  assert.ok(content.includes("李女士"));
  assert.ok(content.includes("夏日来信"));
}

function run() {
  testNormalizePhone();
  testMaskPhone();
  testBuildCustomerDisplayName();
  testCalculateCustomerStats();
  testBuildReminderDateUpcomingThisYear();
  testBuildReminderDateNextYearWhenPassed();
  testBuildReminderDateUtcPlus8NoShift();
  testShouldCreateReminder();
  testBuildReminderContent();
  console.log("crm-pure tests passed");
}

run();
