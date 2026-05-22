export const mockProductDetail = (id: string) => ({
  id,
  name: id === "inv-001" ? "红玫瑰" : "花材",
  sku: "RAW-ROSE-RED",
  totalQty: 120,
  unit: "支",
  safetyThreshold: 50,
});

export const mockBatchHistory = [
  {
    id: "batch-001",
    batchNo: "PO-20250520-003",
    inboundAt: "2025-05-20T09:00:00",
    originalQty: 80,
    remainingQty: 45,
    expiresAt: "2025-05-26",
    storageLocation: "冷库 A-01",
  },
  {
    id: "batch-002",
    batchNo: "PO-20250522-001",
    inboundAt: "2025-05-22T08:00:00",
    originalQty: 120,
    remainingQty: 75,
    expiresAt: "2025-05-28",
    storageLocation: "冷库 A-01",
  },
];

export const mockFifoFlow = [
  { at: "2025-05-21T14:00:00", type: "SALE_OUT", batchNo: "PO-20250520-003", qty: 15, ref: "FL20250521012" },
  { at: "2025-05-22T09:30:00", type: "WASTAGE_OUT", batchNo: "PO-20250520-003", qty: 5, ref: "损耗-枯萎" },
  { at: "2025-05-22T11:00:00", type: "INBOUND", batchNo: "PO-20250522-001", qty: 120, ref: "采购入库" },
];
