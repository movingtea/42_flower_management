import { FloralRole } from "@/generated/prisma/enums";

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
  maintenance: string;
  aliasMap?: Record<string, string[]>;
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
  maintenance: string;
  aliasMap: Record<string, string[]>;
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
  maintenance: WIKI_MAINTENANCE_TEMPLATE,
  aliasMap: { zh: [] },
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
