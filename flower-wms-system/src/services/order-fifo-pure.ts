/** 纯函数：配方需求展开（无 Prisma 依赖，供单测与集成层共用） */

export const PHYSICAL_STOCK_INSUFFICIENT = "物理大仓花材库存不足";

export type WikiDemandLine = {
  orderItemId: string;
  flowerWikiId: string;
  quantity: number;
  chineseName?: string;
};

type RecipeLineLike = {
  flowerWikiId: string;
  quantityNeeded: number;
  wiki?: { chineseName?: string };
};

type OrderItemLike = {
  id: string;
  quantity: number;
  snapshotProductName: string;
  recipeLines: RecipeLineLike[];
};

export function expandWikiDemandsFromOrderItems(
  items: OrderItemLike[]
): WikiDemandLine[] {
  const demands: WikiDemandLine[] = [];

  for (const item of items) {
    if (!item.recipeLines.length) {
      throw new Error(
        `商品「${item.snapshotProductName}」未绑定标准配方，无法扣减物理库存`
      );
    }

    for (const line of item.recipeLines) {
      const quantity = line.quantityNeeded * item.quantity;
      if (!Number.isInteger(quantity) || quantity <= 0) {
        throw new Error(
          `配方用量无效：${item.snapshotProductName} / ${line.flowerWikiId}`
        );
      }
      demands.push({
        orderItemId: item.id,
        flowerWikiId: line.flowerWikiId,
        quantity,
        chineseName: line.wiki?.chineseName,
      });
    }
  }

  return demands;
}
