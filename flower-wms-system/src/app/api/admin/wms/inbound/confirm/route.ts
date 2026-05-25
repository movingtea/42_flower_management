import { jsonError, jsonSuccess } from "@/lib/api";
import { runWikiInboundTransaction } from "@/services/wiki-inbound";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const result = await runWikiInboundTransaction(body);
    return jsonSuccess(
      {
        message: result.wikiCreated ? "双写落库成功" : "入库成功",
        wikiCreated: result.wikiCreated,
        materialCreated: result.materialCreated,
        wiki: {
          id: result.wiki.id,
          englishName: result.wiki.englishName,
          chineseName: result.wiki.chineseName,
          maintenance: result.wiki.maintenance,
        },
        batch: {
          id: result.batch.id,
          batchNo: result.batch.batchNo,
          receivedQty: result.batch.originalQty,
          unitCost: result.batch.unitCost.toString(),
          inboundAt: result.batch.inboundAt,
          supplier: result.batch.supplier,
        },
      },
      201
    );
  } catch (err) {
    return jsonError(err instanceof Error ? err.message : "入库失败", 500);
  }
}
