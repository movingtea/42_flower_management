import { prisma } from "@/lib/prisma";
import { matchFlowerWiki } from "@/services/wiki";
import { generateUniqueSku } from "@/utils/skuGenerator";

export type BomSaveLine = {
  englishName: string;
  quantity: number;
};

export async function resolveMaterialIdByEnglishName(
  englishName: string
): Promise<string> {
  const match = await matchFlowerWiki(englishName);
  if (!match.hit) {
    throw new Error(`未找到母表花材：${englishName}，请先在 Wiki 中维护`);
  }

  let material = await prisma.material.findFirst({
    where: { wikiId: match.wiki.id },
  });

  if (!material) {
    const materialCode = await generateUniqueSku("material");
    material = await prisma.material.create({
      data: {
        materialCode,
        name: match.wiki.chineseName,
        unit: "支",
        wikiId: match.wiki.id,
      },
    });
  }

  return material.id;
}

/** 事务：清空旧 BOM → createMany 新配方 */
export async function saveProductBom(
  spuId: string,
  lines: BomSaveLine[]
) {
  if (lines.length === 0) throw new Error("配方不能为空");

  const resolved: { materialId: string; quantityNeeded: number }[] = [];
  for (const line of lines) {
    if (!Number.isInteger(line.quantity) || line.quantity <= 0) {
      throw new Error(`数量无效：${line.englishName}`);
    }
    const materialId = await resolveMaterialIdByEnglishName(line.englishName);
    resolved.push({ materialId, quantityNeeded: line.quantity });
  }

  const spu = await prisma.productSpu.findUnique({ where: { id: spuId } });
  if (!spu || spu.isDeleted) throw new Error("商品不存在");

  return prisma.$transaction(async (tx) => {
    await tx.productBOM.deleteMany({ where: { spuId } });
    await tx.productBOM.createMany({
      data: resolved.map((r) => ({
        spuId,
        materialId: r.materialId,
        quantityNeeded: r.quantityNeeded,
      })),
    });
    return tx.productBOM.findMany({
      where: { spuId },
      include: {
        material: {
          include: { wiki: true },
        },
      },
    });
  });
}

export async function getProductBom(spuId: string) {
  return prisma.productBOM.findMany({
    where: { spuId },
    include: {
      material: { include: { wiki: true } },
    },
    orderBy: { quantityNeeded: "desc" },
  });
}
