import type { Prisma } from "@/generated/prisma/client";
import type { CmsProductBody } from "@/lib/cms-products";
import { cmsBodyToSpuData } from "@/lib/cms-product-mapper";
import { generateUniqueSku } from "@/utils/skuGenerator";

export function cmsSpuCreateData(
  body: CmsProductBody
): Prisma.ProductSpuUncheckedCreateInput {
  return cmsBodyToSpuData(body);
}

export function cmsSpuUpdateData(
  body: CmsProductBody
): Prisma.ProductSpuUncheckedUpdateInput {
  return cmsBodyToSpuData(body);
}

export async function buildSkuCreateRows(
  body: CmsProductBody,
  spuId: string,
  tx?: Prisma.TransactionClient
): Promise<Prisma.ProductSkuCreateManyInput[]> {
  const rows: Prisma.ProductSkuCreateManyInput[] = [];

  for (let i = 0; i < body.skus.length; i++) {
    const row = body.skus[i];
    const skuCode =
      row.skuCode?.trim() || (await generateUniqueSku("productSku", tx));

    rows.push({
      spuId,
      skuCode,
      specName: row.specName,
      price: row.price,
      stock: row.stock,
      imageUrl: row.imageUrl,
      isMainImage: row.isMainImage,
      isActive: row.isActive !== false,
      sortOrder: row.sortOrder ?? i * 10,
      recipeId: row.recipeId ?? null,
      bulkPreorderEnabled: row.bulkPreorderEnabled ?? false,
      bulkOrderThreshold: row.bulkOrderThreshold ?? null,
      bulkMinLeadDays: row.bulkMinLeadDays ?? null,
      bulkPreorderMessage: row.bulkPreorderMessage ?? null,
    });
  }

  return rows;
}

export async function syncProductSkus(
  spuId: string,
  body: CmsProductBody,
  tx: Prisma.TransactionClient
): Promise<void> {
  const existing = await tx.productSku.findMany({
    where: { spuId },
    select: { id: true },
  });
  const existingIds = new Set(existing.map((r) => r.id));
  const payloadIds = new Set(
    body.skus.map((s) => s.id).filter((id): id is string => Boolean(id))
  );

  const toDelete = [...existingIds].filter((id) => !payloadIds.has(id));
  if (toDelete.length > 0) {
    await tx.productSku.deleteMany({ where: { id: { in: toDelete } } });
  }

  for (let i = 0; i < body.skus.length; i++) {
    const row = body.skus[i];
    const data = {
      specName: row.specName,
      price: row.price,
      stock: row.stock,
      imageUrl: row.imageUrl,
      isMainImage: row.isMainImage,
      isActive: row.isActive !== false,
      sortOrder: row.sortOrder ?? i * 10,
      recipeId: row.recipeId ?? null,
      bulkPreorderEnabled: row.bulkPreorderEnabled ?? false,
      bulkOrderThreshold: row.bulkOrderThreshold ?? null,
      bulkMinLeadDays: row.bulkMinLeadDays ?? null,
      bulkPreorderMessage: row.bulkPreorderMessage ?? null,
    };

    if (row.id && existingIds.has(row.id)) {
      await tx.productSku.update({
        where: { id: row.id },
        data,
      });
    } else {
      const skuCode =
        row.skuCode?.trim() || (await generateUniqueSku("productSku", tx));
      await tx.productSku.create({
        data: {
          spuId,
          skuCode,
          ...data,
        },
      });
    }
  }
}
