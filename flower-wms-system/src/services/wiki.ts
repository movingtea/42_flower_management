import { Prisma } from "@/generated/prisma/client";
import { FloralRole } from "@/generated/prisma/enums";
import {
  parseFloralRole,
  type WikiFormPayload,
} from "@/lib/wiki-constants";
import {
  buildCareDocument,
  careTableToMaintenanceText,
  parseCareTable,
  validateCareTableForSave,
} from "@/lib/wiki-care";
import { toPinyinIndex } from "@/lib/pinyin-index";
import { prisma } from "@/lib/prisma";

export type WikiListQuery = {
  q?: string;
  floralRole?: FloralRole;
  color?: string;
  page?: number;
  pageSize?: number;
};

function normalize(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

function aliasValues(aliasMap: unknown): string[] {
  if (!aliasMap || typeof aliasMap !== "object") return [];
  const out: string[] = [];
  for (const val of Object.values(aliasMap as Record<string, unknown>)) {
    if (Array.isArray(val)) {
      for (const item of val) {
        if (typeof item === "string" && item.trim()) out.push(item.trim());
      }
    }
  }
  return out;
}

export function mergeAliasMap(
  existing: unknown,
  additions: string[]
): Record<string, string[]> {
  const base =
    existing && typeof existing === "object"
      ? { ...(existing as Record<string, string[]>) }
      : {};
  const zh = base.zh ?? [];
  return { ...base, zh: [...new Set([...zh, ...additions.filter(Boolean)])] };
}

function readChineseName(b: Record<string, unknown>): string {
  if (typeof b.chineseName === "string" && b.chineseName.trim()) {
    return b.chineseName.trim();
  }
  if (typeof b.name === "string" && b.name.trim()) {
    return b.name.trim();
  }
  return "";
}

function readColorTags(b: Record<string, unknown>): string[] {
  if (Array.isArray(b.colorTags)) {
    return b.colorTags.map(String).map((s) => s.trim()).filter(Boolean);
  }
  if (typeof b.colorTags === "string" && b.colorTags.trim()) {
    return [b.colorTags.trim()];
  }
  if (typeof b.color === "string" && b.color.trim()) {
    return b.color
      .split(/[,，]/)
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return [];
}

function parseOptionalShelfLifeDays(raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === "") return null;
  const n = Math.round(Number(raw));
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error("默认保质期须为正整数（天）");
  }
  return n;
}

export function parseWikiPayload(raw: unknown): WikiFormPayload {
  if (!raw || typeof raw !== "object") throw new Error("请求体须为 JSON 对象");
  const b = raw as Record<string, unknown>;

  const englishName =
    typeof b.englishName === "string" ? b.englishName.trim() : "";
  const chineseName = readChineseName(b);
  const careTableRaw = parseCareTable(b.careTable);
  const maintenanceInput =
    typeof b.maintenance === "string" ? b.maintenance.trim() : "";

  let maintenance = maintenanceInput;
  let careTable: WikiFormPayload["careTable"] = null;

  if (careTableRaw && validateCareTableForSave(careTableRaw)) {
    careTable = careTableRaw;
    maintenance = careTableToMaintenanceText(careTableRaw);
  }

  if (!englishName) throw new Error("拉丁学名（englishName）不能为空");
  if (!chineseName) throw new Error("中文常用名不能为空");
  if (!maintenance) throw new Error("养护指南不能为空");

  const colorTags = readColorTags(b);
  if (colorTags.length === 0) throw new Error("色系标签不能为空");

  const floralRole = parseFloralRole(b.floralRole ?? b.role);
  const photo = typeof b.photo === "string" ? b.photo.trim() : null;
  const morphology =
    typeof b.morphology === "string"
      ? b.morphology.trim()
      : typeof b.texture === "string"
        ? b.texture.trim()
        : null;
  const supplySeason =
    typeof b.supplySeason === "string"
      ? b.supplySeason.trim()
      : typeof b.availability === "string"
        ? b.availability.trim()
        : null;

  let aliasMap: Record<string, string[]> = { zh: [] };
  if (b.aliasMap && typeof b.aliasMap === "object") {
    aliasMap = b.aliasMap as Record<string, string[]>;
  } else if (typeof b.alias === "string" && b.alias.trim()) {
    aliasMap = {
      zh: b.alias.split(/[,，]/).map((s) => s.trim()).filter(Boolean),
    };
  }

  return {
    photo: photo || null,
    englishName,
    chineseName,
    colorTags,
    morphology: morphology || null,
    supplySeason: supplySeason || null,
    floralRole,
    maintenance,
    careTable,
    aliasMap,
    defaultShelfLifeDays: parseOptionalShelfLifeDays(
      b.defaultShelfLifeDays ?? b.shelfLifeDays
    ),
  };
}

