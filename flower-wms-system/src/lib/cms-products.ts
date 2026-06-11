import type { CmsProductCategoryItem } from "@/lib/cms-product-categories";
import { normalizeStoredImagePath } from "@/lib/image-url";
import {
  parseCmsProductTagKeys,
  parseSellingPoints,
} from "@/lib/cms-product-tags";
import { parseOccasionTags } from "@/lib/crm-tags";
import {
  cmsCategoryIdSet,
  parseProductCategoryPayload,
} from "@/lib/cms-product-categories";

const SHIPPING_FEE_PATTERN = /^[0-9]+(\.[0-9]{1,2})?$/;

export function parseShippingFeeValue(
  raw: unknown,
  needsShipping: boolean
): number {
  if (!needsShipping) {
    return 0;
  }

  const text =
    typeof raw === "number"
      ? String(raw)
      : typeof raw === "string"
        ? raw.trim()
        : "";

  if (!text) {
    throw new Error("开启运费时须填写运费金额");
  }

  if (!SHIPPING_FEE_PATTERN.test(text)) {
    throw new Error("请输入正确的运费金额，最多支持两位小数");
  }

  const amount = Number(text);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error("运费金额须为正数");
  }

  return amount;
}

export type CmsProductSkuInput = {
  id?: string;
  skuCode?: string;
  specName: string;
  price: number;
  stock: number;
  imageUrl: string | null;
  isMainImage: boolean;
  isActive?: boolean;
  sortOrder?: number;
  recipeId?: string | null;
  bulkPreorderEnabled?: boolean;
  bulkOrderThreshold?: number | null;
  bulkMinLeadDays?: number | null;
  bulkPreorderMessage?: string | null;
};

function parseOptionalPositiveInt(
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

function parseBulkPreorderSkuFields(
  r: Record<string, unknown>
): Pick<
  CmsProductSkuInput,
  | "bulkPreorderEnabled"
  | "bulkOrderThreshold"
  | "bulkMinLeadDays"
  | "bulkPreorderMessage"
> {
  const bulkPreorderEnabled = Boolean(r.bulkPreorderEnabled);
  const bulkOrderThreshold = parseOptionalPositiveInt(
    r.bulkOrderThreshold,
    "大批量阈值"
  );
  const bulkMinLeadDays = parseOptionalPositiveInt(
    r.bulkMinLeadDays,
    "最小提前天数"
  );
  const bulkPreorderMessage =
    typeof r.bulkPreorderMessage === "string"
      ? r.bulkPreorderMessage.trim() || null
      : r.bulkPreorderMessage === null
        ? null
        : undefined;

  return {
    bulkPreorderEnabled,
    bulkOrderThreshold,
    bulkMinLeadDays,
    bulkPreorderMessage:
      bulkPreorderMessage === undefined ? null : bulkPreorderMessage,
  };
}

export type CmsProductBody = {
  name: string;
  category: string[];
  occasionTags?: string[];
  colorTags?: string[];
  styleTags?: string[];
  relationshipTags?: string[];
  budgetTags?: string[];
  positioningTags?: string[];
  sellingPoints?: string[];
  operationNote?: string | null;
  description?: string | null;
  maintenanceGuide?: string | null;
  isActive: boolean;
  needsShipping: boolean;
  shippingFee: number;
  allowPreOrder?: boolean;
  productionTime?: number;
  skus: CmsProductSkuInput[];
};

function parseSkuRows(raw: unknown): CmsProductSkuInput[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new Error("请至少添加一个商品款式");
  }

  const rows: CmsProductSkuInput[] = [];

  for (let i = 0; i < raw.length; i++) {
    const row = raw[i];
    if (!row || typeof row !== "object") {
      throw new Error(`款式第 ${i + 1} 行格式无效`);
    }
    const r = row as Record<string, unknown>;
    const specName = typeof r.specName === "string" ? r.specName.trim() : "";
    if (!specName) {
      throw new Error(`款式第 ${i + 1} 行须填写款式品名`);
    }

    const price = Number(r.price);
    if (!Number.isFinite(price) || price < 0) {
      throw new Error(`款式第 ${i + 1} 行价格无效`);
    }

    const stock = Number(r.stock ?? 0);
    if (!Number.isInteger(stock) || stock < 0) {
      throw new Error(`款式第 ${i + 1} 行库存须为非负整数`);
    }

    const imageUrl = normalizeStoredImagePath(
      typeof r.imageUrl === "string" ? r.imageUrl : null
    );

    const recipeId =
      typeof r.recipeId === "string" && r.recipeId.trim()
        ? r.recipeId.trim()
        : null;

    rows.push({
      id: typeof r.id === "string" && r.id.trim() ? r.id.trim() : undefined,
      skuCode:
        typeof r.skuCode === "string" && r.skuCode.trim()
          ? r.skuCode.trim()
          : undefined,
      specName,
      price,
      stock,
      imageUrl,
      isMainImage: Boolean(r.isMainImage),
      isActive: r.isActive === false ? false : true,
      sortOrder: Number.isFinite(Number(r.sortOrder))
        ? Math.round(Number(r.sortOrder))
        : i * 10,
      recipeId,
      ...parseBulkPreorderSkuFields(r),
    });
  }

  const mainCount = rows.filter((r) => r.isMainImage).length;
  if (mainCount === 0) {
    rows[0].isMainImage = true;
  } else if (mainCount > 1) {
    let picked = false;
    for (const row of rows) {
      if (row.isMainImage && !picked) {
        picked = true;
      } else {
        row.isMainImage = false;
      }
    }
  }

  return rows;
}

