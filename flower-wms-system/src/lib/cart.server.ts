import {
  cartInvalidReason,
  isCartSpuInvalid,
  type CartClientItem,
  type CartLineResponse,
} from "@/lib/cart";
import { isSpuOutOfStock, productSpuInclude } from "@/lib/product-spu";
import { prisma } from "@/lib/prisma";

export function parseCartClientItems(raw: unknown): CartClientItem[] {
  if (!Array.isArray(raw)) {
    throw new Error("items 须为数组");
  }

  const items: CartClientItem[] = [];

  for (let i = 0; i < raw.length; i++) {
    const row = raw[i];
    if (!row || typeof row !== "object") {
      throw new Error(`items[${i}] 格式无效`);
    }
    const r = row as Record<string, unknown>;
    const productId =
      typeof r.productId === "string"
        ? r.productId.trim()
        : typeof r.spuId === "string"
          ? r.spuId.trim()
          : typeof r.id === "string"
            ? r.id.trim()
            : "";
    const skuId =
      typeof r.skuId === "string" && r.skuId.trim() ? r.skuId.trim() : undefined;
    const quantity = Number(r.quantity);

    if (!productId) {
      throw new Error(`items[${i}].productId 不能为空`);
    }
    if (!Number.isInteger(quantity) || quantity <= 0) {
      throw new Error(`items[${i}].quantity 须为正整数`);
    }

    items.push({ productId, skuId, quantity });
  }

  return items;
}

/** 根据客户端购物车条目查询 SPU/SKU 并计算 isInvalid */
export async function buildCartLines(
  clientItems: CartClientItem[]
): Promise<CartLineResponse[]> {
  if (clientItems.length === 0) {
    return [];
  }

  const spuIds = [...new Set(clientItems.map((i) => i.productId))];

  const spus = await prisma.productSpu.findMany({
    where: { id: { in: spuIds } },
    include: productSpuInclude,
  });

  const spuMap = new Map(spus.map((s) => [s.id, s]));

  return clientItems.map((item) => {
    const spu = spuMap.get(item.productId);

    if (!spu) {
      return {
        productId: item.productId,
        skuId: item.skuId ?? null,
        quantity: item.quantity,
        isInvalid: true,
        invalidReason: "已下架",
        product: null,
      };
    }

    const sku = item.skuId
      ? spu.skus.find((s) => s.id === item.skuId)
      : spu.skus.length === 1
        ? spu.skus[0]
        : undefined;

    let invalid = isCartSpuInvalid(spu);
    let invalidReasonText: string | null = invalid
      ? cartInvalidReason(spu)
      : null;

    if (!invalid && spu.skus.length > 1 && !sku) {
      invalid = true;
      invalidReasonText = "请选择款式";
    }

    if (!invalid && sku && sku.stock < item.quantity) {
      invalid = true;
      invalidReasonText = "库存不足";
    }

    if (!invalid && isSpuOutOfStock(spu.skus)) {
      invalid = true;
      invalidReasonText = "已下架";
    }

    const displayName = sku
      ? `${spu.name}（${sku.specName}）`
      : spu.name;

    return {
      productId: item.productId,
      skuId: sku?.id ?? null,
      quantity: item.quantity,
      isInvalid: invalid,
      invalidReason: invalidReasonText,
      product: {
        spuId: spu.id,
        skuId: sku?.id ?? null,
        name: displayName,
        specName: sku?.specName ?? null,
        skuCode: sku?.skuCode ?? null,
        sellPrice: sku ? sku.price.toString() : "0",
        imageUrl: sku?.imageUrl ?? null,
        shippingFee: Number(spu.shippingFee ?? 0),
        isDeleted: spu.isDeleted,
        isActive: spu.isActive,
        isOutOfStock: sku ? sku.stock <= 0 : isSpuOutOfStock(spu.skus),
        stock: sku?.stock ?? 0,
      },
    };
  });
}
