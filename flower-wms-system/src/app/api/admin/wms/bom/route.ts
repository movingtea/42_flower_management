import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json(
    {
      success: false,
      error: "此接口已迁移至 /api/admin/wms/recipes",
      redirect: "/api/admin/wms/recipes",
    },
    { status: 410 }
  );
}

export async function POST() {
  return GET();
}
