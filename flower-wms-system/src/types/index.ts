export {
  OrderStatus,
  StockLogType,
  type OrderStatus as OrderStatusType,
  type StockLogType as StockLogTypeValue,
} from "@/generated/prisma/enums";

export { WmsCategory } from "@/lib/constants";

/** 仪表盘核心指标 */
export interface DashboardMetrics {
  expiringBatchCount: number;
  lowStockProductCount: number;
  todayWastageQty: number;
  todayWastageRate: string;
  todayOrders: number;
  todayRevenue: number;
}

/** FIFO 扣减计划（单批次） */
export interface FifoDeduction {
  batchId: string;
  materialId: string;
  quantity: number;
  inboundAt: Date;
}

/** WMS 原料到货入库 POST /api/admin/wms/stock-in（录入束数，服务端换算为支） */
export interface WmsStockInBody {
  flowerWikiId: string;
  bundleCount: number;
  stemsPerBundle: number;
  costPricePerBundle: number;
  /** 本批次保质期（天）；未填则使用花材母表默认值 */
  shelfLifeDays?: number;
  supplier?: string;
}

/** WMS 物理报损（指定批次） POST /api/admin/wms/stock-loss */
export interface WmsStockLossBody {
  flowerWikiId: string;
  stockBatchId: string;
  lossQuantity: number;
  reason: string;
  operator?: string;
}

/** 盘点调整请求 */
export interface StocktakeInput {
  batchId: string;
  newRemainingQty: number;
  remark?: string;
  operator?: string;
}

/** 小程序下单 POST /api/wechat/orders/create */
export interface WechatCreateOrderInput {
  receiverName: string;
  receiverPhone: string;
  deliveryAddress: string;
  totalAmount: number;
  deliveryFee: number;
  payAmount: number;
  items: { skuId: string; quantity: number }[];
}

/** 模拟支付 POST /api/wechat/orders/mock-pay */
export interface WechatMockPayBody {
  orderId: string;
}

/** 微信支付回调 payload（简化） */
export interface WechatPayCallbackInput {
  orderNo: string;
  wechatTransactionId: string;
}

/** 取消订单 POST /api/wechat/orders/cancel */
export interface WechatCancelOrderBody {
  orderId: string;
}

/** 后台订单状态流转 PATCH /api/admin/orders */
export interface AdminOrderStatusPatchBody {
  orderId: string;
  nextStatus: string;
}

/** BOM 展开后的花材行 */
export interface BomMaterialLine {
  productId: string;
  sku: string;
  name: string;
  quantity: number;
  unit: string;
}

/** Mock：花材库存列表项 */
export interface InventoryItem {
  id: string;
  name: string;
  category: string;
  quantity: number;
  unit: string;
  minStock: number;
  location: string;
  updatedAt: string;
}

/** Mock：损耗记录 */
export interface WastageRecord {
  id: string;
  itemName: string;
  quantity: number;
  unit: string;
  reason: string;
  recordedBy: string;
  recordedAt: string;
}

/** Mock：小程序商品 */
export interface WechatProduct {
  id: string;
  name: string;
  price: number;
  imageUrl: string;
  stock: number;
  category: string;
  description: string;
}
