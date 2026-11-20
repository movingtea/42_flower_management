import type { MaterialKind } from "@/generated/prisma-v2/client";

/**
 * The V2 material master is one data model (`Material`) with two pages:
 *   - `/v2/materials`  花材母表 — `kind` FLOWER / FOLIAGE
 *   - `/v2/consumables` 耗材母表 — `kind` PACKAGING / CONSUMABLE / OTHER
 *
 * Both pages share the query, table and drawer components in this folder; each
 * route only passes its scope config (kinds + copy) to `MaterialMasterPage`.
 */
export type MaterialScopeId = "flower" | "consumable";

/** Redirect targets a material action is allowed to return to. */
export const MATERIAL_RETURN_TO_PATHS = ["/v2/materials", "/v2/consumables"] as const;

export type MaterialReturnTo = (typeof MATERIAL_RETURN_TO_PATHS)[number];

export const DEFAULT_MATERIAL_RETURN_TO: MaterialReturnTo = "/v2/materials";

/** Server-side allow-list for the hidden `returnTo` field (never trust the form). */
export function isMaterialReturnTo(value: unknown): value is MaterialReturnTo {
  return (
    typeof value === "string" &&
    (MATERIAL_RETURN_TO_PATHS as readonly string[]).includes(value)
  );
}

export const FLOWER_MATERIAL_KINDS = ["FLOWER", "FOLIAGE"] as const;
export const CONSUMABLE_MATERIAL_KINDS = ["PACKAGING", "CONSUMABLE", "OTHER"] as const;

export type MaterialScopeConfig = {
  id: MaterialScopeId;
  basePath: MaterialReturnTo;
  kinds: readonly MaterialKind[];
  title: string;
  description: string;
  /** Flower scopes render the identity/role/knowledge fields; consumables do not. */
  showFlowerFields: boolean;
  create: {
    trigger: string;
    title: string;
    description: string;
    submit: string;
  };
  editTitle: string;
  editDescriptionPrefix: string;
  searchPlaceholder: string;
  footerNote: string;
  empty: { title: string; description: string };
  filteredEmpty: { title: string; description: string };
  countNote: (count: number) => string;
};

export const FLOWER_SCOPE: MaterialScopeConfig = {
  id: "flower",
  basePath: "/v2/materials",
  kinds: FLOWER_MATERIAL_KINDS,
  title: "花材母表",
  description:
    "维护花材与叶材的种类、颜色、商品名、身份、形态、别名、知识资料与库存计量规则；物料名称留空时自动生成，编号由系统自动生成。",
  showFlowerFields: true,
  create: {
    trigger: "新增花材",
    title: "新增花材",
    description: "花材编号由系统自动生成（MAT-日期-随机码），无需手工填写。",
    submit: "保存花材",
  },
  editTitle: "编辑花材",
  editDescriptionPrefix: "花材",
  searchPlaceholder: "搜索编号、名称、英文名、拼音简拼或别名",
  footerNote: "保存后可在列表用「编辑」继续补充知识资料。",
  empty: {
    title: "还没有花材",
    description: "新增第一条花材规格，再补充配方与库存计量规则。",
  },
  filteredEmpty: {
    title: "没有符合条件的花材",
    description: "调整搜索关键词、花材角色、种类、颜色、商品名或分类筛选后再试。",
  },
  countNote: (count) =>
    `共 ${count} 条花材规格。花材按种类 / 颜色 / 商品名三级分类维护，名称留空时自动生成；丝带、胶带、花泥等耗材请到「耗材母表」维护。编号、拼音索引与别名索引由系统维护。`,
};

export const CONSUMABLE_SCOPE: MaterialScopeConfig = {
  id: "consumable",
  basePath: "/v2/consumables",
  kinds: CONSUMABLE_MATERIAL_KINDS,
  title: "耗材母表",
  description:
    "维护包装、耗材与其他非花材物料的类别、规格、库存单位、安全库存、品牌型号与备注；编号由系统自动生成。",
  showFlowerFields: false,
  create: {
    trigger: "新增耗材",
    title: "新增耗材",
    description: "耗材编号由系统自动生成（MAT-日期-随机码），无需手工填写。",
    submit: "保存耗材",
  },
  editTitle: "编辑耗材",
  editDescriptionPrefix: "耗材",
  searchPlaceholder: "搜索编号、名称、品牌或别名",
  footerNote: "保存后可在列表用「编辑」继续补充规格与安全库存。",
  empty: {
    title: "还没有耗材",
    description: "新增第一条包装 / 耗材 / 其他物料规格，再补充库存计量规则。",
  },
  filteredEmpty: {
    title: "没有符合条件的耗材",
    description: "调整搜索关键词、类别或分类筛选后再试。",
  },
  countNote: (count) =>
    `共 ${count} 条耗材规格。丝带、胶带按“卷”管理；花泥按具体规格建物料并使用整数库存。花材请到「花材母表」维护。`,
};
