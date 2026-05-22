import type { FulfillmentPhase } from "@/services/order-status";

export type KanbanOrderItem = {
  label: string;
  quantity: number;
};

export type KanbanOrder = {
  id: string;
  orderNo: string;
  phase: FulfillmentPhase;
  deliveryTime: string | null;
  isUrgent: boolean;
  isOverdue: boolean;
  receiverName: string | null;
  receiverPhone: string | null;
  deliveryAddress: string | null;
  totalAmount: string;
  items: KanbanOrderItem[];
};

export type KanbanColumnId = "PAID" | "MAKING" | "DELIVERING";
