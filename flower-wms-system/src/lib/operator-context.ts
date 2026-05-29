import { prisma } from "@/lib/prisma";

export type OperatorContext = {
  operatorStaffId: string;
  operatorLabel: string;
};

export async function resolveOperatorContext(
  staffUserId: string
): Promise<OperatorContext> {
  const staff = await prisma.staffUser.findUnique({
    where: { id: staffUserId },
    select: { id: true, username: true, isActive: true },
  });
  if (!staff || !staff.isActive) {
    throw new Error("操作员账号无效或已停用");
  }
  return {
    operatorStaffId: staff.id,
    operatorLabel: staff.username,
  };
}
