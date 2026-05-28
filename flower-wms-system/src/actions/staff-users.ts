"use server";

import bcrypt from "bcryptjs";
import { auth } from "@/auth";
import { Role, StaffAuditAction } from "@/generated/prisma/enums";
import { prisma } from "@/lib/prisma";
import { canManageStaffUsers } from "@/lib/rbac";

export type ResetPasswordResult =
  | { success: true }
  | { success: false; error: string; status: 401 | 403 | 400 | 404 };

function parseNewPassword(raw: string): string | null {
  const password = raw.trim();
  if (password.length < 6) {
    return null;
  }
  return password;
}

/**
 * 管理员代行重置员工密码（仅 IT_ADMIN / STORE_ADMIN）。
 * 写入 staff_audit_logs，密码 bcrypt 哈希存储。
 */
export async function resetUserPassword(
  targetStaffId: string,
  newPassword: string
): Promise<ResetPasswordResult> {
  const session = await auth();
  if (!session?.user?.id || !session.user.role) {
    return { success: false, error: "未登录或会话已过期", status: 401 };
  }

  const operatorRole = session.user.role as Role;
  if (!canManageStaffUsers(operatorRole)) {
    return { success: false, error: "当前角色无权重置密码", status: 403 };
  }

  const targetId = targetStaffId.trim();
  if (!targetId) {
    return { success: false, error: "目标用户无效", status: 400 };
  }

  const password = parseNewPassword(newPassword);
  if (!password) {
    return { success: false, error: "新密码至少 6 位", status: 400 };
  }

  const target = await prisma.staffUser.findUnique({
    where: { id: targetId },
    select: { id: true, role: true, username: true },
  });

  if (!target) {
    return { success: false, error: "用户不存在", status: 404 };
  }

  if (
    operatorRole === Role.STORE_ADMIN &&
    target.role === Role.IT_ADMIN
  ) {
    return {
      success: false,
      error: "门店主理人不可重置 IT 运维账号密码",
      status: 403,
    };
  }

  const passwordHash = await bcrypt.hash(password, 12);

  await prisma.$transaction([
    prisma.staffUser.update({
      where: { id: target.id },
      data: { passwordHash },
    }),
    prisma.staffAuditLog.create({
      data: {
        action: StaffAuditAction.PASSWORD_RESET,
        operatorStaffId: session.user.id,
        targetStaffId: target.id,
      },
    }),
  ]);

  return { success: true };
}
