import { categoryIdsFromProduct } from "@/lib/product-categories";
import {
  formatMinPriceLabel,
  isSpuOutOfStock,
  resolveSpuCardImageUrl,
  resolveSpuMinPrice,
  type ProductSpuWithRelations,
} from "@/lib/product-spu";

export type WechatProductListItem = {
  id: string;
  name: string;
  category: string[];
  description: string | null;
  maintenanceGuide: string | null;
  imageUrl: string;
  images: string[];
  minPrice: string;
  sellPrice: string;
  priceSuffix: string;
  skuCount: number;
  isOutOfStock: boolean;
  shippingFee: number;
  allowPreOrder: boolean;
  productionTime: number;
  skus: Array<{
    id: string;
    skuCode: string;
    specName: string;
    price: string;
    stock: number;
    imageUrl: string | null;
    isMainImage: boolean;
  }>;
};

export function mapSpuToWechatListItem(
  spu: ProductSpuWithRelations
): WechatProductListItem {
  const skus = spu.skus.map((s) => ({
    id: s.id,
    skuCode: s.skuCode,
    specName: s.specName,
    price: s.price.toString(),
    stock: s.stock,
    imageUrl: s.imageUrl,
    isMainImage: s.isMainImage,
  }));

  const minPrice = resolveSpuMinPrice(spu.skus);
  const { displayPrice, priceSuffix } = formatMinPriceLabel(
    minPrice,
    skus.length
  );
  const imageUrl = resolveSpuCardImageUrl(spu.skus);

  return {
    id: spu.id,
    name: spu.name,
    category: categoryIdsFromProduct(spu),
    description: spu.description,
    maintenanceGuide: spu.maintenanceGuide,
    imageUrl,
    images: imageUrl ? [imageUrl] : [],
    minPrice: displayPrice,
    sellPrice: displayPrice,
    priceSuffix,
    skuCount: skus.length,
    isOutOfStock: isSpuOutOfStock(spu.skus),
    shippingFee: Number(spu.shippingFee ?? 0),
    allowPreOrder: spu.allowPreOrder,
    productionTime: spu.productionTime,
    skus,
  };
}
