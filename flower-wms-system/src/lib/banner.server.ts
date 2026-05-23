import { BannerTargetType } from "@/generated/prisma/enums";
import type { Prisma } from "@/generated/prisma/client";
import {
  HOME_BANNER_KEY,
  parseHomeBannerValue,
  type HomeBannerItem,
} from "@/lib/home-banner";
import {
  parseBannerTargetType,
  type BannerWriteItem,
  type WechatBannerPayload,
} from "@/lib/banner";
import { activeSpuWhere } from "@/lib/product-query";
import {
  productSpuInclude,
  resolveSpuCardImageUrl,
  resolveSpuMinPrice,
} from "@/lib/product-spu";
import { prisma } from "@/lib/prisma";

export type BannerRow = {
  id: string;
  imageUrl: string;
  sortOrder: number;
  targetType: BannerTargetType;
  targetParam: string | null;
  productId: string | null;
  isActive: boolean;
  spu?: {
    id: string;
    name: string;
    isDeleted: boolean;
    isActive: boolean;
  } | null;
};

/** 从旧 AppConfig JSON 迁移到 banners 表（仅当表为空时执行一次） */
export async function migrateBannersFromAppConfigIfEmpty(): Promise<number> {
  const count = await prisma.banner.count();
  if (count > 0) return 0;

  const row = await prisma.appConfig.findUnique({
    where: { key: HOME_BANNER_KEY },
  });
  const legacy = parseHomeBannerValue(row?.value ?? []);
  if (legacy.length === 0) return 0;

  await prisma.banner.createMany({
    data: legacy.map((item) => ({
      id: item.id,
      imageUrl: item.imageUrl,
      sortOrder: item.sort,
      targetType: BannerTargetType.PRODUCT,
      targetParam: null,
      productId: item.productId,
      isActive: true,
    })),
    skipDuplicates: true,
  });

  return legacy.length;
}

export async function loadActiveBanners(): Promise<BannerRow[]> {
  await migrateBannersFromAppConfigIfEmpty();

  return prisma.banner.findMany({
    where: { isActive: true },
    orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
    include: {
      spu: {
        select: {
          id: true,
          name: true,
          isDeleted: true,
          isActive: true,
        },
      },
    },
  });
}

export function bannerRowToWriteItem(row: BannerRow): BannerWriteItem & { id: string } {
  return {
    id: row.id,
    imageUrl: row.imageUrl,
    sortOrder: row.sortOrder,
    targetType: parseBannerTargetType(row.targetType),
    targetParam: row.targetParam,
    productId: row.productId,
    isActive: row.isActive,
  };
}

type ProductPick = {
  id: string;
  name: string;
  sku: string;
  price: { toString(): string };
  images: string[];
};

/** 小程序轮播 payload：软删除商品自动降级为 NONE */
export function resolveWechatBanners(
  rows: BannerRow[],
  productMap: Map<string, ProductPick>
): WechatBannerPayload[] {
  const out: WechatBannerPayload[] = [];

  for (const row of rows) {
    let targetType = parseBannerTargetType(row.targetType);
    let targetParam = row.targetParam?.trim() || null;
    let productId = row.productId;

    let productPayload: WechatBannerPayload["product"] = null;

    if (targetType === "PRODUCT" && productId) {
      const p = productMap.get(productId);
      const productInvalid =
        !p ||
        row.spu?.isDeleted === true ||
        row.spu?.isActive !== true;

      if (productInvalid) {
        targetType = "NONE";
        targetParam = null;
        productId = null;
      } else {
        productPayload = {
          id: p.id,
          name: p.name,
          sku: p.sku,
          sellPrice: p.price.toString(),
          imageUrl: p.images[0] ?? null,
          images: p.images,
        };
      }
    }

    out.push({
      id: row.id,
      imageUrl: row.imageUrl,
      sort: row.sortOrder,
      targetType,
      targetParam,
      productId,
      product: productPayload,
    });
  }

  return out;
}

export async function loadWechatHomeBanners(): Promise<WechatBannerPayload[]> {
  const rows = await loadActiveBanners();

  const productIds = [
    ...new Set(
      rows
        .filter((r) => parseBannerTargetType(r.targetType) === "PRODUCT" && r.productId)
        .map((r) => r.productId as string)
    ),
  ];

  const spus =
    productIds.length > 0
      ? await prisma.productSpu.findMany({
          where: {
            ...activeSpuWhere,
            isActive: true,
            id: { in: productIds },
            skus: { some: { stock: { gt: 0 } } },
          },
          include: productSpuInclude,
        })
      : [];

  const productMap = new Map<string, ProductPick>(
    spus.map((spu) => {
      const skus = spu.skus;
      const imageUrl = resolveSpuCardImageUrl(skus);
      const firstSku = skus[0];
      return [
        spu.id,
        {
          id: spu.id,
          name: spu.name,
          sku: firstSku?.skuCode ?? "",
          price: { toString: () => resolveSpuMinPrice(skus).toFixed(2) },
          images: imageUrl ? [imageUrl] : [],
        },
      ];
    })
  );

  return resolveWechatBanners(rows, productMap);
}

export async function syncBannersFromWriteItems(
  items: BannerWriteItem[]
): Promise<BannerRow[]> {
  const sorted = [...items].sort(
    (a, b) => a.sortOrder - b.sortOrder || (a.id ?? "").localeCompare(b.id ?? "")
  );

  const ids = sorted.map((i) => i.id).filter((id): id is string => Boolean(id));

  await prisma.$transaction(async (tx) => {
    if (ids.length > 0) {
      await tx.banner.deleteMany({
        where: { id: { notIn: ids } },
      });
    } else {
      await tx.banner.deleteMany({});
    }

    for (const item of sorted) {
      const data: Prisma.BannerUncheckedCreateInput = {
        imageUrl: item.imageUrl.trim(),
        sortOrder: Math.round(item.sortOrder),
        targetType: parseBannerTargetType(item.targetType) as BannerTargetType,
        targetParam: item.targetParam?.trim() || null,
        productId:
          parseBannerTargetType(item.targetType) === "PRODUCT"
            ? item.productId?.trim() || null
            : null,
        isActive: item.isActive ?? true,
      };

      if (item.id) {
        await tx.banner.upsert({
          where: { id: item.id },
          create: { id: item.id, ...data },
          update: data,
        });
      } else {
        await tx.banner.create({ data });
      }
    }
  });

  return loadActiveBanners();
}

export function legacyHomeBannerToWriteItems(
  items: HomeBannerItem[]
): BannerWriteItem[] {
  return items.map((item) => ({
    id: item.id,
    imageUrl: item.imageUrl,
    sortOrder: item.sort,
    targetType: "PRODUCT",
    targetParam: null,
    productId: item.productId,
    isActive: true,
  }));
}
