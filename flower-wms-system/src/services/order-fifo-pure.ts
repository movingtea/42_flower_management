/** 纯函数：SKU 级配方需求展开与按 flower_wiki_id 汇总（无 Prisma 依赖） */

export const PHYSICAL_STOCK_INSUFFICIENT = "物理大仓花材库存不足";

export type WikiDemandLine = {
  orderItemId: string;
  flowerWikiId: string;
  quantity: number;
  chineseName?: string;
};

export type AggregatedWikiDemand = {
  flowerWikiId: string;
  quantity: number;
  chineseName?: string;
};

type RecipeLineLike = {
  flowerWikiId: string;
  quantityNeeded: number;
  wiki?: { chineseName?: string };
};

export type SkuOrderItemInput = {
  id: string;
  quantity: number;
  snapshotProductName: string;
  /** 来自 product_skus.recipe_id；为空则跳过物理扣减（周边等） */
  recipeId: string | null;
  recipeLines: RecipeLineLike[];
};

/**
 * 支付 FIFO：按 SKU 配方展开 × 购买数量，再按 flower_wiki_id 全量汇总。
 * recipeId 为空的订单行静默跳过。
 */
export function expandAndAggregateWikiDemands(
  items: SkuOrderItemInput[]
): AggregatedWikiDemand[] {
  const merged = new Map<string, { quantity: number; chineseName?: string }>();

  for (const item of items) {
    if (!item.recipeId) continue;

    if (!item.recipeLines.length) {
      throw new Error(
        `规格「${item.snapshotProductName}」已绑定配方但无明细行，无法扣减物理库存`
      );
    }

    for (const line of item.recipeLines) {
      const quantity = line.quantityNeeded * item.quantity;
      if (!Number.isInteger(quantity) || quantity <= 0) {
        throw new Error(
          `配方用量无效：${item.snapshotProductName} / ${line.flowerWikiId}`
        );
      }

      const prev = merged.get(line.flowerWikiId);
      merged.set(line.flowerWikiId, {
        quantity: (prev?.quantity ?? 0) + quantity,
        chineseName: line.wiki?.chineseName ?? prev?.chineseName,
      });
    }
  }

  return [...merged.entries()].map(([flowerWikiId, value]) => ({
    flowerWikiId,
    quantity: value.quantity,
    chineseName: value.chineseName,
  }));
}

/** @deprecated 请使用 expandAndAggregateWikiDemands（支付路径） */
export function expandWikiDemandsFromOrderItems(
  items: Omit<SkuOrderItemInput, "recipeId">[]
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
