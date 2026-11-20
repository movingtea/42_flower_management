import type { MaterialKind } from "@/generated/prisma-v2/client";
import type { MaterialCategoryOption } from "../MaterialKnowledgeEditor";

export type DecimalLike = { toString(): string } | string | null | undefined;

/** Category option shape shared by the drawer editor and the page queries. */
export type { MaterialCategoryOption };

/**
 * Row payload rendered by both the flower (`/v2/materials`) and consumable
 * (`/v2/consumables`) masters. Both pages query the same `Material` model; only
 * the `kind` scope and the visible copy/fields differ.
 */
export type MaterialRow = {
  id: string;
  code: string;
  name: string;
  kind: MaterialKind;
  active: boolean;
  color: string | null;
  flowerVariety: string | null;
  flowerProductName: string | null;
  floralRole: string | null;
  colorTags: string[];
  pinyinIndex: string;
  aliasText: string;
  aliasMap: unknown;
  morphology: string | null;
  grade: string | null;
  gradeSpecification: string | null;
  specification: string | null;
  baseUnit: string;
  quantityScale: number;
  reservePerOrder: boolean;
  englishName: string | null;
  flowerLanguage: string | null;
  maintenance: string | null;
  maintenanceCare: unknown;
  supplySeason: string | null;
  defaultShelfLifeDays: number | null;
  standardUnitCost: DecimalLike;
  costUnit: string | null;
  costNote: string | null;
  costUpdatedAt: Date | null;
  optimisticUsableRate: DecimalLike;
  standardUsableRate: DecimalLike;
  conservativeUsableRate: DecimalLike;
  defaultUsableRate: DecimalLike;
  defaultLossRate: DecimalLike;
  lossMode: string;
  lossRateUpdatedAt: Date | null;
  lossRateNote: string | null;
  brand: string | null;
  model: string | null;
  notes: string | null;
  imageKey: string | null;
  safetyStockThreshold: { toString(): string };
  categories: Array<{
    categoryId: string;
    category: { id: string; name: string; active: boolean };
  }>;
};
