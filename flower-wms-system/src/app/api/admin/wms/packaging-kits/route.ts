import { Prisma } from "@/generated/prisma/client";
import { jsonError, jsonSuccess } from "@/lib/api";
import { isResponse, requirePermission } from "@/lib/api-auth";
import { parsePackagingKitWriteBody } from "@/lib/packaging-kit";
import { loadPackagingKits, mapPackagingKitRow } from "@/lib/packaging-kit.server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

function mapError(err: unknown): { message: string; status: number } {
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === "P2025") return { message: "包装方案不存在", status: 404 };
    return { message: `数据库错误 (${err.code})`, status: 500 };
  }
  if (err instanceof Error) {
    const msg = err.message;
    if (msg.includes("不能为空") || msg.includes("须为") || msg.includes("无效")) {
      return { message: msg, status: 400 };
    }
    return { message: msg, status: 500 };
  }
  return { message: "包装方案操作失败", status: 500 };
}

export async function GET(request: Request) {
  try {
    const staff = await requirePermission("wms:read");
    if (isResponse(staff)) return staff;

    const { searchParams } = new URL(request.url);
    const activeOnly = searchParams.get("activeOnly") === "1";
    const list = await loadPackagingKits({ activeOnly });
    return jsonSuccess({ list });
  } catch (err) {
    const { message, status } = mapError(err);
    return jsonError(message, status);
  }
}

export async function POST(request: Request) {
  try {
    const staff = await requirePermission("wms:write");
    if (isResponse(staff)) return staff;

    const body = parsePackagingKitWriteBody(await request.json());
    const created = await prisma.packagingKit.create({ data: body });
    return jsonSuccess(
      { message: "包装方案已创建", kit: mapPackagingKitRow(created) },
      201
    );
  } catch (err) {
    const { message, status } = mapError(err);
    return jsonError(message, status);
  }
}
