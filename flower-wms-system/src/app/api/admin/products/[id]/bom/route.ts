import { jsonError, jsonSuccess } from "@/lib/api";
import { getProductBom, saveProductBom } from "@/services/bom-write";

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await ctx.params;
    const lines = await getProductBom(id);
    return jsonSuccess({
      lines: lines.map((l) => ({
        materialId: l.materialId,
        englishName: l.material.wiki?.englishName ?? l.material.name,
        chineseName: l.material.wiki?.chineseName ?? l.material.name,
        quantityNeeded: l.quantityNeeded,
        maintenance: l.material.wiki?.maintenance ?? null,
      })),
    });
  } catch (err) {
    return jsonError(err instanceof Error ? err.message : "加载失败", 500);
  }
}

export async function PUT(
  request: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await ctx.params;
    const body = (await request.json()) as {
      lines?: { englishName: string; quantity: number }[];
    };
    const lines = body.lines ?? [];
    const saved = await saveProductBom(id, lines);
    return jsonSuccess({
      message: "配方已落库",
      count: saved.length,
    });
  } catch (err) {
    return jsonError(err instanceof Error ? err.message : "保存失败", 400);
  }
}
