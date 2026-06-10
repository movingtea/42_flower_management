import { OrderStatus, RecommendationSlotType } from "@/generated/prisma/enums";
import { isLocalhostUrl } from "@/lib/image-url";
import { activeSpuWhere } from "@/lib/product-query";
import { prisma } from "@/lib/prisma";
import {
  buildSetupChecklist,
  type SetupChecklistResult,
  type SetupChecklistStats,
} from "@/services/setup-checklist-pure";

function countLocalhostInValues(values: (string | null | undefined)[]): number {
  return values.filter((v) => v && isLocalhostUrl(v)).length;
}

async function countLocalhostImages(): Promise<number> {
  const [skus, banners, recItems, categories] = await Promise.all([
    prisma.productSku.findMany({
      where: { imageUrl: { not: null } },
      select: { imageUrl: true },
    }),
    prisma.banner.findMany({ select: { imageUrl: true } }),
    prisma.cmsRecommendationItem.findMany({
      where: { imageOverride: { not: null } },
      select: { imageOverride: true },
    }),
    prisma.productCategory.findMany({
      where: { imageUrl: { not: null } },
      select: { imageUrl: true },
    }),
  ]);

  return (
    countLocalhostInValues(skus.map((s) => s.imageUrl)) +
    countLocalhostInValues(banners.map((b) => b.imageUrl)) +
    countLocalhostInValues(recItems.map((r) => r.imageOverride)) +
    countLocalhostInValues(categories.map((c) => c.imageUrl))
  );
}

export async function gatherSetupChecklistStats(): Promise<SetupChecklistStats> {
  const [
    flowerWikiTotal,
    flowerWikis,
    supplierActiveCount,
    packagingKitActiveCount,
    recipeCount,
    recipes,
    activeProducts,
    homeMainItems,
    sceneSlots,
    homeSceneEntryActiveCount,
    localhostImageCount,
    orderTotalCount,
    paidOrders,
    paidWithoutSnapshot,
    mpProducts,
    categoryCount,
  ] = await Promise.all([
    prisma.flowerWiki.count(),
    prisma.flowerWiki.findMany({
      select: {
        standardUnitCost: true,
        defaultUsableRate: true,
        defaultLossRate: true,
      },
    }),
    prisma.supplier.count({ where: { isActive: true } }),
    prisma.packagingKit.count({ where: { isActive: true } }),
    prisma.recipe.count(),
    prisma.recipe.findMany({
      select: {
        id: true,
        packagingKitId: true,
        _count: { select: { lines: true } },
      },
    }),
    prisma.productSpu.findMany({
      where: { ...activeSpuWhere, isActive: true },
      include: {
        skus: true,
        categories: { select: { id: true } },
      },
    }),
    prisma.cmsRecommendationItem.count({
      where: {
        isActive: true,
        slot: { isActive: true, slotType: RecommendationSlotType.HOME_MAIN },
        product: activeSpuWhere,
      },
    }),
    prisma.cmsRecommendationSlot.findMany({
      where: {
        isActive: true,
        slotType: { in: [RecommendationSlotType.SCENE, RecommendationSlotType.FESTIVAL] },
      },
      include: {
        _count: {
          select: {
            items: {
              where: { isActive: true },
            },
          },
        },
      },
    }),
    prisma.cmsHomeSceneEntry.count({ where: { isActive: true } }),
    countLocalhostImages(),
    prisma.order.count(),
    prisma.order.count({ where: { status: OrderStatus.PAID } }),
    prisma.order.count({
      where: {
        status: OrderStatus.PAID,
        costSnapshot: null,
      },
    }),
    prisma.productSpu.count({
      where: {
        ...activeSpuWhere,
        isActive: true,
        skus: { some: { stock: { gt: 0 } } },
      },
    }),
    prisma.productCategory.count({ where: { isActive: true } }),
  ]);

  const flowerWikiWithCost = flowerWikis.filter(
    (w) => w.standardUnitCost != null && Number(w.standardUnitCost) > 0
  ).length;

  const flowerWikiWithUsableRate = flowerWikis.filter(
    (w) =>
      w.defaultUsableRate != null ||
      w.defaultLossRate != null
  ).length;

  const recipeWithoutLines = recipes.filter((r) => r._count.lines === 0).length;
  const recipeWithoutPackaging = recipes.filter((r) => !r.packagingKitId).length;

  let activeSkuWithoutRecipe = 0;
  let activeSkuWithoutImage = 0;
  let activeProductWithoutSku = 0;
  let activeProductWithoutOccasionTags = 0;
  let activeProductWithoutCategory = 0;

  for (const spu of activeProducts) {
    const skus = spu.skus;
    if (skus.length === 0) activeProductWithoutSku += 1;
    if (!spu.occasionTags?.length) activeProductWithoutOccasionTags += 1;
    if (spu.categories.length === 0) activeProductWithoutCategory += 1;

    for (const sku of skus) {
      if (!sku.recipeId) activeSkuWithoutRecipe += 1;
      const hasImage =
        !!sku.imageUrl?.trim() ||
        skus.some((s) => s.isMainImage && s.imageUrl?.trim());
      if (!hasImage && sku.isMainImage) activeSkuWithoutImage += 1;
    }
  }

  const sceneSlotEmptyCount = sceneSlots.filter((s) => s._count.items === 0).length;

  return {
    flowerWikiTotal,
    flowerWikiWithCost,
    flowerWikiWithUsableRate,
    supplierActiveCount,
    packagingKitActiveCount,
    recipeCount,
    recipeWithoutLines,
    recipeWithoutPackaging,
    activeProductCount: activeProducts.length,
    activeProductWithoutSku,
    activeSkuWithoutRecipe,
    activeSkuWithoutImage,
    activeProductWithoutOccasionTags,
    activeProductWithoutCategory,
    homeMainSlotItemCount: homeMainItems,
    sceneSlotCount: sceneSlots.length,
    sceneSlotEmptyCount,
    homeSceneEntryActiveCount,
    homeSceneUsingFallback: homeSceneEntryActiveCount === 0,
    localhostImageCount,
    orderTotalCount,
    paidOrderCount: paidOrders,
    paidOrderWithoutSnapshot: paidWithoutSnapshot,
    miniprogramProductCount: mpProducts,
    miniprogramCategoryCount: categoryCount,
  };
}

export async function getSetupChecklist(): Promise<SetupChecklistResult> {
  const stats = await gatherSetupChecklistStats();
  return buildSetupChecklist(stats);
}
