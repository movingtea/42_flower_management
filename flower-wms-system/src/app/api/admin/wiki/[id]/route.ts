import { Prisma } from "@/generated/prisma/client";
import { jsonError, jsonSuccess } from "@/lib/api";
import { serializeWiki } from "@/lib/wiki-serialize";
import { deleteWiki, getWikiById, updateWiki } from "@/services/wiki";

export const dynamic = "force-dynamic";

function mapError(err: unknown): { message: string; status: number } {
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === "P2002") {
      return { message: "标准花材名已存在，请更换名称", status: 409 };
    }
    if (err.code === "P2025") {
      return { message: "花材 Wiki 不存在", status: 404 };
    }
    return { message: `数据库错误 (${err.code})`, status: 500 };
  }
  if (err instanceof Error) {
    const msg = err.message;
    if (
      msg.includes("不能为空") ||
      msg.includes("须为") ||
      msg.includes("请上传")
    ) {
      return { message: msg, status: 400 };
    }
    if (msg.includes("不存在")) return { message: msg, status: 404 };
    return { message: msg, status: 500 };
  }
  return { message: "操作失败", status: 500 };
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const wiki = await getWikiById(id);
    if (!wiki) return jsonError("花材 Wiki 不存在", 404);
    return jsonSuccess({ item: serializeWiki(wiki) });
  } catch (err) {
    const { message, status } = mapError(err);
    return jsonError(message, status);
  }
}

export async function PUT(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const raw = await request.json();
    const wiki = await updateWiki(id, raw);
    return jsonSuccess({
      message: "花材 Wiki 已更新",
      item: serializeWiki(wiki),
    });
  } catch (err) {
    const { message, status } = mapError(err);
    return jsonError(message, status);
  }
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    await deleteWiki(id);
    return jsonSuccess({ message: "花材 Wiki 已删除" });
  } catch (err) {
    const { message, status } = mapError(err);
    return jsonError(message, status);
  }
}
