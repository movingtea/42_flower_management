import type { Prisma } from "@/generated/prisma/client";

/** 未软删除的商品 SPU 筛选条件 */
export const activeSpuWhere: Prisma.ProductSpuWhereInput = {
  isDeleted: false,
};

/** @deprecated 请使用 activeSpuWhere */
export const activeProductWhere = activeSpuWhere;
