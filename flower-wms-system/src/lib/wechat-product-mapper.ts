import { buildWechatOperationTags } from "@/lib/cms-product-tags";
import { categoryIdsFromProduct } from "@/lib/product-categories";
import {
  filterActiveSkus,
  formatMinPriceLabel,
  isSpuOutOfStock,
  resolveSpuCardImageUrl,
  resolveSpuMinPrice,
  type ProductSpuWithRelations,
} from "@/lib/product-spu";
import {
  computeSkuStockFlags,
  computeStockSummary,
  resolveDisplayStatus,
  resolveStockStatus,
  type DisplayStatus,
  type StockStatus,
  type StockSummary,
} from "@/services/miniprogram-stock-pure";
import {
  resolveSkuPreorderRule,
  type ResolvedPreorderRule,
} from "@/services/preorder-rule-pure";

export type WechatBulkPreorderRule = {
  enabled: boolean;
  threshold: number | null;
  minLeadDays: number | null;
  message: string | null;
};

export type WechatProductSkuItem = {
  id: string;
  skuCode: string;
  specName: string;
  price: string;
  stock: number;
  hasStock: boolean;
  lowStock: boolean;
  /** 展现用图文（已做 SPU Fallback，SKU 有值时不被覆盖） */
  description: string | null;
  imageUrl: string | null;
  isMainImage: boolean;
  bulkPreorderRule: WechatBulkPreorderRule;
};

function mapSkuBulkPreorderRule(sku: {
  bulkPreorderEnabled?: boolean;
  bulkOrderThreshold?: number | null;
  bulkMinLeadDays?: number | null;
  bulkPreorderMessage?: string | null;
}): WechatBulkPreorderRule {
  const resolved: ResolvedPreorderRule = resolveSkuPreorderRule({
    skuRule: sku,
  });
  return {
    enabled: resolved.enabled,
    threshold: resolved.threshold,
    minLeadDays: resolved.minLeadDays,
    message: resolved.message,
  };
}

export type WechatProductListItem = {
  id: string;
  name: string;
  category: string[];
  description: string | null;
  maintenanceGuide: string | null;
  /** SPU 级主图（主图 SKU 或首个有图 SKU，供 Fallback 与列表封面） */
  mainImageUrl: string;
  imageUrl: string;
  images: string[];
  minPrice: string;
  sellPrice: string;
  priceSuffix: string;
  skuCount: number;
  hasBulkPreorderRule: boolean;
  isOutOfStock: boolean;
  stockSummary: StockSummary;
  stockStatus: StockStatus;
  displayStatus: DisplayStatus;
  shippingFee: number;
  allowPreOrder: boolean;
  productionTime: number;
  skus: WechatProductSkuItem[];
  occasionTags: ReturnType<typeof buildWechatOperationTags>["occasionTags"];
  colorTags: ReturnType<typeof buildWechatOperationTags>["colorTags"];
  styleTags: ReturnType<typeof buildWechatOperationTags>["styleTags"];
  relationshipTags: ReturnType<typeof buildWechatOperationTags>["relationshipTags"];
  budgetTags: ReturnType<typeof buildWechatOperationTags>["budgetTags"];
  positioningTags: ReturnType<typeof buildWechatOperationTags>["positioningTags"];
  sellingPoints: string[];
};

function trimOrNull(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

/** SKU 级展现字段：空则继承 SPU description / mainImageUrl，有值则绝不覆盖 */
export function resolveWechatSkuPresentation(
  sku: { description?: string | null; imageUrl: string | null },
  spuFallback: { description: string | null; mainImageUrl: string }
): Pick<WechatProductSkuItem, "description" | "imageUrl"> {
  const ownDescription = trimOrNull(sku.description ?? null);
  const ownImage = trimOrNull(sku.imageUrl);

  return {
    description: ownDescription ?? spuFallback.description,
    imageUrl: ownImage ?? (spuFallback.mainImageUrl || null),
  };
}

function resolveBannerImagesFromSkus(
  skus: WechatProductSkuItem[]
): string[] {
  const urls: string[] = [];
  const seen = new Set<string>();

  const push = (raw: string | null | undefined) => {
    const u = raw?.trim();
    if (!u || seen.has(u)) return;
    seen.add(u);
    urls.push(u);
  };

  const main = skus.find((s) => s.isMainImage);
  if (main) push(main.imageUrl);

  for (const sku of skus) {
    push(sku.imageUrl);
  }

  return urls;
}

export function mapSpuToWechatListItem(
  spu: ProductSpuWithRelations
): WechatProductListItem {
  const activeSkuRecords = filterActiveSkus(spu.skus);
  const mainImageUrl = resolveSpuCardImageUrl(spu.skus);
  const spuFallback = {
    description: trimOrNull(spu.description),
    mainImageUrl,
  };

  const skus: WechatProductSkuItem[] = activeSkuRecords.map((s) => {
    const presentation = resolveWechatSkuPresentation(s, spuFallback);
    const stockFlags = computeSkuStockFlags(s.stock);
    return {
      id: s.id,
      skuCode: s.skuCode,
      specName: s.specName,
      price: s.price.toString(),
      stock: stockFlags.stock,
      hasStock: stockFlags.hasStock,
      lowStock: stockFlags.lowStock,
      description: presentation.description,
      imageUrl: presentation.imageUrl,
      isMainImage: s.isMainImage,
      bulkPreorderRule: mapSkuBulkPreorderRule(s),
    };
  });
  const stockSummary = computeStockSummary(activeSkuRecords);
  const hasBulkPreorderRule = skus.some((s) => s.bulkPreorderRule.enabled);

  const minPrice = resolveSpuMinPrice(spu.skus);
  const { displayPrice, priceSuffix } = formatMinPriceLabel(
    minPrice,
    skus.length
  );
  const imageUrl = mainImageUrl || skus[0]?.imageUrl || "";
  const bannerImages = resolveBannerImagesFromSkus(skus);
  const operationTags = buildWechatOperationTags(spu);

  return {
    id: spu.id,
    name: spu.name,
    category: categoryIdsFromProduct(spu),
    description: spuFallback.description,
    maintenanceGuide: trimOrNull(spu.maintenanceGuide),
    mainImageUrl: imageUrl,
    imageUrl,
    images: bannerImages.length
      ? bannerImages
      : imageUrl
        ? [imageUrl]
        : [],
    minPrice: displayPrice,
    sellPrice: displayPrice,
    priceSuffix,
    skuCount: skus.length,
    hasBulkPreorderRule,
    isOutOfStock: isSpuOutOfStock(activeSkuRecords),
    stockSummary,
    stockStatus: resolveStockStatus(stockSummary),
    displayStatus: resolveDisplayStatus(spu, activeSkuRecords),
    shippingFee: Number(spu.shippingFee ?? 0),
    allowPreOrder: spu.allowPreOrder,
    productionTime: spu.productionTime,
    skus,
    occasionTags: operationTags.occasionTags,
    colorTags: operationTags.colorTags,
    styleTags: operationTags.styleTags,
    relationshipTags: operationTags.relationshipTags,
    budgetTags: operationTags.budgetTags,
    positioningTags: operationTags.positioningTags,
    sellingPoints: operationTags.sellingPoints,
  };
}

export { resolveBannerImagesFromSkus };
