import { NextResponse } from "next/server";
import { isResponse, requirePermission } from "@/lib/api-auth";

const GONE_BODY = {
  success: false,
  error: "此接口已迁移至 /api/admin/wms/recipes",
  redirect: "/api/admin/wms/recipes",
};

export async function GET() {
  const staff = await requirePermission("wms:read");
  if (isResponse(staff)) return staff;

  return NextResponse.json(GONE_BODY, { status: 410 });
}

export async function POST() {
  const staff = await requirePermission("wms:write");
  if (isResponse(staff)) return staff;

  return NextResponse.json(GONE_BODY, { status: 410 });
}
