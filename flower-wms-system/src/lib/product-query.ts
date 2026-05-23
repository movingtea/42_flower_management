import type { Prisma } from "@/generated/prisma/client";

/** 未软删除的商品筛选条件（列表、商城、下单等须统一使用） */
export const activeProductWhere: Prisma.ProductWhereInput = {
  isDeleted: false,
};
