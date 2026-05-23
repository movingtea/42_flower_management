import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";

export type SkuEntityKind = "product" | "productSku" | "material";

const MAX_ATTEMPTS = 10;

/** 生成 1000000–9999999 的 7 位纯数字字符串（首位非 0） */
function randomSevenDigitCode(): string {
  return String(Math.floor(1000000 + Math.random() * 9000000));
}

type DbClient = Prisma.TransactionClient | typeof prisma;

/**
 * 生成在 Product.sku 或 Material.materialCode 上唯一的 7 位数字编码。
 * 最多重试 MAX_ATTEMPTS 次，碰撞则重新生成。
 */
export async function generateUniqueSku(
  kind: SkuEntityKind,
  client: DbClient = prisma
): Promise<string> {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const code = randomSevenDigitCode();

    if (kind === "product" || kind === "productSku") {
      const existing = await client.productSku.findUnique({
        where: { skuCode: code },
        select: { id: true },
      });
      if (!existing) return code;
    } else {
      const existing = await client.material.findUnique({
        where: { materialCode: code },
        select: { id: true },
      });
      if (!existing) return code;
    }
  }

  throw new Error("无法生成唯一编码，请稍后重试");
}
