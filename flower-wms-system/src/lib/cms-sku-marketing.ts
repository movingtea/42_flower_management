import type { Prisma } from "@/generated/prisma/client";
import { normalizeStoredImagePath } from "@/lib/image-url";
import { prisma } from "@/lib/prisma";
import { activeSpuWhere } from "@/lib/product-query";

/** 运营 SKU 白名单字段：营销图文 + 大批量提前预订规则 */
export type SkuMarketingPatch = {
  description?: string | null;
  imageUrl?: string | null;
  bulkPreorderEnabled?: boolean;
  bulkOrderThreshold?: number | null;
  bulkMinLeadDays?: number | null;
  bulkPreorderMessage?: string | null;
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

function parseOptionalPositiveIntField(
  raw: unknown,
  fieldLabel: string
): number | null {
  if (raw === null || raw === undefined || raw === "") return null;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) {
    throw new Error(`${fieldLabel} 须为大于等于 1 的整数`);
  }
  return n;
}

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

  if ("bulkPreorderEnabled" in body) {
    patch.bulkPreorderEnabled = Boolean(body.bulkPreorderEnabled);
  }

  if ("bulkOrderThreshold" in body) {
    patch.bulkOrderThreshold = parseOptionalPositiveIntField(
      body.bulkOrderThreshold,
      "大批量阈值"
    );
  }

  if ("bulkMinLeadDays" in body) {
    patch.bulkMinLeadDays = parseOptionalPositiveIntField(
      body.bulkMinLeadDays,
      "最小提前天数"
    );
  }

  if ("bulkPreorderMessage" in body) {
    const value = body.bulkPreorderMessage;
    if (value !== null && typeof value !== "string") {
      throw new Error("bulkPreorderMessage 须为字符串或 null");
    }
    patch.bulkPreorderMessage =
      typeof value === "string" ? value.trim() || null : null;
  }

  if (
    patch.description === undefined &&
    patch.imageUrl === undefined &&
    patch.bulkPreorderEnabled === undefined &&
    patch.bulkOrderThreshold === undefined &&
    patch.bulkMinLeadDays === undefined &&
    patch.bulkPreorderMessage === undefined
  ) {
    throw new Error("请至少提供一个允许更新的字段");
  }

  return patch;
}

function buildWhitelistUpdateData(
  patch: SkuMarketingPatch
): Prisma.ProductSkuUpdateInput {
  const {
    description,
    imageUrl,
    bulkPreorderEnabled,
    bulkOrderThreshold,
    bulkMinLeadDays,
    bulkPreorderMessage,
  } = patch;
  return {
    description: description !== undefined ? description : undefined,
    imageUrl: imageUrl !== undefined ? imageUrl : undefined,
    bulkPreorderEnabled:
      bulkPreorderEnabled !== undefined ? bulkPreorderEnabled : undefined,
    bulkOrderThreshold:
      bulkOrderThreshold !== undefined ? bulkOrderThreshold : undefined,
    bulkMinLeadDays:
      bulkMinLeadDays !== undefined ? bulkMinLeadDays : undefined,
    bulkPreorderMessage:
      bulkPreorderMessage !== undefined ? bulkPreorderMessage : undefined,
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
      bulkPreorderEnabled: true,
      bulkOrderThreshold: true,
      bulkMinLeadDays: true,
      bulkPreorderMessage: true,
      updatedAt: true,
    },
  });
}
