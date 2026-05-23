import { jsonError } from "@/lib/api";

export const dynamic = "force-dynamic";

/** @deprecated 请使用 POST /api/wechat/auth/login */
export async function POST(request: Request) {
  const url = new URL(request.url);
  const target = `${url.origin}/api/wechat/auth/login`;

  try {
    const body = await request.text();
    const res = await fetch(target, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
    });
    const data = await res.json();
    return Response.json(data, { status: res.status });
  } catch {
    return jsonError("登录转发失败", 500);
  }
}
