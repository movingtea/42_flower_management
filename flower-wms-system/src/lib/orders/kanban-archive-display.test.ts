import assert from "node:assert/strict";
import type { KanbanOrder } from "@/app/wms/orders/types";
import {
  formatKanbanCompactDate,
  getArchiveCompactStatusLabel,
  isArchiveKanbanColumn,
  KANBAN_ARCHIVE_DISPLAY_LIMIT,
  sliceArchiveColumnOrders,
} from "./kanban-archive-display";

function makeOrder(partial: Partial<KanbanOrder>): KanbanOrder {
  return {
    id: "1",
    orderNo: "#001",
    payAmount: "399",
    status: "COMPLETED",
    statusLabel: "已完成",
    createdAt: "2026-06-13T10:00:00.000Z",
    deliveryDate: "",
    receiverName: "测试",
    receiverPhone: "13800000000",
    deliveryAddress: "地址",
    greetingCard: null,
    items: [],
    cancelSource: null,
    refundAmount: null,
    deliveryInfo: null,
    grossMargin: null,
    ...partial,
  };
}

function testCompactDatePrefersDelivery() {
  assert.equal(
    formatKanbanCompactDate("2026-06-01T00:00:00.000Z", "2026-06-13"),
    "06-13"
  );
}

function testCompactDateFromCreatedAt() {
  assert.equal(formatKanbanCompactDate("2026-06-13T10:00:00.000Z", ""), "06-13");
}

function testArchiveSliceLimit() {
  const orders = Array.from({ length: 25 }, (_, i) => ({ id: String(i) }));
  const result = sliceArchiveColumnOrders(orders);
  assert.equal(result.visible.length, KANBAN_ARCHIVE_DISPLAY_LIMIT);
  assert.equal(result.hiddenCount, 5);
  assert.equal(result.total, 25);
}

function testCompletedStatusLabel() {
  const order = makeOrder({ status: "COMPLETED" });
  assert.equal(getArchiveCompactStatusLabel(order), "已完成");
}

function testArchiveColumnId() {
  assert.equal(isArchiveKanbanColumn("archive"), true);
  assert.equal(isArchiveKanbanColumn("pending"), false);
}

testCompactDatePrefersDelivery();
testCompactDateFromCreatedAt();
testArchiveSliceLimit();
testCompletedStatusLabel();
testArchiveColumnId();

console.log("kanban-archive-display.test.ts: all passed");
