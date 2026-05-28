import { auth } from "@/auth";
import { Role } from "@/generated/prisma/enums";
import {
  canAccessBusinessData,
  hasPermission,
  type ApiPermission,
} from "@/lib/rbac";
import {
  resolveOperatorContext,
  type OperatorContext,
} from "@/lib/operator-context";

/**
 * 库存变动服务层鉴权：从 Session 解析操作员，防止绕过 Route Handler 直接调用服务。
 */
export async function assertStockMutationAuthorized(
  permission: ApiPermission
): Promise<OperatorContext> {
  const session = await auth();
  if (!session?.user?.id || !session.user.role) {
    throw new Error("未登录或会话已过期");
  }

  const role = session.user.role as Role;

  if (!canAccessBusinessData(role)) {
    throw new Error("IT 运维账号无权执行库存变动");
  }

  if (!hasPermission(role, permission)) {
    throw new Error("当前角色无权执行库存变动");
  }

  return resolveOperatorContext(session.user.id);
}

/** 校验请求携带的操作员与会话一致，防止伪造 operatorStaffId */
export async function assertStockMutationOperatorMatches(
  permission: ApiPermission,
  operator: OperatorContext
): Promise<OperatorContext> {
  const sessionOperator = await assertStockMutationAuthorized(permission);
  if (operator.operatorStaffId !== sessionOperator.operatorStaffId) {
    throw new Error("操作员身份与会话不一致，禁止代他人记账");
  }
  return sessionOperator;
}
