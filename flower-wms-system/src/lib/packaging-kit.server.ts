import type { Prisma } from "@/generated/prisma/client";
import type { PackagingKitRow } from "@/lib/packaging-kit";
import { prisma } from "@/lib/prisma";

function mapRow(row: {
  id: string;
  name: string;
  description: string | null;
  standardCost: Prisma.Decimal;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}): PackagingKitRow {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    standardCost: row.standardCost.toFixed(2),
    isActive: row.isActive,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function loadPackagingKits(options?: {
  activeOnly?: boolean;
}): Promise<PackagingKitRow[]> {
  const rows = await prisma.packagingKit.findMany({
    where: options?.activeOnly ? { isActive: true } : undefined,
    orderBy: [{ isActive: "desc" }, { updatedAt: "desc" }],
  });
  return rows.map(mapRow);
}

export { mapRow as mapPackagingKitRow };
