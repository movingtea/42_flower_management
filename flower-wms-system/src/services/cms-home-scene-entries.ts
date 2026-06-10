import {
  GiftOccasionType,
  HomeSceneEntryTargetType,
} from "@/generated/prisma/enums";
import type { CmsHomeSceneEntry } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import {
  buildFallbackMiniProgramEntries,
  DEFAULT_HOME_SCENE_ENTRIES,
  getDefaultEntryDefsForMissingSceneTypes,
  sortHomeSceneEntries,
  toMiniProgramHomeSceneEntry,
  type MiniProgramHomeSceneEntry,
} from "@/services/cms-home-scene-entries-pure";

export type HomeSceneEntryRow = CmsHomeSceneEntry & {
  linkedRecommendationSlot: {
    id: string;
    key: string;
    name: string;
    isActive: boolean;
  } | null;
};

export type ListHomeSceneEntriesParams = {
  includeInactive?: boolean;
  keyword?: string | null;
  sceneType?: GiftOccasionType | null;
};

export type CreateHomeSceneEntryInput = {
  title: string;
  subtitle?: string | null;
  sceneType: GiftOccasionType;
  iconKey: string;
  sortOrder?: number;
  isActive?: boolean;
  targetType?: HomeSceneEntryTargetType;
  targetValue?: string | null;
  linkedRecommendationSlotId?: string | null;
  linkedRecommendationSlotKey?: string | null;
  note?: string | null;
};

export type UpdateHomeSceneEntryInput = Partial<CreateHomeSceneEntryInput>;

function entryInclude() {
  return {
    linkedRecommendationSlot: {
      select: {
        id: true,
        key: true,
        name: true,
        isActive: true,
      },
    },
  } as const;
}

function buildEntryWarnings(entries: HomeSceneEntryRow[]): string[] {
  const warnings: string[] = [];
  for (const entry of entries) {
    if (
      entry.linkedRecommendationSlotKey &&
      !entry.linkedRecommendationSlot
    ) {
      warnings.push(
        `场景入口「${entry.title}」关联推荐位不存在或已删除`
      );
    } else if (
      entry.linkedRecommendationSlot &&
      !entry.linkedRecommendationSlot.isActive
    ) {
      warnings.push(
        `场景入口「${entry.title}」关联推荐位「${entry.linkedRecommendationSlot.name}」已停用`
      );
    }
  }
  return warnings;
}

function filterEntries(
  entries: HomeSceneEntryRow[],
  params: ListHomeSceneEntriesParams
): HomeSceneEntryRow[] {
  let result = entries;

  if (!params.includeInactive) {
    result = result.filter((e) => e.isActive);
  }

  if (params.sceneType) {
    result = result.filter((e) => e.sceneType === params.sceneType);
  }

  const keyword = params.keyword?.trim();
  if (keyword) {
    const lower = keyword.toLowerCase();
    result = result.filter(
      (e) =>
        e.title.toLowerCase().includes(lower) ||
        (e.subtitle?.toLowerCase().includes(lower) ?? false) ||
        e.sceneType.toLowerCase().includes(lower) ||
        e.iconKey.toLowerCase().includes(lower)
    );
  }

  return sortHomeSceneEntries(result);
}

export async function listHomeSceneEntries(
  params: ListHomeSceneEntriesParams = {}
): Promise<{
  entries: HomeSceneEntryRow[];
  fallbackEntries: ReturnType<typeof buildFallbackMiniProgramEntries>;
  warnings: string[];
}> {
  const rows = await prisma.cmsHomeSceneEntry.findMany({
    include: entryInclude(),
    orderBy: { sortOrder: "asc" },
  });

  const entries = filterEntries(rows, params);
  const warnings = buildEntryWarnings(entries);

  return {
    entries,
    fallbackEntries: buildFallbackMiniProgramEntries(),
    warnings,
  };
}

export async function listActiveHomeSceneEntriesForMiniProgram(): Promise<{
  entries: MiniProgramHomeSceneEntry[];
  source: "CMS" | "FALLBACK";
}> {
  const rows = await prisma.cmsHomeSceneEntry.findMany({
    where: { isActive: true },
    orderBy: { sortOrder: "asc" },
  });

  if (rows.length === 0) {
    return {
      entries: buildFallbackMiniProgramEntries(),
      source: "FALLBACK",
    };
  }

  return {
    entries: sortHomeSceneEntries(rows).map((row) =>
      toMiniProgramHomeSceneEntry({
        id: row.id,
        title: row.title,
        subtitle: row.subtitle,
        sceneType: row.sceneType,
        iconKey: row.iconKey,
        sortOrder: row.sortOrder,
        targetType: row.targetType,
        targetValue: row.targetValue,
        linkedRecommendationSlotKey: row.linkedRecommendationSlotKey,
        source: "CMS",
      })
    ),
    source: "CMS",
  };
}

export async function getHomeSceneEntryById(
  id: string
): Promise<HomeSceneEntryRow | null> {
  return prisma.cmsHomeSceneEntry.findUnique({
    where: { id },
    include: entryInclude(),
  });
}

