import { Prisma } from "@/generated/prisma/client";
import { jsonError, jsonSuccess } from "@/lib/api";
import { isResponse, requirePermission } from "@/lib/api-auth";
import {
  GLOBAL_NOTICE_KEY,
  GLOBAL_NOTICE_NAME,
  HOME_POPUP_KEY,
  HOME_POPUP_NAME,
  parseGlobalNoticeValue,
  parseHomePopupValue,
  validateGlobalNotice,
  validateHomePopup,
  type GlobalNoticeConfig,
  type HomePopupConfig,
} from "@/lib/app-marketing";
import {
  CMS_PRODUCT_CATEGORIES_KEY,
  CMS_PRODUCT_CATEGORIES_NAME,
  parseCmsProductCategoriesValue,
  validateCmsProductCategories,
  type LegacyCmsCategoryConfigItem,
} from "@/lib/cms-product-categories";
import { loadAllProductCategoriesFlat } from "@/lib/product-category.server";
import {
  HOME_BANNER_KEY,
  HOME_BANNER_NAME,
  parseHomeBannerValue,
  sortHomeBannerItems,
  validateHomeBannerItems,
  type HomeBannerItem,
} from "@/lib/home-banner";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

function mapPrismaError(err: unknown): { message: string; status: number } {
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === "P2002") return { message: "配置 key 已存在", status: 409 };
  }
  if (err instanceof Error) {
    return { message: err.message, status: 400 };
  }
  return { message: "操作失败", status: 500 };
}

function defaultNameForKey(key: string): string {
  if (key === HOME_BANNER_KEY) return HOME_BANNER_NAME;
  if (key === GLOBAL_NOTICE_KEY) return GLOBAL_NOTICE_NAME;
  if (key === HOME_POPUP_KEY) return HOME_POPUP_NAME;
  if (key === CMS_PRODUCT_CATEGORIES_KEY) return CMS_PRODUCT_CATEGORIES_NAME;
  return key;
}

function parseValueForKey(
  key: string,
  value: unknown
):
  | HomeBannerItem[]
  | GlobalNoticeConfig
  | HomePopupConfig
  | LegacyCmsCategoryConfigItem[] {
  if (key === HOME_BANNER_KEY) return parseHomeBannerValue(value);
  if (key === GLOBAL_NOTICE_KEY) return parseGlobalNoticeValue(value);
  if (key === HOME_POPUP_KEY) return parseHomePopupValue(value);
  if (key === CMS_PRODUCT_CATEGORIES_KEY) {
    return parseCmsProductCategoriesValue(value);
  }
  return value as HomeBannerItem[];
}

/** GET ?key=... */
export async function GET(request: Request) {
  try {
    const staff = await requirePermission("cms:read");
    if (isResponse(staff)) return staff;

    const key = new URL(request.url).searchParams.get("key")?.trim();
    if (!key) {
      return jsonError("请提供 key 查询参数", 400);
    }

    if (key === CMS_PRODUCT_CATEGORIES_KEY) {
      const flat = await loadAllProductCategoriesFlat();
      const value = flat.map((c) => ({
        value: c.id,
        label: c.name,
        sortOrder: c.sortOrder,
      }));
      return jsonSuccess({
        id: null,
        key,
        name: CMS_PRODUCT_CATEGORIES_NAME,
        value,
        updatedAt: null,
      });
    }

    const row = await prisma.appConfig.findUnique({ where: { key } });
    const parsed = parseValueForKey(key, row?.value ?? null);

    return jsonSuccess({
      id: row?.id ?? null,
      key,
      name: row?.name ?? defaultNameForKey(key),
      value: parsed,
      items: key === HOME_BANNER_KEY ? (parsed as HomeBannerItem[]) : undefined,
      updatedAt: row?.updatedAt.toISOString() ?? null,
    });
  } catch (err) {
    const { message, status } = mapPrismaError(err);
    return jsonError(message, status);
  }
}

type PutBody = {
  key: string;
  name?: string;
  value: unknown;
};

function parsePutBody(raw: unknown): PutBody {
  if (!raw || typeof raw !== "object") {
    throw new Error("请求体须为 JSON 对象");
  }
  const b = raw as Record<string, unknown>;
  const key = typeof b.key === "string" ? b.key.trim() : "";
  if (!key) throw new Error("key 不能为空");

  const name =
    typeof b.name === "string" && b.name.trim() ? b.name.trim() : undefined;

  if (!("value" in b)) {
    throw new Error("value 不能为空");
  }

  return { key, name, value: b.value };
}

function normalizePutValue(
  key: string,
  value: unknown
): Prisma.InputJsonValue {
  if (key === HOME_BANNER_KEY) {
    let items = parseHomeBannerValue(value);
    const validationError = validateHomeBannerItems(items);
    if (validationError) throw new Error(validationError);
    items = sortHomeBannerItems(items);
    return items as Prisma.InputJsonValue;
  }

  if (key === GLOBAL_NOTICE_KEY) {
    const notice = parseGlobalNoticeValue(value);
    const validationError = validateGlobalNotice(notice);
    if (validationError) throw new Error(validationError);
    return notice as Prisma.InputJsonValue;
  }

  if (key === HOME_POPUP_KEY) {
    const popup = parseHomePopupValue(value);
    const validationError = validateHomePopup(popup);
    if (validationError) throw new Error(validationError);
    return popup as Prisma.InputJsonValue;
  }

  if (key === CMS_PRODUCT_CATEGORIES_KEY) {
    const validationError = validateCmsProductCategories([]);
    if (validationError) throw new Error(validationError);
    return [] as Prisma.InputJsonValue;
  }

  return value as Prisma.InputJsonValue;
}

/** PUT：按 key 写入或更新配置（upsert） */
export async function PUT(request: Request) {
  try {
    const staff = await requirePermission("cms:write");
    if (isResponse(staff)) return staff;

    const body = parsePutBody(await request.json());
    const jsonValue = normalizePutValue(body.key, body.value);
    const defaultName = defaultNameForKey(body.key);

    const row = await prisma.appConfig.upsert({
      where: { key: body.key },
      create: {
        key: body.key,
        name: body.name ?? defaultName,
        value: jsonValue,
      },
      update: {
        name: body.name ?? defaultName,
        value: jsonValue,
      },
    });

    const parsed = parseValueForKey(body.key, row.value);

    return jsonSuccess({
      message: "配置已保存",
      id: row.id,
      key: row.key,
      name: row.name,
      value: parsed,
      items:
        body.key === HOME_BANNER_KEY
          ? (parsed as HomeBannerItem[])
          : undefined,
      updatedAt: row.updatedAt.toISOString(),
    });
  } catch (err) {
    const { message, status } = mapPrismaError(err);
    return jsonError(message, status);
  }
}
