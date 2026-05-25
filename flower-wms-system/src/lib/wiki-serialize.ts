import type { FlowerWiki } from "@/generated/prisma/client";
import { FLORAL_ROLE_LABEL } from "@/lib/wiki-constants";

export function serializeWiki(row: FlowerWiki) {
  const aliasMap =
    row.aliasMap && typeof row.aliasMap === "object"
      ? (row.aliasMap as Record<string, string[]>)
      : {};

  return {
    id: row.id,
    photo: row.photo,
    englishName: row.englishName,
    chineseName: row.chineseName,
    /** UI 别名：中文常用名 */
    name: row.chineseName,
    pinyinIndex: row.pinyinIndex,
    colorTags: row.colorTags,
    /** UI 别名：主色系（取首个标签） */
    color: row.colorTags[0] ?? "",
    morphology: row.morphology,
    /** UI 别名：形态特征 */
    texture: row.morphology ?? "",
    supplySeason: row.supplySeason,
    /** UI 别名：供货周期 */
    availability: row.supplySeason ?? "",
    floralRole: row.floralRole,
    /** UI 别名：花艺角色中文 */
    role: FLORAL_ROLE_LABEL[row.floralRole],
    maintenance: row.maintenance,
    aliasMap,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
