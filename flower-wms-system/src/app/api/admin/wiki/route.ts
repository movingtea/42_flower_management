import { Prisma } from "@/generated/prisma/client";
import { jsonError, jsonSuccess } from "@/lib/api";
import { serializeWiki } from "@/lib/wiki-serialize";
import { parseFloralRole } from "@/lib/wiki-constants";
import { createWiki, listWikis } from "@/services/wiki";

export const dynamic = "force-dynamic";

function mapError(err: unknown): { message: string; status: number } {
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === "P2002") {
      return { message: "拉丁学名已存在，请更换名称", status: 409 };
    }
    return { message: `数据库错误 (${err.code})`, status: 500 };
  }
  if (err instanceof Error) {
    const msg = err.message;
    if (
      msg.includes("不能为空") ||
      msg.includes("须为") ||
      msg.includes("请上传") ||
      msg.includes("已存在")
    ) {
      return { message: msg, status: msg.includes("已存在") ? 409 : 400 };
    }
    if (msg.includes("不存在")) return { message: msg, status: 404 };
    return { message: msg, status: 500 };
  }
  return { message: "操作失败", status: 500 };
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const roleParam = searchParams.get("role") ?? undefined;
    const page = Number(searchParams.get("page") ?? "1");
    const pageSize = Number(searchParams.get("pageSize") ?? "20");

    const result = await listWikis({
      q: searchParams.get("q") ?? undefined,
      floralRole: roleParam ? parseFloralRole(roleParam) : undefined,
      color: searchParams.get("color") ?? undefined,
      page: Number.isFinite(page) ? page : 1,
      pageSize: Number.isFinite(pageSize) ? pageSize : 20,
    });

    return jsonSuccess({
      items: result.items.map(serializeWiki),
      total: result.total,
      page: result.page,
      pageSize: result.pageSize,
    });
  } catch (err) {
    const { message, status } = mapError(err);
    return jsonError(message, status);
  }
}

export async function POST(request: Request) {
  try {
    const raw = await request.json();
    const wiki = await createWiki(raw);
    return jsonSuccess(
      {
        message: "花材母表已入库",
        item: serializeWiki(wiki),
      },
      201
    );
  } catch (err) {
    const { message, status } = mapError(err);
    return jsonError(message, status);
  }
}
