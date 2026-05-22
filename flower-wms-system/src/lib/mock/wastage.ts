import type { WastageRecord } from "@/types";

export const mockWastage: WastageRecord[] = [
  {
    id: "wst-001",
    itemName: "红玫瑰",
    quantity: 5,
    unit: "支",
    reason: "运输挤压损伤",
    recordedBy: "小陈",
    recordedAt: "2025-05-22T09:15:00",
  },
  {
    id: "wst-002",
    itemName: "百合",
    quantity: 3,
    unit: "支",
    reason: "花期过短报废",
    recordedBy: "小陈",
    recordedAt: "2025-05-22T08:40:00",
  },
  {
    id: "wst-003",
    itemName: "康乃馨",
    quantity: 4,
    unit: "支",
    reason: "包装破损",
    recordedBy: "小李",
    recordedAt: "2025-05-21T18:20:00",
  },
];
