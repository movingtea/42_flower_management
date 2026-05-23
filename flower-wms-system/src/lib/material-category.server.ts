import type { MaterialCategoryRow } from "@/lib/material-category";
import { prisma } from "@/lib/prisma";

function mapRow(row: {
  id: string;
  name: string;
  description: string | null;
  sortOrder: number;
  isActive: boolean;
}): MaterialCategoryRow {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    sortOrder: row.sortOrder,
    isActive: row.isActive,
  };
}

export async function loadMaterialCategories(options?: {
  activeOnly?: boolean;
}): Promise<MaterialCategoryRow[]> {
  const rows = await prisma.materialCategory.findMany({
    where: options?.activeOnly ? { isActive: true } : undefined,
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  });
  return rows.map(mapRow);
}
