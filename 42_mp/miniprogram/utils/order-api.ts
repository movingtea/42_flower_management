import { request } from './request';

export const FREE_SHIPPING_THRESHOLD = 99;
export const DEFAULT_DELIVERY_FEE = 15;

export function calcDeliveryFee(productTotal: number): number {
  return productTotal >= FREE_SHIPPING_THRESHOLD ? 0 : DEFAULT_DELIVERY_FEE;
}

export type CreateOrderLine = {
  skuId: string;
  quantity: number;
};

export type CrmBuyerInfo = {
  name?: string;
  phone?: string;
};

export type CrmRecipientInfo = {
  name?: string;
  phone?: string;
  address?: string;
  relationType?: string;
  relationLabel?: string;
  preferredColors?: string;
  dislikedFlowers?: string;
  preferenceNote?: string;
  saveRecipient?: boolean;
};

export type CrmGiftOccasion = {
  occasionType?: string;
  occasionLabel?: string;
  importantDate?: string;
  giftPurpose?: string;
  cardMessage?: string;
  note?: string;
};

export type CrmReminderOptions = {
  enabled?: boolean;
  daysBefore?: number;
};

export type CreateOrderPayload = {
  receiverName: string;
  receiverPhone: string;
  deliveryAddress: string;
  deliveryDate: string;
  greetingCard?: string;
  totalAmount: number;
  deliveryFee: number;
  payAmount: number;
  items: CreateOrderLine[];
  buyerInfo?: CrmBuyerInfo;
  recipientInfo?: CrmRecipientInfo;
  giftOccasion?: CrmGiftOccasion;
  reminderOptions?: CrmReminderOptions;
};

export type CreateOrderResult = {
  orderId: string;
  orderNo: string;
  status: string;
  payAmount: number;
};

export type MockPayResult = {
  orderId: string;
  orderNo: string;
  status: string;
  paidAt?: string;
};

export type OrderListItemLine = {
  id: string;
  skuId: string;
  quantity: number;
  snapshotProductName: string;
  snapshotSpecName: string;
  snapshotPrice: number;
  snapshotImageUrl: string;
};

export type OrderListItem = {
  id: string;
  orderNo: string;
  status: string;
  statusLabel: string;
  totalAmount: number;
  deliveryFee: number;
  payAmount: number;
  receiverName: string;
  receiverPhone: string;
  deliveryAddress: string;
  deliveryDate?: string;
  greetingCard?: string | null;
  deliveryInfo?: string | null;
  paidAt?: string;
  createdAt: string;
  items: OrderListItemLine[];
};

export function createOrder(payload: CreateOrderPayload) {
  return request<CreateOrderResult>({
    url: '/orders/create',
    method: 'POST',
    data: payload as WechatMiniprogram.IAnyObject,
  });
}

export function mockPayOrder(orderId: string) {
  return request<MockPayResult>({
    url: '/orders/mock-pay',
    method: 'POST',
    data: { orderId },
  });
}

export function fetchMyOrders() {
  return request<{ orders: OrderListItem[] }>({
    url: '/orders',
    method: 'GET',
  });
}

export function confirmOrderReceipt(orderId: string) {
  return request<{ orderId: string; orderNo: string; status: string }>({
    url: '/orders/confirm-receipt',
    method: 'POST',
    data: { orderId },
  });
}

export const ORDER_STATUS_LABEL: Record<string, string> = {
  PENDING_PAYMENT: '待支付',
  PAID: '已支付',
  PRODUCTION: '制作中',
  DELIVERING: '配送中',
  COMPLETED: '已完成',
  CANCELLED: '已取消',
};
