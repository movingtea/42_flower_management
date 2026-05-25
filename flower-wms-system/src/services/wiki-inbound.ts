import type { Prisma } from "@/generated/prisma/client";
import { StockLogType } from "@/generated/prisma/enums";
import type { WikiFormPayload } from "@/lib/wiki-constants";
import { mergeAliasMap } from "@/services/wiki";
import { prisma } from "@/lib/prisma";
import { generateUniqueSku } from "@/utils/skuGenerator";

export async function generateBatchNo(tx: Prisma.TransactionClient): Promise<string> {
  const now = new Date();
  const prefix = `B${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`;
  const existingCount = await tx.batch.count({
    where: { batchNo: { startsWith: prefix } },
  });
  for (let attempt = 0; attempt < 20; attempt++) {
    const seq = String((existingCount + 1 + attempt) % 1000).padStart(3, "0");
    const candidate = `${prefix}${seq}`;
    const clash = await tx.batch.findUnique({
      where: { batchNo: candidate },
      select: { id: true },
    });
    if (!clash) return candidate;
  }
  return `${prefix}${String(Math.floor(Math.random() * 1000)).padStart(3, "0")}`;
}

export type WikiInboundPayload = {
  wikiId?: string;
  wikiDraft?: WikiFormPayload & { suggestedAliases?: string[] };
  receivedQty: number;
  unitCost: number;
  supplier?: string;
  safetyStockThreshold?: number;
};

export async function runWikiInboundTransaction(body: WikiInboundPayload) {
  if (!Number.isInteger(body.receivedQty) || body.receivedQty <= 0) {
    throw new Error("入库数量须为正整数");
  }
  if (!Number.isFinite(body.unitCost) || body.unitCost < 0) {
    throw new Error("进货单价无效");
  }

  return prisma.$transaction(async (tx) => {
    let wikiId = body.wikiId;
    let wikiCreated = false;

    if (!wikiId) {
      if (!body.wikiDraft) throw new Error("未命中母表时必须提供 wikiDraft");
      const d = body.wikiDraft;
      const wiki = await tx.flowerWiki.create({
        data: {
          photo: d.photo,
          englishName: d.englishName.trim(),
          chineseName: d.chineseName.trim(),
          colorTags: d.colorTags,
          morphology: d.morphology,
          supplySeason: d.supplySeason,
          floralRole: d.floralRole,
          maintenance: d.maintenance,
          aliasMap: mergeAliasMap(d.aliasMap, d.suggestedAliases ?? []),
        },
      });
      wikiId = wiki.id;
      wikiCreated = true;
    }

    const wiki = await tx.flowerWiki.findUniqueOrThrow({ where: { id: wikiId! } });

    let material = await tx.material.findFirst({ where: { wikiId: wiki.id } });
    let materialCreated = false;

    if (!material) {
      materialCreated = true;
      const materialCode = await generateUniqueSku("material", tx);
      material = await tx.material.create({
        data: {
          materialCode,
          name: wiki.chineseName,
          unit: "支",
          wikiId: wiki.id,
          safetyStockThreshold: body.safetyStockThreshold ?? 20,
        },
      });
    }

    const batchNo = await generateBatchNo(tx);
    const batch = await tx.batch.create({
      data: {
        materialId: material.id,
        batchNo,
        originalQty: body.receivedQty,
        remainingQty: body.receivedQty,
        unitCost: body.unitCost,
        supplier: body.supplier?.trim() || null,
      },
    });

    await tx.stockLog.create({
      data: {
        materialId: material.id,
        batchId: batch.id,
        type: StockLogType.INBOUND,
        delta: body.receivedQty,
        quantity: body.receivedQty,
        remark: wikiCreated ? "AI 双写落库" : "Wiki 撞库入库",
        operator: "system",
      },
    });

    return { wikiCreated, wiki, materialCreated, material, batch };
  });
}
