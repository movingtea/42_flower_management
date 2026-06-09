export type SupplierType =
  | "LOCAL"
  | "KUNMING_ONLINE"
  | "WHOLESALE_MARKET"
  | "PLATFORM"
  | "OTHER";

export type PurchaseOrderStatus = "DRAFT" | "ORDERED" | "RECEIVED" | "CANCELLED";

export type PurchaseCostAllocationMethod = "BY_AMOUNT" | "BY_QUANTITY";

export type Supplier = {
  id: string;
  name: string;
  supplierType: SupplierType;
  contactName: string | null;
  phone: string | null;
  wechat: string | null;
  address: string | null;
  note: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

export type PurchaseOrderListItem = {
  id: string;
  purchaseNo: string;
  supplierId: string;
  supplier: Supplier;
  lineCount: number;
  goodsAmount: string;
  shippingFee?: string;
  packagingFee?: string;
  otherFee?: string;
  totalAmount: string;
  status: PurchaseOrderStatus;
  purchaseDate: string;
  receivedAt: string | null;
  note: string | null;
};

export type PurchaseOrderLine = {
  id: string;
  purchaseOrderId: string;
  flowerWikiId: string;
  flowerWiki: {
    id: string;
    chineseName: string;
    englishName: string;
    colorTags: string[];
  };
  purchaseName: string | null;
  grade: string | null;
  color: string | null;
  spec: string | null;
  purchaseQuantity: string;
  purchaseUnit: string;
  stemsPerUnit: string;
  totalStems: string;
  unitPrice: string;
  lineAmount: string;
  allocatedExtraFee: string;
  actualTotalCost: string;
  actualUnitCost: string;
  usableRate: string | null;
  lossRate: string | null;
  lossAdjustedTotalCost: string | null;
  lossAdjustedUnitCost: string | null;
  lossModelExtraCost: string | null;
  supplierSkuName: string | null;
  note: string | null;
  inboundBatchId: string | null;
  inboundBatch: {
    id: string;
    batchNo: string | null;
    inboundAt: string;
    originalQty: number;
    remainingQty: number;
    unitCost: string;
    lossAdjustedUnitCost: string | null;
    usableRate: string | null;
    lossRate: string | null;
  } | null;
  createdAt: string;
  updatedAt: string;
};

export type PurchaseOrderDetail = {
  id: string;
  purchaseNo: string;
  supplierId: string;
  supplier: Supplier;
  purchaseDate: string;
  expectedArrivalDate: string | null;
  receivedAt: string | null;
  status: PurchaseOrderStatus;
  goodsAmount: string;
  shippingFee: string;
  packagingFee: string;
  otherFee: string;
  totalExtraFee: string;
  totalAmount: string;
  allocationMethod: PurchaseCostAllocationMethod;
  note: string | null;
  lines: PurchaseOrderLine[];
  createdAt: string;
  updatedAt: string;
};

export type PurchasePreviewLine = {
  flowerWikiId: string;
  purchaseQuantity: string;
  purchaseUnit: string;
  stemsPerUnit: string;
  unitPrice: string;
  totalStems: string;
  lineAmount: string;
  allocatedExtraFee: string;
  actualTotalCost: string;
  actualUnitCost: string;
  usableRate: string;
  lossRate: string;
  lossAdjustedTotalCost: string;
  lossAdjustedUnitCost: string;
  lossModelExtraCost: string;
};

export type PurchasePreview = {
  goodsAmount: string;
  shippingFee: string;
  packagingFee: string;
  otherFee: string;
  totalExtraFee: string;
  totalAmount: string;
  allocationMethod: PurchaseCostAllocationMethod;
  lines: PurchasePreviewLine[];
  warnings: string[];
};

export const supplierTypeLabels: Record<SupplierType, string> = {
  LOCAL: "本地供应商",
  KUNMING_ONLINE: "昆明线上",
  WHOLESALE_MARKET: "批发市场",
  PLATFORM: "平台采购",
  OTHER: "其他",
};

export const purchaseStatusLabels: Record<PurchaseOrderStatus, string> = {
  DRAFT: "草稿",
  ORDERED: "已下单",
  RECEIVED: "已到货",
  CANCELLED: "已取消",
};

export const allocationMethodLabels: Record<PurchaseCostAllocationMethod, string> = {
  BY_AMOUNT: "按金额分摊",
  BY_QUANTITY: "按数量分摊",
};

export function isEditablePurchaseStatus(status: PurchaseOrderStatus) {
  return status === "DRAFT" || status === "ORDERED";
}

export function formatDate(value: string | null | undefined) {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("zh-CN");
}

export function formatDateTime(value: string | null | undefined) {
  if (!value) return "—";
  return new Date(value).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatQuantity(value: unknown) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "0";
  return Number.isInteger(number) ? String(number) : number.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}
