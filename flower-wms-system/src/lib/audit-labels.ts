import type { AuditModule } from "@/generated/prisma/enums";

const MODULE_LABELS: Record<AuditModule, string> = {
  WMS: "WMS",
  CMS: "CMS",
  CRM: "CRM",
  ORDER: "订单",
  INVENTORY: "库存",
  PURCHASE: "采购",
  REPORT: "报表",
  SYSTEM: "系统",
};

export function getAuditModuleLabel(module: string): string {
  return MODULE_LABELS[module as AuditModule] ?? module;
}

export const AUDIT_MODULE_OPTIONS = Object.entries(MODULE_LABELS).map(
  ([value, label]) => ({ value, label })
);
