import { FloralRole } from "@/generated/prisma/enums";
import type { WikiCareRow } from "@/lib/wiki-care";

/** 角色枚举 → 中文展示 */
export const FLORAL_ROLE_LABEL: Record<FloralRole, string> = {
  [FloralRole.MAIN]: "主花",
  [FloralRole.FILLER]: "配花",
  [FloralRole.LINE]: "线条花",
  [FloralRole.FOLIAGE]: "叶材",
};

export const FLORAL_ROLE_FROM_ZH: Record<string, FloralRole> = {
  主花: FloralRole.MAIN,
  配花: FloralRole.FILLER,
  线条花: FloralRole.LINE,
  叶材: FloralRole.FOLIAGE,
};

export const WIKI_ROLES = Object.values(FLORAL_ROLE_LABEL);

export function parseFloralRole(raw: unknown): FloralRole {
  if (typeof raw === "string") {
    if (raw in FLORAL_ROLE_FROM_ZH) return FLORAL_ROLE_FROM_ZH[raw];
    if (Object.values(FloralRole).includes(raw as FloralRole)) {
      return raw as FloralRole;
    }
  }
  return FloralRole.FILLER;
}

export type WikiFormPayload = {
  photo?: string | null;
  englishName: string;
  chineseName: string;
  colorTags: string[];
  morphology?: string | null;
  supplySeason?: string | null;
  floralRole: FloralRole;
  flowerLanguage?: string | null;
  maintenance: string;
  careTable?: WikiCareRow[] | null;
  aliasMap?: Record<string, string[]>;
  /** 默认保质期（天）；null 表示不设自动到期 */
  defaultShelfLifeDays?: number | null;
  /** 标准单支成本，仅用于产品定价预估 */
  standardUnitCost?: string | null;
  costUnit?: string | null;
  costNote?: string | null;
};

export type WikiListItem = {
  id: string;
  photo: string | null;
  englishName: string;
  chineseName: string;
  name: string;
  pinyinIndex: string;
  colorTags: string[];
  color: string;
  morphology: string | null;
  texture: string;
  supplySeason: string | null;
  availability: string;
  floralRole: FloralRole;
  role: string;
  flowerLanguage: string | null;
  maintenance: string;
  careTable: WikiCareRow[] | null;
  aliasMap: Record<string, string[]>;
  defaultShelfLifeDays: number | null;
  standardUnitCost: string | null;
  costUnit: string | null;
  costUpdatedAt: string | null;
  costNote: string | null;
  createdAt: string;
  updatedAt: string;
};

export type WikiAiFields = {
  englishName: string;
  chineseName: string;
  colorTags: string[];
  morphology: string;
  supplySeason: string;
  floralRole: FloralRole;
  flowerLanguage: string;
  maintenance: string;
  suggestedAliases: string[];
};

export type BouquetDraftLine = {
  key: string;
  englishName: string;
  chineseName: string;
  quantity: number;
  floralRole?: FloralRole;
};

export const WIKI_MAINTENANCE_TEMPLATE =
  "① 到货醒花：\n② 修剪处理：\n③ 日常维护：";

export const EMPTY_WIKI_FORM: WikiFormPayload = {
  photo: "",
  englishName: "",
  chineseName: "",
  colorTags: [],
  morphology: "",
  supplySeason: "",
  floralRole: FloralRole.MAIN,
  flowerLanguage: "",
  maintenance: WIKI_MAINTENANCE_TEMPLATE,
  aliasMap: { zh: [] },
  defaultShelfLifeDays: null,
  standardUnitCost: null,
  costUnit: "支",
  costNote: null,
};

export function roleBadgeClass(role: FloralRole): string {
  switch (role) {
    case FloralRole.MAIN:
      return "bg-rose-100 text-rose-800";
    case FloralRole.FILLER:
      return "bg-sky-100 text-sky-800";
    case FloralRole.LINE:
      return "bg-violet-100 text-violet-800";
    case FloralRole.FOLIAGE:
      return "bg-emerald-100 text-emerald-800";
    default:
      return "bg-zinc-100 text-zinc-700";
  }
}
