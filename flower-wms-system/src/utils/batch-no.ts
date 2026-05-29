import type { Prisma } from "@/generated/prisma/client";

/** 按日期前缀生成唯一批次号（入库事务内调用） */
export async function generateBatchNo(
  tx: Prisma.TransactionClient
): Promise<string> {
  const now = new Date();
  const prefix = `B${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`;
  const existingCount = await tx.batch.count({
    where: { batchNo: { startsWith: prefix } },
  });
  for (let attempt = 0; attempt < 20; attempt++) {
    const seq = String((existingCount + 1 + attempt) % 1000).padStart(3, "0");
    const candidate = `${prefix}${seq}`;
    const clash = await tx.batch.findUnique({
      where: { batchNo: candidate },
      select: { id: true },
    });
    if (!clash) return candidate;
  }
  return `${prefix}${String(Math.floor(Math.random() * 1000)).padStart(3, "0")}`;
}
