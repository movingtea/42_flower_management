export const ERROR_MESSAGES: Record<string, string> = {
  AUTH_REQUIRED: '请先登录',
  PRODUCT_NOT_FOUND: '商品不存在',
  PRODUCT_OFF_SHELF: '商品已下架',
  SKU_NOT_FOUND: '规格不存在',
  SKU_INACTIVE: '该规格暂不可售',
  INSUFFICIENT_STOCK: '库存不足',
  INVALID_QUANTITY: '购买数量不正确',
  PRICE_CHANGED: '商品价格有变化，请重新确认',
  INVALID_DELIVERY_DATE: '请选择有效配送日期',
  BULK_ORDER_REQUIRES_PREORDER:
    '这份花礼数量较多，我们需要提前为你备花和制作，暂不支持当天送达',
  DELIVERY_SLOT_UNAVAILABLE: '该配送时段暂不可选',
  CART_ITEM_UNAVAILABLE: '部分商品暂不可结算，请重新确认',
  ORDER_NOT_FOUND: '订单不存在',
  ORDER_INVALID_STATE: '当前订单状态无法操作',
  ORDER_EXPIRED: '订单已超时关闭，请重新下单',
};

export type ApiErrorBody = {
  success?: boolean;
  ok?: boolean;
  code?: string;
  message?: string;
  error?: string;
};

export function resolveApiErrorMessage(body: ApiErrorBody | unknown): string {
  if (!body || typeof body !== 'object') {
    return '操作失败，请稍后再试';
  }
  const o = body as ApiErrorBody;
  const message = o.message?.trim() || o.error?.trim();
  if (message) return message;
  if (o.code && ERROR_MESSAGES[o.code]) {
    return ERROR_MESSAGES[o.code];
  }
  return '操作失败，请稍后再试';
}