async function resolveLinkedSlot(
  linkedRecommendationSlotId?: string | null,
  linkedRecommendationSlotKey?: string | null
): Promise<{
  linkedRecommendationSlotId: string | null;
  linkedRecommendationSlotKey: string | null;
}> {
  if (linkedRecommendationSlotId) {
    const slot = await prisma.cmsRecommendationSlot.findUnique({
      where: { id: linkedRecommendationSlotId },
      select: { id: true, key: true },
    });
    if (!slot) {
      throw new Error("关联推荐位不存在或已删除");
    }
    return {
      linkedRecommendationSlotId: slot.id,
      linkedRecommendationSlotKey: slot.key,
    };
  }

  if (linkedRecommendationSlotKey?.trim()) {
    const slot = await prisma.cmsRecommendationSlot.findUnique({
      where: { key: linkedRecommendationSlotKey.trim() },
      select: { id: true, key: true },
    });
    if (!slot) {
      throw new Error("关联推荐位不存在或已删除");
    }
    return {
      linkedRecommendationSlotId: slot.id,
      linkedRecommendationSlotKey: slot.key,
    };
  }

  return {
    linkedRecommendationSlotId: null,
    linkedRecommendationSlotKey: null,
  };
}

export async function createHomeSceneEntry(
  input: CreateHomeSceneEntryInput
): Promise<HomeSceneEntryRow> {
  const title = input.title.trim();
  if (!title) throw new Error("标题不能为空");

  const iconKey = input.iconKey.trim();
  if (!iconKey) throw new Error("图标不能为空");

  const linked = await resolveLinkedSlot(
    input.linkedRecommendationSlotId,
    input.linkedRecommendationSlotKey
  );

  return prisma.cmsHomeSceneEntry.create({
    data: {
      title,
      subtitle: input.subtitle?.trim() || null,
      sceneType: input.sceneType,
      iconKey,
      sortOrder: input.sortOrder ?? 0,
      isActive: input.isActive !== false,
      targetType:
        input.targetType ?? HomeSceneEntryTargetType.PRODUCT_FILTER,
      targetValue: input.targetValue?.trim() || null,
      linkedRecommendationSlotId: linked.linkedRecommendationSlotId,
      linkedRecommendationSlotKey: linked.linkedRecommendationSlotKey,
      note: input.note?.trim() || null,
    },
    include: entryInclude(),
  });
}

export async function updateHomeSceneEntry(
  id: string,
  input: UpdateHomeSceneEntryInput
): Promise<HomeSceneEntryRow> {
  const existing = await prisma.cmsHomeSceneEntry.findUnique({ where: { id } });
  if (!existing) throw new Error("场景入口不存在");

  const data: Record<string, unknown> = {};

  if (input.title !== undefined) {
    const title = input.title.trim();
    if (!title) throw new Error("标题不能为空");
    data.title = title;
  }
  if (input.subtitle !== undefined) {
    data.subtitle = input.subtitle?.trim() || null;
  }
  if (input.sceneType !== undefined) data.sceneType = input.sceneType;
  if (input.iconKey !== undefined) {
    const iconKey = input.iconKey.trim();
    if (!iconKey) throw new Error("图标不能为空");
    data.iconKey = iconKey;
  }
  if (input.sortOrder !== undefined) data.sortOrder = input.sortOrder;
  if (input.isActive !== undefined) data.isActive = input.isActive;
  if (input.targetType !== undefined) data.targetType = input.targetType;
  if (input.targetValue !== undefined) {
    data.targetValue = input.targetValue?.trim() || null;
  }
  if (input.note !== undefined) data.note = input.note?.trim() || null;

  if (
    input.linkedRecommendationSlotId !== undefined ||
    input.linkedRecommendationSlotKey !== undefined
  ) {
    const linked = await resolveLinkedSlot(
      input.linkedRecommendationSlotId,
      input.linkedRecommendationSlotKey
    );
    data.linkedRecommendationSlotId = linked.linkedRecommendationSlotId;
    data.linkedRecommendationSlotKey = linked.linkedRecommendationSlotKey;
  }

  return prisma.cmsHomeSceneEntry.update({
    where: { id },
    data,
    include: entryInclude(),
  });
}

export async function deleteHomeSceneEntry(id: string): Promise<void> {
  const existing = await prisma.cmsHomeSceneEntry.findUnique({ where: { id } });
  if (!existing) throw new Error("场景入口不存在");
  await prisma.cmsHomeSceneEntry.delete({ where: { id } });
}

export async function seedMissingDefaultHomeSceneEntries(): Promise<{
  created: HomeSceneEntryRow[];
  skipped: GiftOccasionType[];
}> {
  const existing = await prisma.cmsHomeSceneEntry.findMany({
    select: { sceneType: true },
  });
  const existingTypes = existing.map((e) => e.sceneType);
  const defs = getDefaultEntryDefsForMissingSceneTypes(existingTypes);

  const created: HomeSceneEntryRow[] = [];
  for (const def of defs) {
    const row = await createHomeSceneEntry({
      title: def.title,
      subtitle: def.subtitle,
      sceneType: def.sceneType,
      iconKey: def.iconKey,
      sortOrder: def.sortOrder,
      isActive: true,
      targetType: def.targetType,
    });
    created.push(row);
  }

  const skipped = DEFAULT_HOME_SCENE_ENTRIES.filter((d) =>
    existingTypes.includes(d.sceneType)
  ).map((d) => d.sceneType);

  return { created, skipped };
}

export async function reorderHomeSceneEntries(
  items: Array<{ id: string; sortOrder: number }>
): Promise<HomeSceneEntryRow[]> {
  await prisma.$transaction(
    items.map((item) =>
      prisma.cmsHomeSceneEntry.update({
        where: { id: item.id },
        data: { sortOrder: item.sortOrder },
      })
    )
  );

  const { entries } = await listHomeSceneEntries({ includeInactive: true });
  return entries;
}
