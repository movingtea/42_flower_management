import {
  MINIPROGRAM_ERROR_CODES,
  MiniprogramBusinessError,
} from "@/lib/miniprogram-business-error";
import {
  cartInvalidReason,
  isCartSpuInvalid,
  type CartClientItem,
  type CartInvalidCode,
  type CartLineResponse,
} from "@/lib/cart";
import { isSpuOutOfStock, productSpuInclude } from "@/lib/product-spu";
import { prisma } from "@/lib/prisma";
import {
  mapCartInvalidReason,
  validateCartQuantity,
} from "@/services/miniprogram-stock-pure";
import { resolveSkuPreorderRule } from "@/services/preorder-rule-pure";

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

function resolveCartLineInvalid(input: {
  spu: {
    isDeleted: boolean;
    isActive: boolean;
    skus: Array<{ id: string; stock: number; specName: string; isActive?: boolean }>;
  } | null;
  item: CartClientItem;
}): { invalid: boolean; code: CartInvalidCode; reason: string | null } {
  const { spu, item } = input;

  if (!spu) {
    return {
      invalid: true,
      code: MINIPROGRAM_ERROR_CODES.PRODUCT_NOT_FOUND,
      reason: mapCartInvalidReason(MINIPROGRAM_ERROR_CODES.PRODUCT_NOT_FOUND),
    };
  }

  if (isCartSpuInvalid(spu)) {
    return {
      invalid: true,
      code: MINIPROGRAM_ERROR_CODES.PRODUCT_OFF_SHELF,
      reason: cartInvalidReason(spu),
    };
  }

  const sku = item.skuId
    ? spu.skus.find((s) => s.id === item.skuId)
    : spu.skus.length === 1
      ? spu.skus[0]
      : undefined;

  if (spu.skus.length > 1 && !sku) {
    return {
      invalid: true,
      code: "SELECT_SPEC",
      reason: mapCartInvalidReason("SELECT_SPEC"),
    };
  }

  if (!sku) {
    return {
      invalid: true,
      code: MINIPROGRAM_ERROR_CODES.SKU_NOT_FOUND,
      reason: mapCartInvalidReason(MINIPROGRAM_ERROR_CODES.SKU_NOT_FOUND),
    };
  }

  if (sku.isActive === false) {
    return {
      invalid: true,
      code: MINIPROGRAM_ERROR_CODES.SKU_INACTIVE,
      reason: mapCartInvalidReason(MINIPROGRAM_ERROR_CODES.SKU_INACTIVE),
    };
  }

  if (sku.stock <= 0) {
    return {
      invalid: true,
      code: MINIPROGRAM_ERROR_CODES.INSUFFICIENT_STOCK,
      reason: `${sku.specName} 卖光啦！`,
    };
  }

  if (sku.stock < item.quantity) {
    return {
      invalid: true,
      code: MINIPROGRAM_ERROR_CODES.INSUFFICIENT_STOCK,
      reason: mapCartInvalidReason(
        MINIPROGRAM_ERROR_CODES.INSUFFICIENT_STOCK,
        `库存不足，当前仅剩 ${sku.stock} 件`
      ),
    };
  }

  return { invalid: false, code: null, reason: null };
}

/** 根据客户端购物车条目查询 SPU/SKU 并计算库存 / 上架状态 */
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
    const spu = spuMap.get(item.productId) ?? null;
    const { invalid, code, reason } = resolveCartLineInvalid({ spu, item });

    const sku = spu
      ? item.skuId
        ? spu.skus.find((s) => s.id === item.skuId)
        : spu.skus.length === 1
          ? spu.skus[0]
          : undefined
      : undefined;

    const displayName = sku
      ? `${spu!.name}（${sku.specName}）`
      : (spu?.name ?? item.productId);

    return {
      productId: item.productId,
      skuId: sku?.id ?? null,
      quantity: item.quantity,
      isInvalid: invalid,
      invalidReason: reason,
      invalidCode: code,
      product: spu
        ? {
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
            bulkPreorderRule: sku
              ? (() => {
                  const resolved = resolveSkuPreorderRule({ skuRule: sku });
                  return {
                    enabled: resolved.enabled,
                    threshold: resolved.threshold,
                    minLeadDays: resolved.minLeadDays,
                    message: resolved.message,
                  };
                })()
              : null,
          }
        : null,
    };
  });
}

export type ValidateCartAddInput = {
  spuId: string;
  skuId: string;
  quantity: number;
  existingItems?: CartClientItem[];
};

export type ValidateCartAddResult = {
  ok: boolean;
  code?: CartInvalidCode;
  message?: string;
  availableStock?: number;
};

/** 加入购物车前服务端校验库存与上架状态 */
export async function validateCartAdd(
  input: ValidateCartAddInput
): Promise<ValidateCartAddResult> {
  const quantity = Math.floor(Number(input.quantity));
  if (!Number.isInteger(quantity) || quantity <= 0) {
    throw new Error("quantity 须为正整数");
  }

  const sku = await prisma.productSku.findUnique({
    where: { id: input.skuId.trim() },
    include: {
      spu: {
        select: {
          id: true,
          name: true,
          isActive: true,
          isDeleted: true,
        },
      },
    },
  });

  if (!sku || sku.spuId !== input.spuId.trim()) {
    return {
      ok: false,
      code: MINIPROGRAM_ERROR_CODES.SKU_NOT_FOUND,
      message: mapCartInvalidReason(MINIPROGRAM_ERROR_CODES.SKU_NOT_FOUND)!,
    };
  }

  if (!sku.spu || sku.spu.isDeleted) {
    return {
      ok: false,
      code: MINIPROGRAM_ERROR_CODES.PRODUCT_NOT_FOUND,
      message: mapCartInvalidReason(MINIPROGRAM_ERROR_CODES.PRODUCT_NOT_FOUND)!,
    };
  }

  if (!sku.spu.isActive) {
    return {
      ok: false,
      code: MINIPROGRAM_ERROR_CODES.PRODUCT_OFF_SHELF,
      message: mapCartInvalidReason(MINIPROGRAM_ERROR_CODES.PRODUCT_OFF_SHELF)!,
    };
  }

  if (sku.isActive === false) {
    return {
      ok: false,
      code: MINIPROGRAM_ERROR_CODES.SKU_INACTIVE,
      message: mapCartInvalidReason(MINIPROGRAM_ERROR_CODES.SKU_INACTIVE)!,
    };
  }

  const existingItems = input.existingItems ?? [];
  const existingQty = existingItems
    .filter((row) => row.skuId === sku.id)
    .reduce((sum, row) => sum + row.quantity, 0);

  const check = validateCartQuantity({
    stock: sku.stock,
    existingQty,
    addQty: quantity,
    specName: sku.specName,
  });

  if (!check.ok) {
    return {
      ok: false,
      code: check.code,
      message: check.message,
      availableStock: check.available,
    };
  }

  return { ok: true, availableStock: sku.stock };
}

export function throwIfCartAddInvalid(result: ValidateCartAddResult): void {
  if (result.ok) return;
  const code =
    result.code && result.code !== "SELECT_SPEC"
      ? result.code
      : MINIPROGRAM_ERROR_CODES.INSUFFICIENT_STOCK;
  throw new MiniprogramBusinessError(code, result.message ?? "库存不足");
}
