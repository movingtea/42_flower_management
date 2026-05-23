import { jsonError, jsonSuccess } from "@/lib/api";
import {
  bannerRowToWriteItem,
  loadActiveBanners,
  syncBannersFromWriteItems,
} from "@/lib/banner.server";
import {
  parseBannerTargetType,
  validateBannerWriteItems,
  type BannerWriteItem,
} from "@/lib/banner";

export const dynamic = "force-dynamic";

function parseWriteItems(raw: unknown): BannerWriteItem[] {
  if (!Array.isArray(raw)) {
    throw new Error("banners 须为数组");
  }

  return raw.map((row, index) => {
    if (!row || typeof row !== "object") {
      throw new Error(`banners[${index}] 格式无效`);
    }
    const r = row as Record<string, unknown>;
    const imageUrl = typeof r.imageUrl === "string" ? r.imageUrl.trim() : "";
    const sortOrder = Number(r.sortOrder ?? r.sort);
    const id = typeof r.id === "string" && r.id.trim() ? r.id.trim() : undefined;

    return {
      id,
      imageUrl,
      sortOrder: Number.isFinite(sortOrder) ? Math.round(sortOrder) : 100,
      targetType: parseBannerTargetType(r.targetType),
      targetParam:
        typeof r.targetParam === "string" ? r.targetParam.trim() : null,
      productId:
        typeof r.productId === "string" ? r.productId.trim() || null : null,
      isActive: r.isActive !== false,
    };
  });
}

/** GET：CMS 轮播列表 */
export async function GET() {
  try {
    const rows = await loadActiveBanners();
    return jsonSuccess({
      banners: rows.map(bannerRowToWriteItem),
      total: rows.length,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "轮播加载失败";
    return jsonError(message, 500);
  }
}

/** PUT：批量保存轮播（全量同步） */
export async function PUT(request: Request) {
  try {
    const body = (await request.json()) as { banners?: unknown };
    const items = parseWriteItems(body.banners ?? []);
    const validationError = validateBannerWriteItems(items);
    if (validationError) {
      return jsonError(validationError, 400);
    }

    const rows = await syncBannersFromWriteItems(items);

    return jsonSuccess({
      message: "轮播已保存",
      banners: rows.map(bannerRowToWriteItem),
      total: rows.length,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "轮播保存失败";
    return jsonError(message, 500);
  }
}
