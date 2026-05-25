import type { Prisma } from "@/generated/prisma/client";
import { FloralRole } from "@/generated/prisma/enums";
import {
  parseFloralRole,
  type WikiFormPayload,
} from "@/lib/wiki-constants";
import { prisma } from "@/lib/prisma";

export type WikiListQuery = {
  q?: string;
  floralRole?: FloralRole;
  color?: string;
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

function parseWikiPayload(raw: unknown): WikiFormPayload {
  if (!raw || typeof raw !== "object") throw new Error("请求体须为 JSON 对象");
  const b = raw as Record<string, unknown>;

  const englishName =
    typeof b.englishName === "string" ? b.englishName.trim() : "";
  const chineseName =
    typeof b.chineseName === "string" ? b.chineseName.trim() : "";
  const maintenance =
    typeof b.maintenance === "string" ? b.maintenance.trim() : "";

  if (!englishName) throw new Error("englishName（拉丁/英文名）不能为空");
  if (!chineseName) throw new Error("中文常用名不能为空");
  if (!maintenance) throw new Error("养护指南不能为空");

  let colorTags: string[] = [];
  if (Array.isArray(b.colorTags)) {
    colorTags = b.colorTags.map(String).map((s) => s.trim()).filter(Boolean);
  } else if (typeof b.colorTags === "string" && b.colorTags.trim()) {
    colorTags = [b.colorTags.trim()];
  } else if (typeof b.color === "string" && b.color.trim()) {
    colorTags = [b.color.trim()];
  }
  if (colorTags.length === 0) throw new Error("色系标签不能为空");

  const floralRole = parseFloralRole(b.floralRole ?? b.role);
  const photo = typeof b.photo === "string" ? b.photo.trim() : null;
  const morphology =
    typeof b.morphology === "string" ? b.morphology.trim() : null;
  const supplySeason =
    typeof b.supplySeason === "string" ? b.supplySeason.trim() : null;

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
    aliasMap,
  };
}

function toCreateData(p: WikiFormPayload): Prisma.FlowerWikiCreateInput {
  return {
    photo: p.photo,
    englishName: p.englishName,
    chineseName: p.chineseName,
    colorTags: p.colorTags,
    morphology: p.morphology,
    supplySeason: p.supplySeason,
    floralRole: p.floralRole,
    maintenance: p.maintenance,
    aliasMap: p.aliasMap ?? {},
  };
}

export async function listWikis(query: WikiListQuery = {}) {
  const where: Prisma.FlowerWikiWhereInput = {};
  if (query.floralRole) where.floralRole = query.floralRole;
  if (query.color?.trim()) {
    where.colorTags = { has: query.color.trim() };
  }
  if (query.q?.trim()) {
    const q = query.q.trim();
    where.OR = [
      { englishName: { contains: q, mode: "insensitive" } },
      { chineseName: { contains: q, mode: "insensitive" } },
    ];
  }
  return prisma.flowerWiki.findMany({ where, orderBy: { updatedAt: "desc" } });
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

/** 拉丁名 / 中文名 / 别名撞库 */
export async function matchFlowerWiki(name: string): Promise<WikiMatchResult> {
  const needle = normalize(name);
  if (!needle) return { hit: false };

  const exact = await prisma.flowerWiki.findFirst({
    where: {
      OR: [
        { englishName: { equals: name.trim(), mode: "insensitive" } },
        { chineseName: { equals: name.trim(), mode: "insensitive" } },
      ],
    },
  });
  if (exact) return { hit: true, wiki: exact };

  const all = await prisma.flowerWiki.findMany();
  for (const wiki of all) {
    const candidates = [wiki.englishName, wiki.chineseName, ...aliasValues(wiki.aliasMap)];
    if (candidates.some((c) => normalize(c) === needle)) {
      return { hit: true, wiki };
    }
  }
  return { hit: false };
}

export async function createWiki(raw: unknown) {
  return prisma.flowerWiki.create({ data: toCreateData(parseWikiPayload(raw)) });
}

export async function updateWiki(id: string, raw: unknown) {
  const existing = await prisma.flowerWiki.findUnique({ where: { id } });
  if (!existing) throw new Error("花材 Wiki 不存在");
  return prisma.flowerWiki.update({
    where: { id },
    data: toCreateData(parseWikiPayload(raw)),
  });
}

export async function deleteWiki(id: string) {
  const linked = await prisma.material.count({ where: { wikiId: id } });
  if (linked > 0) throw new Error("该母表已被仓储物料引用，无法删除");
  return prisma.flowerWiki.delete({ where: { id } });
}

export { parseWikiPayload };
