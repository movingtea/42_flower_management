import type { Prisma } from "@/generated/prisma/client";
import { normalizeStoredImagePath } from "@/lib/image-url";
import { prisma } from "@/lib/prisma";
import { activeSpuWhere } from "@/lib/product-query";

/** 运营 SKU 图文变体白名单：仅允许营销展示字段 */
export type SkuMarketingPatch = {
  description?: string | null;
  imageUrl?: string | null;
};

const BLOCKED_MASS_ASSIGNMENT_KEYS = [
  "recipeId",
  "price",
  "skuCode",
  "spuId",
  "stock",
  "specName",
  "isMainImage",
  "sortOrder",
] as const;

/**
 * 白名单解析：只提取 description / imageUrl，拒绝盲盒式全字段更新。
 */
export function parseSkuMarketingPatch(raw: unknown): SkuMarketingPatch {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("请求体须为 JSON 对象");
  }

  const body = raw as Record<string, unknown>;

  for (const key of BLOCKED_MASS_ASSIGNMENT_KEYS) {
    if (key in body) {
      throw new Error(`不允许通过本接口修改字段：${key}`);
    }
  }

  const patch: SkuMarketingPatch = {};

  if ("description" in body) {
    const value = body.description;
    if (value !== null && typeof value !== "string") {
      throw new Error("description 须为字符串或 null");
    }
    patch.description =
      typeof value === "string" ? value.trim() || null : null;
  }

  if ("imageUrl" in body) {
    const value = body.imageUrl;
    if (value !== null && typeof value !== "string") {
      throw new Error("imageUrl 须为字符串或 null");
    }
    patch.imageUrl =
      typeof value === "string" ? normalizeStoredImagePath(value) : null;
  }

  if (patch.description === undefined && patch.imageUrl === undefined) {
    throw new Error("请至少提供 description 或 imageUrl");
  }

  return patch;
}

function buildWhitelistUpdateData(
  patch: SkuMarketingPatch
): Prisma.ProductSkuUpdateInput {
  const { description, imageUrl } = patch;
  return {
    description: description !== undefined ? description : undefined,
    imageUrl: imageUrl !== undefined ? imageUrl : undefined,
  };
}

/**
 * 仅覆盖 SKU 营销图文字段，绝不触碰 recipeId / price / stock 等供应链列。
 */
export async function updateSkuMarketingOnly(skuId: string, patch: SkuMarketingPatch) {
  const existing = await prisma.productSku.findFirst({
    where: {
      id: skuId,
      spu: activeSpuWhere,
    },
    select: { id: true },
  });

  if (!existing) {
    throw new Error("SKU 不存在或所属商品已删除");
  }

  return prisma.productSku.update({
    where: { id: skuId },
    data: buildWhitelistUpdateData(patch),
    select: {
      id: true,
      skuCode: true,
      specName: true,
      description: true,
      imageUrl: true,
      updatedAt: true,
    },
  });
}
