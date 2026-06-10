/** 空状态文案 — 供第二轮试运营 UI 使用 */
export const EMPTY_STATE_COPY = {
  wmsInventory: "还没有库存，请先创建采购单或手工入库。",
  purchaseOrders: "还没有采购单，可以从供应商报价创建采购。",
  recipes: "还没有标准配方，请先创建一个花束配方。",
  cmsProducts: "还没有商品，请先创建商品并绑定 Recipe。",
  recommendationSlots: "当前推荐位为空，小程序首页不会展示该模块。",
  crmCustomers: "小程序订单创建后会自动沉淀客户。",
  reports: "暂无订单数据，完成一笔测试订单后可查看报表。",
} as const;
