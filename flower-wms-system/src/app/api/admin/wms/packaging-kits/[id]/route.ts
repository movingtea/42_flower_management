import { Prisma } from "@/generated/prisma/client";
import { jsonError, jsonSuccess } from "@/lib/api";
import { isResponse, requirePermission } from "@/lib/api-auth";
import { parsePackagingKitWriteBody } from "@/lib/packaging-kit";
import { mapPackagingKitRow } from "@/lib/packaging-kit.server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

function mapError(err: unknown): { message: string; status: number } {
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === "P2025") return { message: "包装方案不存在", status: 404 };
    return { message: `数据库错误 (${err.code})`, status: 500 };
  }
  if (err instanceof Error) {
    const msg = err.message;
    if (
      msg.includes("不能为空") ||
      msg.includes("须为") ||
      msg.includes("无效") ||
      msg.includes("不存在")
    ) {
      return { message: msg, status: 400 };
    }
    return { message: msg, status: 500 };
  }
  return { message: "包装方案操作失败", status: 500 };
}

export async function PUT(request: Request, context: RouteContext) {
  try {
    const staff = await requirePermission("wms:write");
    if (isResponse(staff)) return staff;

    const { id } = await context.params;
    const body = parsePackagingKitWriteBody(await request.json());
    const updated = await prisma.packagingKit.update({
      where: { id },
      data: body,
    });
    return jsonSuccess({
      message: "包装方案已更新",
      kit: mapPackagingKitRow(updated),
    });
  } catch (err) {
    const { message, status } = mapError(err);
    return jsonError(message, status);
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  try {
    const staff = await requirePermission("wms:write");
    if (isResponse(staff)) return staff;

    const { id } = await context.params;
    await prisma.packagingKit.update({
      where: { id },
      data: { isActive: false },
    });
    return jsonSuccess({ message: "包装方案已停用" });
  } catch (err) {
    const { message, status } = mapError(err);
    return jsonError(message, status);
  }
}
