import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";

type Tx = Prisma.TransactionClient | typeof prisma;

export async function ensureMaterialCategoryIds(
  ids: string[],
  options?: { tx?: Tx }
): Promise<string[]> {
  const client = options?.tx ?? prisma;
  const unique = [...new Set(ids.map((id) => id.trim()).filter(Boolean))];

  if (unique.length === 0) {
    throw new Error("请至少选择一个原材料分类");
  }

  const found = await client.materialCategory.findMany({
    where: { id: { in: unique } },
    select: { id: true },
  });

  if (found.length !== unique.length) {
    const foundSet = new Set(found.map((r) => r.id));
    const missing = unique.filter((id) => !foundSet.has(id));
    throw new Error(`原材料分类不存在：${missing.join(", ")}`);
  }

  return unique;
}

/** 替换原材料与分类的多对多关联 */
export async function syncMaterialCategoryLinks(
  materialId: string,
  categoryIds: string[],
  options?: { tx?: Tx }
): Promise<void> {
  const client = options?.tx ?? prisma;
  const ids = await ensureMaterialCategoryIds(categoryIds, { tx: options?.tx });

  await client.materialCategoryRelation.deleteMany({ where: { materialId } });

  if (ids.length === 0) return;

  await client.materialCategoryRelation.createMany({
    data: ids.map((materialCategoryId) => ({
      materialId,
      materialCategoryId,
    })),
    skipDuplicates: true,
  });
}

export async function materialCategoryIdsFromMaterial(
  materialId: string,
  options?: { tx?: Tx }
): Promise<string[]> {
  const client = options?.tx ?? prisma;
  const rows = await client.materialCategoryRelation.findMany({
    where: { materialId },
    select: { materialCategoryId: true },
  });
  return rows.map((r) => r.materialCategoryId);
}
