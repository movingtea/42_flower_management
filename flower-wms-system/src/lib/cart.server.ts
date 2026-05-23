import {
  cartInvalidReason,
  isCartProductInvalid,
  type CartClientItem,
  type CartLineResponse,
} from "@/lib/cart";
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
        : typeof r.id === "string"
          ? r.id.trim()
          : "";
    const quantity = Number(r.quantity);

    if (!productId) {
      throw new Error(`items[${i}].productId 不能为空`);
    }
    if (!Number.isInteger(quantity) || quantity <= 0) {
      throw new Error(`items[${i}].quantity 须为正整数`);
    }

    items.push({ productId, quantity });
  }

  return items;
}

/** 根据客户端购物车条目查询商品并计算 isInvalid */
export async function buildCartLines(
  clientItems: CartClientItem[]
): Promise<CartLineResponse[]> {
  if (clientItems.length === 0) {
    return [];
  }

  const productIds = [...new Set(clientItems.map((i) => i.productId))];

  const products = await prisma.product.findMany({
    where: { id: { in: productIds } },
    select: {
      id: true,
      name: true,
      sku: true,
      price: true,
      images: true,
      shippingFee: true,
      status: true,
      isDeleted: true,
      isOutOfStock: true,
      quantity: true,
    },
  });

  const productMap = new Map(products.map((p) => [p.id, p]));

  return clientItems.map((item) => {
    const product = productMap.get(item.productId);

    if (!product) {
      return {
        productId: item.productId,
        quantity: item.quantity,
        isInvalid: true,
        invalidReason: "已下架",
        product: null,
      };
    }

    const invalid = isCartProductInvalid(product);

    return {
      productId: item.productId,
      quantity: item.quantity,
      isInvalid: invalid,
      invalidReason: invalid ? cartInvalidReason(product) : null,
      product: {
        id: product.id,
        name: product.name,
        sku: product.sku,
        sellPrice: product.price.toString(),
        imageUrl: product.images[0] ?? null,
        shippingFee: Number(product.shippingFee ?? 0),
        status: product.status,
        isDeleted: product.isDeleted,
        isOutOfStock: product.isOutOfStock,
        quantity: product.quantity,
      },
    };
  });
}
