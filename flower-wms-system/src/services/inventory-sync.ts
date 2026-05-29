import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";

type DbClient = typeof prisma;

/** 物理批次「可用」筛选：有剩余量且未过期 */
export function availableBatchWhere(
  now: Date = new Date()
): Prisma.BatchWhereInput {
  return {
    remainingQty: { gt: 0 },
    OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
  };
}

/** 绑定配方且 SPU 已上架、未软删的 SKU 筛选 */
export const onlineRecipeSkuWhere: Prisma.ProductSkuWhereInput = {
  recipeId: { not: null },
  spu: {
    isDeleted: false,
    isActive: true,
  },
};

const recipeWithLinesInclude = {
  recipe: {
    include: {
      lines: true,
    },
  },
} as const;

type RecipeBoundSku = Prisma.ProductSkuGetPayload<{
  include: typeof recipeWithLinesInclude;
}>;

export type InventorySyncResult = {
  scanned: number;
  clamped: number;
  unchanged: number;
  /** 配方无明细行或原料全缺时归零的 SKU 数 */
  zeroedByRecipe: number;
};

/**
 * 按 flower_wiki_id 聚合大仓可用物理批次剩余支数（只读）。
 */
export async function sumAvailableStemsForWiki(
  flowerWikiId: string,
  client: DbClient = prisma,
  now: Date = new Date()
): Promise<number> {
  const agg = await client.batch.aggregate({
    _sum: { remainingQty: true },
    where: {
      ...availableBatchWhere(now),
      material: { wikiId: flowerWikiId },
    },
  });
  return agg._sum.remainingQty ?? 0;
}

/**
 * 木桶原理：取配方各原料可成套数的最小值。
 * @returns 该 SKU 在物理大仓下最多还能做多少「套」
 */
export function computeBottleneckQty(
  lines: Array<{ flowerWikiId: string; quantityNeeded: number }>,
  wikiAvailableStems: ReadonlyMap<string, number>
): number {
  if (lines.length === 0) return 0;

  let maxPossibleQty = Infinity;

  for (const line of lines) {
    const qtyNeeded = line.quantityNeeded;
    if (!Number.isInteger(qtyNeeded) || qtyNeeded <= 0) {
      return 0;
    }

    const totalStems = wikiAvailableStems.get(line.flowerWikiId) ?? 0;
    const setsForLine = Math.floor(totalStems / qtyNeeded);
    maxPossibleQty = Math.min(maxPossibleQty, setsForLine);
  }

  return maxPossibleQty === Infinity ? 0 : maxPossibleQty;
}

async function loadOnlineRecipeSkus(
  client: DbClient = prisma
): Promise<RecipeBoundSku[]> {
  return client.productSku.findMany({
    where: onlineRecipeSkuWhere,
    include: recipeWithLinesInclude,
    orderBy: { updatedAt: "desc" },
  });
}

async function buildWikiAvailableStemsMap(
  wikiIds: string[],
  client: DbClient = prisma,
  now: Date = new Date()
): Promise<Map<string, number>> {
  const unique = [...new Set(wikiIds)];
  const map = new Map<string, number>();

  await Promise.all(
    unique.map(async (wikiId) => {
      const total = await sumAvailableStemsForWiki(wikiId, client, now);
      map.set(wikiId, total);
    })
  );

  return map;
}

/**
 * 大仓可用物理批次 → 电商前台虚拟可售库存反向校准。
 * 只向下截断（clamp），不自动抬高虚拟库存。
 */
export async function syncPhysicalStockToVirtual(
  client: DbClient = prisma
): Promise<InventorySyncResult> {
  const now = new Date();
  const skus = await loadOnlineRecipeSkus(client);

  const allWikiIds = skus.flatMap(
    (sku) => sku.recipe?.lines.map((l) => l.flowerWikiId) ?? []
  );
  const wikiStems = await buildWikiAvailableStemsMap(allWikiIds, client, now);

  const result: InventorySyncResult = {
    scanned: skus.length,
    clamped: 0,
    unchanged: 0,
    zeroedByRecipe: 0,
  };

  for (const sku of skus) {
    const lines = sku.recipe?.lines ?? [];
    const maxPossibleQty = computeBottleneckQty(lines, wikiStems);

    if (lines.length === 0 && sku.stock > 0) {
      result.zeroedByRecipe += 1;
    }

    if (sku.stock <= maxPossibleQty) {
      result.unchanged += 1;
      continue;
    }

    await client.productSku.update({
      where: { id: sku.id },
      data: { stock: maxPossibleQty },
    });

    console.log(
      `[库存健康投影校准] SKU ${sku.id} 虚拟库存由 ${sku.stock} 强行截断至物理上限 ${maxPossibleQty}`
    );
    result.clamped += 1;
  }

  return result;
}
