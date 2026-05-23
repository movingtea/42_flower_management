import type { OrderStatusType } from "@/types";

export interface MockWechatOrder {
  id: string;
  orderNo: string;
  customerName: string;
  status: Lowercase<OrderStatusType>;
  totalAmount: number;
  items: { productName: string; quantity: number; price: number }[];
  createdAt: string;
}

export const mockWechatOrders: MockWechatOrder[] = [
  {
    id: "ord-001",
    orderNo: "FL20250522001",
    customerName: "张女士",
    status: "paid",
    totalAmount: 198,
    items: [{ productName: "经典红玫瑰束", quantity: 1, price: 198 }],
    createdAt: "2025-05-22T10:30:00",
  },
  {
    id: "ord-002",
    orderNo: "FL20250522002",
    customerName: "李先生",
    status: "paid",
    totalAmount: 426,
    items: [
      { productName: "清新向日葵花篮", quantity: 1, price: 168 },
      { productName: "温柔粉百合礼盒", quantity: 1, price: 258 },
    ],
    createdAt: "2025-05-22T11:05:00",
  },
];
