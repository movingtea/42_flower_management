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
import { resolveBannerCmsStatus as resolveBannerCmsStatusPure } from "@/services/banner-rules-pure";

export type CmsBannerRow = BannerRow & {
  isDeleted: boolean;
  startsAt: Date | null;
  endsAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type ListCmsBannersParams = {
  /** 是否包含已停用（isActive=false）但未删除的 Banner；默认 true */
  includeInactive?: boolean;
  /** 是否包含已软删除 Banner；默认 false，CMS 默认列表不展示 */
  includeDeleted?: boolean;
};

export type CreateCmsBannerInput = {
  imageUrl: string;
  sortOrder?: number;
  targetType?: string;
  targetParam?: string | null;
  productId?: string | null;
  isActive?: boolean;
  startsAt?: Date | string | null;
  endsAt?: Date | string | null;
};

export type UpdateCmsBannerInput = Partial<CreateCmsBannerInput>;

function parseOptionalDate(value: Date | string | null | undefined): Date | null {
  if (value == null || value === "") return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function resolveBannerCmsStatus(
  row: Pick<
    CmsBannerRow,
    "isActive" | "isDeleted" | "startsAt" | "endsAt"
  >,
  now: Date = new Date()
): string {
  return resolveBannerCmsStatusPure(
    {
      isActive: row.isActive,
      isDeleted: row.isDeleted,
      startsAt: row.startsAt,
      endsAt: row.endsAt,
    },
    now
  );
}

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
    isDeleted: row.isDeleted,
    startsAt: row.startsAt,
    endsAt: row.endsAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    spu: row.spu,
  };
}

function buildBannerData(
  input: CreateCmsBannerInput & {
    startsAt?: Date | string | null;
    endsAt?: Date | string | null;
  }
): Prisma.BannerUncheckedCreateInput {
  const targetType = parseBannerTargetType(input.targetType);
  const startsAt = parseOptionalDate(input.startsAt);
  const endsAt = parseOptionalDate(input.endsAt);
  if (startsAt && endsAt && startsAt.getTime() > endsAt.getTime()) {
    throw new Error("开始时间不能晚于结束时间");
  }
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
    startsAt,
    endsAt,
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

  const includeInactive = params.includeInactive !== false;
  const includeDeleted = params.includeDeleted === true;

  const rows = await prisma.banner.findMany({
    where: {
      ...(includeDeleted ? {} : { isDeleted: false }),
      ...(includeInactive ? {} : { isActive: true }),
    },
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
    data: buildBannerData({
      ...input,
      startsAt: input.startsAt,
      endsAt: input.endsAt,
    }),
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

  const patchData: Prisma.BannerUncheckedUpdateInput = {
    imageUrl: normalizeStoredImagePathRequired(merged.imageUrl),
    sortOrder: Math.round(merged.sortOrder),
    targetType: merged.targetType as BannerTargetType,
    targetParam: merged.targetParam?.trim() || null,
    productId:
      merged.targetType === "PRODUCT"
        ? merged.productId?.trim() || null
        : null,
    isActive: merged.isActive !== false,
  };

  if (input.startsAt !== undefined) {
    patchData.startsAt = parseOptionalDate(input.startsAt);
  }
  if (input.endsAt !== undefined) {
    patchData.endsAt = parseOptionalDate(input.endsAt);
  }

  const nextStartsAt =
    input.startsAt !== undefined
      ? parseOptionalDate(input.startsAt)
      : existing.startsAt;
  const nextEndsAt =
    input.endsAt !== undefined
      ? parseOptionalDate(input.endsAt)
      : existing.endsAt;
  if (
    nextStartsAt &&
    nextEndsAt &&
    nextStartsAt.getTime() > nextEndsAt.getTime()
  ) {
    throw new Error("开始时间不能晚于结束时间");
  }

  const row = await prisma.banner.update({
    where: { id },
    data: patchData,
    include: bannerInclude(),
  });

  return toBannerRow(row);
}

/** 软删除：标记 isDeleted=true 且 isActive=false，小程序不再展示；记录保留 */
export async function softDeleteCmsBanner(id: string): Promise<CmsBannerRow> {
  const existing = await getCmsBannerById(id);
  if (!existing) throw new Error("轮播图不存在");

  if (existing.isDeleted) {
    return existing;
  }

  const row = await prisma.banner.update({
    where: { id },
    data: { isActive: false, isDeleted: true },
    include: bannerInclude(),
  });

  return toBannerRow(row);
}

/** @deprecated 使用 softDeleteCmsBanner */
export const deactivateCmsBanner = softDeleteCmsBanner;

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
    isDeleted: row.isDeleted,
    startsAt: row.startsAt?.toISOString() ?? null,
    endsAt: row.endsAt?.toISOString() ?? null,
    displayStatus: resolveBannerCmsStatus(row),
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
