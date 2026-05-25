import type { FlowerWiki } from "@/generated/prisma/client";

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
    colorTags: row.colorTags,
    morphology: row.morphology,
    supplySeason: row.supplySeason,
    floralRole: row.floralRole,
    maintenance: row.maintenance,
    aliasMap,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