export function parseCmsProductBody(
  raw: unknown,
  categoryConfig: CmsProductCategoryItem[]
): CmsProductBody {
  if (!raw || typeof raw !== "object") {
    throw new Error("请求体须为 JSON 对象");
  }

  const b = raw as Record<string, unknown>;
  const name = typeof b.name === "string" ? b.name.trim() : "";
  if (!name) throw new Error("name 不能为空");

  const allowed = cmsCategoryIdSet(categoryConfig);
  const rawCategoryIds =
    b.categoryIds !== undefined ? b.categoryIds : b.category;
  const category = parseProductCategoryPayload(rawCategoryIds, allowed);

  const skus = parseSkuRows(b.skus);

  // 兼容旧版请求体：顶层 recipeId 下沉到尚未指定配方的 SKU
  const legacyRecipeId =
    typeof b.recipeId === "string" && b.recipeId.trim()
      ? b.recipeId.trim()
      : null;
  if (legacyRecipeId) {
    for (const sku of skus) {
      if (!sku.recipeId) sku.recipeId = legacyRecipeId;
    }
  }

  const productionTime = Number(b.productionTime ?? 30);
  if (!Number.isInteger(productionTime) || productionTime < 0) {
    throw new Error("productionTime 须为非负整数");
  }

  const needsShipping = Boolean(b.needsShipping);
  const shippingFee = parseShippingFeeValue(b.shippingFee, needsShipping);

  return {
    name,
    category,
    occasionTags:
      b.occasionTags !== undefined
        ? parseCmsProductTagKeys("occasion", b.occasionTags)
        : parseOccasionTags(b.occasionTags),
    colorTags:
      b.colorTags !== undefined
        ? parseCmsProductTagKeys("color", b.colorTags)
        : undefined,
    styleTags:
      b.styleTags !== undefined
        ? parseCmsProductTagKeys("style", b.styleTags)
        : undefined,
    relationshipTags:
      b.relationshipTags !== undefined
        ? parseCmsProductTagKeys("relationship", b.relationshipTags)
        : undefined,
    budgetTags:
      b.budgetTags !== undefined
        ? parseCmsProductTagKeys("budget", b.budgetTags)
        : undefined,
    positioningTags:
      b.positioningTags !== undefined
        ? parseCmsProductTagKeys("positioning", b.positioningTags)
        : undefined,
    sellingPoints:
      b.sellingPoints !== undefined
        ? parseSellingPoints(b.sellingPoints)
        : undefined,
    operationNote:
      b.operationNote !== undefined
        ? typeof b.operationNote === "string"
          ? b.operationNote.trim() || null
          : null
        : undefined,
    description:
      typeof b.description === "string" ? b.description.trim() || null : null,
    maintenanceGuide:
      typeof b.maintenanceGuide === "string"
        ? b.maintenanceGuide.trim() || null
        : typeof b.careTips === "string"
          ? b.careTips.trim() || null
          : null,
    isActive: Boolean(b.isActive),
    allowPreOrder: b.allowPreOrder !== false,
    productionTime,
    needsShipping,
    shippingFee,
    skus,
  };
}

/** 校验请求体中各 SKU 所引用的配方均存在 */
export async function assertSkuRecipesExist(
  skus: CmsProductSkuInput[],
  assertRecipeExists: (recipeId: string) => Promise<void>
): Promise<void> {
  const ids = [
    ...new Set(
      skus
        .map((s) => s.recipeId)
        .filter((id): id is string => Boolean(id))
    ),
  ];
  for (const id of ids) {
    await assertRecipeExists(id);
  }
}