function maintenanceCareInput(
  careTable: WikiFormPayload["careTable"],
  mode: "create" | "update"
): Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput | undefined {
  if (careTable?.length) {
    return buildCareDocument(careTable) as Prisma.InputJsonValue;
  }
  return mode === "update" ? Prisma.DbNull : undefined;
}

function toCreateData(p: WikiFormPayload): Prisma.FlowerWikiCreateInput {
  return {
    photo: p.photo,
    englishName: p.englishName,
    chineseName: p.chineseName,
    pinyinIndex: toPinyinIndex(p.chineseName),
    colorTags: p.colorTags,
    morphology: p.morphology,
    supplySeason: p.supplySeason,
    floralRole: p.floralRole,
    maintenance: p.maintenance,
    maintenanceCare: maintenanceCareInput(p.careTable, "create"),
    defaultShelfLifeDays: p.defaultShelfLifeDays ?? null,
    aliasMap: p.aliasMap ?? {},
  };
}

function toUpdateData(p: WikiFormPayload): Prisma.FlowerWikiUpdateInput {
  return {
    ...toCreateData(p),
    maintenanceCare: maintenanceCareInput(p.careTable, "update"),
  };
}

function buildWhere(query: WikiListQuery): Prisma.FlowerWikiWhereInput {
  const where: Prisma.FlowerWikiWhereInput = {};
  if (query.floralRole) where.floralRole = query.floralRole;
  if (query.color?.trim()) {
    where.colorTags = { has: query.color.trim() };
  }
  if (query.q?.trim()) {
    const q = query.q.trim();
    const qLower = q.toLowerCase();
    where.OR = [
      { englishName: { contains: q, mode: "insensitive" } },
      { chineseName: { contains: q, mode: "insensitive" } },
      { pinyinIndex: { contains: qLower, mode: "insensitive" } },
    ];
  }
  return where;
}

export async function listWikis(query: WikiListQuery = {}) {
  const page = Math.max(1, query.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, query.pageSize ?? 20));
  const where = buildWhere(query);

  const [items, total] = await Promise.all([
    prisma.flowerWiki.findMany({
      where,
      orderBy: { updatedAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.flowerWiki.count({ where }),
  ]);

  return { items, total, page, pageSize };
}

export async function getWikiById(id: string) {
  return prisma.flowerWiki.findUnique({ where: { id } });
}

export async function getWikiByEnglishName(englishName: string) {
  return prisma.flowerWiki.findUnique({
    where: { englishName: englishName.trim() },
  });
}

export type WikiMatchResult =
  | { hit: true; wiki: NonNullable<Awaited<ReturnType<typeof getWikiById>>> }
  | { hit: false };

/** 拉丁名 / 中文名 / 拼音简拼 / 别名撞库 */
export async function matchFlowerWiki(name: string): Promise<WikiMatchResult> {
  const needle = normalize(name);
  if (!needle) return { hit: false };

  const exact = await prisma.flowerWiki.findFirst({
    where: {
      OR: [
        { englishName: { equals: name.trim(), mode: "insensitive" } },
        { chineseName: { equals: name.trim(), mode: "insensitive" } },
        { pinyinIndex: { equals: needle, mode: "insensitive" } },
      ],
    },
  });
  if (exact) return { hit: true, wiki: exact };

  const all = await prisma.flowerWiki.findMany();
  for (const wiki of all) {
    const candidates = [
      wiki.englishName,
      wiki.chineseName,
      wiki.pinyinIndex,
      ...aliasValues(wiki.aliasMap),
    ];
    if (candidates.some((c) => normalize(c) === needle)) {
      return { hit: true, wiki };
    }
  }
  return { hit: false };
}

export async function createWiki(raw: unknown) {
  const payload = parseWikiPayload(raw);
  const existing = await getWikiByEnglishName(payload.englishName);
  if (existing) {
    throw new Error(`拉丁学名「${payload.englishName}」已存在，请更换名称`);
  }
  return prisma.flowerWiki.create({ data: toCreateData(payload) });
}

export async function updateWiki(id: string, raw: unknown) {
  const existing = await prisma.flowerWiki.findUnique({ where: { id } });
  if (!existing) throw new Error("花材 Wiki 不存在");

  const payload = parseWikiPayload(raw);
  if (
    payload.englishName.toLowerCase() !== existing.englishName.toLowerCase()
  ) {
    const clash = await getWikiByEnglishName(payload.englishName);
    if (clash && clash.id !== id) {
      throw new Error(`拉丁学名「${payload.englishName}」已存在，请更换名称`);
    }
  }

  return prisma.flowerWiki.update({
    where: { id },
    data: toUpdateData(payload),
  });
}

export async function deleteWiki(id: string) {
  const linked = await prisma.material.count({ where: { wikiId: id } });
  if (linked > 0) throw new Error("该母表已被仓储物料引用，无法删除");
  return prisma.flowerWiki.delete({ where: { id } });
}
