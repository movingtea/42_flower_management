import bcrypt from "bcryptjs";
import { Role } from "@/generated/prisma/enums";
import { jsonError, jsonSuccess } from "@/lib/api";
import { isResponse, requirePermission } from "@/lib/api-auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

const ALLOWED_ROLES = Object.values(Role);

export async function GET() {
  const staff = await requirePermission("staff:manage");
  if (isResponse(staff)) return staff;

  const users = await prisma.staffUser.findMany({
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      username: true,
      role: true,
      displayName: true,
      isActive: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  return jsonSuccess({ items: users });
}

export async function POST(request: Request) {
  try {
    const staff = await requirePermission("staff:manage");
    if (isResponse(staff)) return staff;

    const body = (await request.json()) as Record<string, unknown>;
    const username =
      typeof body.username === "string" ? body.username.trim() : "";
    const password =
      typeof body.password === "string" ? body.password : "";
    const role = body.role as Role;
    const displayName =
      typeof body.displayName === "string" ? body.displayName.trim() : null;

    if (!username || !password) {
      return jsonError("用户名与密码不能为空", 400);
    }
    if (!ALLOWED_ROLES.includes(role)) {
      return jsonError("无效的角色", 400);
    }

    if (staff.role === Role.STORE_ADMIN && role === Role.IT_ADMIN) {
      return jsonError("门店主理人不可创建 IT 运维账号", 403);
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const created = await prisma.staffUser.create({
      data: {
        username,
        passwordHash,
        role,
        displayName,
      },
      select: {
        id: true,
        username: true,
        role: true,
        displayName: true,
        isActive: true,
        createdAt: true,
      },
    });

    return jsonSuccess({ item: created }, 201);
  } catch (err) {
    const message = err instanceof Error ? err.message : "创建用户失败";
    if (message.includes("Unique constraint")) {
      return jsonError("用户名已存在", 409);
    }
    return jsonError(message, 500);
  }
}
