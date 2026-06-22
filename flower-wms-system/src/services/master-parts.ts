import { Prisma } from "@/generated/prisma/client";
import {
  normalizeMasterPartCreateInput,
  normalizeMasterPartUpdateInput,
  type MasterPartType,
} from "@/lib/master-parts-pure";
import { prisma } from "@/lib/prisma";
import { withTenant } from "@/lib/tenant/tenant-write-context";

export type MasterPartListParams = {
  keyword?: string;
  type?: MasterPartType;
  isActive?: boolean;
  page?: number;
  pageSize?: number;
};

function serializeMasterPart(row: {
  id: string;
  tenantId: string | null;
  type: string;
  name: string;
  spec: string | null;
  defaultUnit: string | null;
  brand: string | null;
  model: string | null;
  color: string | null;
  isConsumable: boolean;
  isActive: boolean;
  note: string | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: row.id,
    tenantId: row.tenantId,
    type: row.type,
    name: row.name,
    spec: row.spec,
    defaultUnit: row.defaultUnit,
    brand: row.brand,
    model: row.model,
    color: row.color,
    isConsumable: row.isConsumable,
    isActive: row.isActive,
    note: row.note,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function listMasterParts(params: MasterPartListParams = {}) {
  const page = Math.max(1, params.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, params.pageSize ?? 20));
  const where: Prisma.MasterPartWhereInput = {};

  const keyword = params.keyword?.trim();
  if (keyword) {
    where.OR = [
      { name: { contains: keyword, mode: "insensitive" } },
      { spec: { contains: keyword, mode: "insensitive" } },
      { brand: { contains: keyword, mode: "insensitive" } },
      { model: { contains: keyword, mode: "insensitive" } },
      { color: { contains: keyword, mode: "insensitive" } },
      { note: { contains: keyword, mode: "insensitive" } },
    ];
  }
  if (params.type) where.type = params.type;
  if (params.isActive !== undefined) where.isActive = params.isActive;

  const [items, total] = await Promise.all([
    prisma.masterPart.findMany({
      where,
      orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.masterPart.count({ where }),
  ]);

  return {
    items: items.map(serializeMasterPart),
    total,
    page,
    pageSize,
  };
}

export async function getMasterPart(id: string) {
  const row = await prisma.masterPart.findUnique({ where: { id } });
  if (!row) throw new Error("通用物料不存在");
  return serializeMasterPart(row);
}

export async function createMasterPart(raw: unknown) {
  const input = normalizeMasterPartCreateInput(raw);
  const row = await prisma.masterPart.create({
    data: withTenant({
      type: input.type,
      name: input.name,
      spec: input.spec ?? null,
      defaultUnit: input.defaultUnit ?? null,
      brand: input.brand ?? null,
      model: input.model ?? null,
      color: input.color ?? null,
      isConsumable: input.isConsumable ?? true,
      isActive: input.isActive ?? true,
      note: input.note ?? null,
    }),
  });
  return serializeMasterPart(row);
}

export async function updateMasterPart(id: string, raw: unknown) {
  await getMasterPart(id);
  const input = normalizeMasterPartUpdateInput(raw);
  const row = await prisma.masterPart.update({
    where: { id },
    data: {
      type: input.type,
      name: input.name,
      spec: input.spec ?? null,
      defaultUnit: input.defaultUnit ?? null,
      brand: input.brand ?? null,
      model: input.model ?? null,
      color: input.color ?? null,
      isConsumable: input.isConsumable ?? true,
      isActive: input.isActive ?? true,
      note: input.note ?? null,
    },
  });
  return serializeMasterPart(row);
}

export async function deleteOrDeactivateMasterPart(id: string) {
  await getMasterPart(id);
  const row = await prisma.masterPart.update({
    where: { id },
    data: { isActive: false },
  });
  return serializeMasterPart(row);
}
