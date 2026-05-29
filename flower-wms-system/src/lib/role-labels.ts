import { Role } from "@/generated/prisma/enums";

export const ROLE_LABEL: Record<Role, string> = {
  IT_ADMIN: "IT 运维",
  STORE_ADMIN: "门店主理人",
  WAREHOUSE_MANAGER: "大仓经理",
  FLORIST: "花艺师",
  STORE_OPERATOR: "前台运营",
};
