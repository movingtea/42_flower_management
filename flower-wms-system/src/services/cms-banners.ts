import { BannerTargetType } from "@/generated/prisma/enums";
import type { Prisma } from "@/generated/prisma/client";
import {
  parseBannerTargetType,
  validateBannerWriteItem,
  type BannerWriteItem,
} from "@/lib/banner";
import {
  bannerRowToWriteItem,
  migrateBannersFromAppConfigIfEmpty,
  type BannerRow,
} from "@/lib/banner.server";
import { normalizeStoredImagePathRequired } from "@/lib/image-url";
import { prisma } from "@/lib/prisma";

export type CmsBannerRow = BannerRow & {
  createdAt: Date;
  updatedAt: Date;
};

export type ListCmsBannersParams = {
  includeInactive?: boolean;
};

export type CreateCmsBannerInput = {
  imageUrl: string;
  sortOrder?: number;
  targetType?: string;
  targetParam?: string | null;
  productId?: string | null;
  isActive?: boolean;
};

export type UpdateCmsBannerInput = Partial<CreateCmsBannerInput>;

function bannerInclude() {
  return {
    spu: {
      select: {
        id: true,
        name: true,
        isDeleted: true,
        isActive: true,
      },
    },
  } as const;
}

function toBannerRow(
  row: Prisma.BannerGetPayload<{ include: ReturnType<typeof bannerInclude> }>
): CmsBannerRow {
  return {
    id: row.id,
    imageUrl: row.imageUrl,
    sortOrder: row.sortOrder,
    targetType: row.targetType,
    targetParam: row.targetParam,
    productId: row.productId,
    isActive: row.isActive,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    spu: row.spu,
  };
}

function buildBannerData(
  input: CreateCmsBannerInput
): Prisma.BannerUncheckedCreateInput {
  const targetType = parseBannerTargetType(input.targetType);
  return {
    imageUrl: normalizeStoredImagePathRequired(input.imageUrl),
    sortOrder: Number.isFinite(input.sortOrder)
      ? Math.round(input.sortOrder as number)
      : 100,
    targetType: targetType as BannerTargetType,
    targetParam: input.targetParam?.trim() || null,
    productId:
      targetType === "PRODUCT" ? input.productId?.trim() || null : null,
    isActive: input.isActive !== false,
  };
}

function validateInput(item: BannerWriteItem, index = 0): void {
  const error = validateBannerWriteItem(item, index);
  if (error) throw new Error(error);
}

export async function listCmsBanners(
  params: ListCmsBannersParams = {}
): Promise<{ banners: CmsBannerRow[]; total: number }> {
  await migrateBannersFromAppConfigIfEmpty();

  const rows = await prisma.banner.findMany({
    where: params.includeInactive === false ? { isActive: true } : undefined,
    orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }],
    include: bannerInclude(),
  });

  const banners = rows.map(toBannerRow);
  return { banners, total: banners.length };
}

export async function getCmsBannerById(id: string): Promise<CmsBannerRow | null> {
  await migrateBannersFromAppConfigIfEmpty();

  const row = await prisma.banner.findUnique({
    where: { id },
    include: bannerInclude(),
  });

  return row ? toBannerRow(row) : null;
}

export async function createCmsBanner(
  input: CreateCmsBannerInput
): Promise<CmsBannerRow> {
  const draft: BannerWriteItem = {
    imageUrl: input.imageUrl,
    sortOrder: input.sortOrder ?? 100,
    targetType: parseBannerTargetType(input.targetType),
    targetParam: input.targetParam ?? null,
    productId: input.productId ?? null,
    isActive: input.isActive !== false,
  };
  validateInput(draft);

  const row = await prisma.banner.create({
    data: buildBannerData(input),
    include: bannerInclude(),
  });

  return toBannerRow(row);
}

export async function updateCmsBanner(
  id: string,
  input: UpdateCmsBannerInput
): Promise<CmsBannerRow> {
  const existing = await getCmsBannerById(id);
  if (!existing) throw new Error("轮播图不存在");

  const merged = bannerRowToWriteItem(existing);
  if (input.imageUrl !== undefined) merged.imageUrl = input.imageUrl;
  if (input.sortOrder !== undefined) merged.sortOrder = input.sortOrder;
  if (input.targetType !== undefined) {
    merged.targetType = parseBannerTargetType(input.targetType);
  }
  if (input.targetParam !== undefined) merged.targetParam = input.targetParam;
  if (input.productId !== undefined) merged.productId = input.productId;
  if (input.isActive !== undefined) merged.isActive = input.isActive;

  validateInput(merged);

  const row = await prisma.banner.update({
    where: { id },
    data: buildBannerData(merged),
    include: bannerInclude(),
  });

  return toBannerRow(row);
}

/** 软删除：停用轮播图，小程序不再展示 */
export async function deactivateCmsBanner(id: string): Promise<CmsBannerRow> {
  const existing = await getCmsBannerById(id);
  if (!existing) throw new Error("轮播图不存在");

  const row = await prisma.banner.update({
    where: { id },
    data: { isActive: false },
    include: bannerInclude(),
  });

  return toBannerRow(row);
}

export async function reorderCmsBanners(
  items: Array<{ id: string; sortOrder: number }>
): Promise<CmsBannerRow[]> {
  if (!items.length) throw new Error("排序项不能为空");

  await prisma.$transaction(
    items.map((item) =>
      prisma.banner.update({
        where: { id: item.id },
        data: { sortOrder: Math.round(item.sortOrder) },
      })
    )
  );

  const { banners } = await listCmsBanners({ includeInactive: true });
  return banners;
}

export function cmsBannerToApiPayload(row: CmsBannerRow) {
  return {
    ...bannerRowToWriteItem(row),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** @deprecated 批量全量同步，保留旧 API 兼容 */
export async function syncCmsBannersBulk(
  items: BannerWriteItem[]
): Promise<CmsBannerRow[]> {
  const sorted = [...items].sort(
    (a, b) => a.sortOrder - b.sortOrder || (a.id ?? "").localeCompare(b.id ?? "")
  );

  const ids = sorted
    .map((i) => i.id)
    .filter((id): id is string => Boolean(id));

  await prisma.$transaction(async (tx) => {
    if (ids.length > 0) {
      await tx.banner.deleteMany({
        where: { id: { notIn: ids } },
      });
    } else {
      await tx.banner.deleteMany({});
    }

    for (const item of sorted) {
      const data = buildBannerData(item);
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

  const { banners } = await listCmsBanners({ includeInactive: true });
  return banners;
}
