import {
  MaterialKind,
  Prisma,
  PurchaseState,
  ReservationState,
} from "../../generated/prisma-v2-draft/client";
import { assertMaterialQuantity } from "../domain/stock-planning";

const CODE_PATTERN = /^[A-Z0-9][A-Z0-9._-]{1,31}$/;

function required(value: string, label: string, max = 100): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${label}必填`);
  if (normalized.length > max) throw new Error(`${label}不能超过 ${max} 个字符`);
  return normalized;
}

function optional(value: string | null | undefined, max: number, label: string): string | null {
  const normalized = value?.trim() ?? "";
  if (normalized.length > max) throw new Error(`${label}不能超过 ${max} 个字符`);
  return normalized || null;
}

export function normalizeMasterCode(value: string): string {
  const code = value.trim().toUpperCase();
  if (!CODE_PATTERN.test(code)) {
    throw new Error("编码需为 2–32 位大写字母、数字、点、下划线或短横线");
  }
  return code;
}

export type MaterialInput = {
  code: string;
  name: string;
  kind: MaterialKind;
  color?: string | null;
  grade?: string | null;
  gradeSpecification?: string | null;
  specification?: string | null;
  baseUnit: string;
  quantityScale: number;
  reservePerOrder: boolean;
};

function validateMaterial(input: MaterialInput) {
  if (!Object.values(MaterialKind).includes(input.kind)) throw new Error("物料类别无效");
  if (!Number.isInteger(input.quantityScale) || input.quantityScale < 0 || input.quantityScale > 3) {
    throw new Error("库存小数位数必须为 0–3 的整数");
  }
  assertMaterialQuantity(0, input.quantityScale);
  const baseUnit = required(input.baseUnit, "库存单位", 12);
  if (["块", "卷"].includes(baseUnit) && input.quantityScale !== 0) {
    throw new Error(`${baseUnit}必须使用整数库存`);
  }
  return {
    code: normalizeMasterCode(input.code),
    name: required(input.name, "物料名称", 80),
    kind: input.kind,
    color: optional(input.color, 40, "颜色"),
    grade: optional(input.grade, 40, "品质等级"),
    gradeSpecification: optional(input.gradeSpecification, 80, "等级说明"),
    specification: optional(input.specification, 80, "规格"),
    baseUnit,
    quantityScale: input.quantityScale,
    reservePerOrder: input.reservePerOrder,
  };
}

type Scope = { tenantId: string; storeId: string; actorStaffId: string };

export async function createMaterialMaster(
  tx: Prisma.TransactionClient,
  scope: Scope,
  input: MaterialInput,
) {
  const data = validateMaterial(input);
  const duplicate = await tx.material.findFirst({
    where: { tenantId: scope.tenantId, code: data.code },
    select: { id: true },
  });
  if (duplicate) throw new Error("物料编码已存在");
  const material = await tx.material.create({ data: { tenantId: scope.tenantId, ...data } });
  await tx.auditEvent.create({ data: {
    tenantId: scope.tenantId, storeId: scope.storeId, actorStaffId: scope.actorStaffId,
    action: "MATERIAL_CREATED", entityType: "Material", entityId: material.id,
    afterSnapshot: { code: material.code, name: material.name, kind: material.kind, active: material.active },
  } });
  return material;
}

export async function updateMaterialMaster(
  tx: Prisma.TransactionClient,
  scope: Scope,
  materialId: string,
  input: MaterialInput,
) {
  const data = validateMaterial(input);
  await tx.$queryRaw`SELECT id FROM "Material" WHERE id = ${materialId} FOR UPDATE`;
  const current = await tx.material.findFirst({ where: { id: materialId, tenantId: scope.tenantId } });
  if (!current) throw new Error("物料不存在或不属于当前租户");
  if (data.code !== current.code) throw new Error("物料编码创建后不能修改");
  const hasStock = await tx.batchBalance.findFirst({
    where: { batch: { materialId, storeId: scope.storeId }, OR: [{ onHandQty: { not: 0 } }, { frozenQty: { not: 0 } }] },
    select: { id: true },
  });
  if (hasStock && (data.baseUnit !== current.baseUnit || data.quantityScale !== current.quantityScale)) {
    throw new Error("存在库存时不能修改库存单位或小数位数");
  }
  const material = await tx.material.update({ where: { id: materialId }, data });
  await tx.auditEvent.create({ data: {
    tenantId: scope.tenantId, storeId: scope.storeId, actorStaffId: scope.actorStaffId,
    action: "MATERIAL_UPDATED", entityType: "Material", entityId: material.id,
    beforeSnapshot: { name: current.name, kind: current.kind, color: current.color, grade: current.grade, specification: current.specification, baseUnit: current.baseUnit, quantityScale: current.quantityScale, reservePerOrder: current.reservePerOrder },
    afterSnapshot: { name: material.name, kind: material.kind, color: material.color, grade: material.grade, specification: material.specification, baseUnit: material.baseUnit, quantityScale: material.quantityScale, reservePerOrder: material.reservePerOrder },
  } });
  return material;
}

export async function setMaterialActive(
  tx: Prisma.TransactionClient,
  scope: Scope,
  materialId: string,
  active: boolean,
) {
  await tx.$queryRaw`SELECT id FROM "Material" WHERE id = ${materialId} FOR UPDATE`;
  const current = await tx.material.findFirst({ where: { id: materialId, tenantId: scope.tenantId } });
  if (!current) throw new Error("物料不存在或不属于当前租户");
  if (current.active === active) return current;
  if (!active) {
    const [reservation, purchase] = await Promise.all([
      tx.inventoryReservation.findFirst({
        where: { state: ReservationState.ACTIVE, batch: { materialId, storeId: scope.storeId } }, select: { id: true },
      }),
      tx.purchaseOrderLine.findFirst({
        where: { materialId, purchaseOrder: { tenantId: scope.tenantId, storeId: scope.storeId, state: { in: [PurchaseState.DRAFT, PurchaseState.ORDERED, PurchaseState.PARTIALLY_RECEIVED] } } },
        select: { id: true },
      }),
    ]);
    if (reservation) throw new Error("物料仍有有效库存预留，不能停用");
    if (purchase) throw new Error("物料仍有关联的未完成采购单，不能停用");
  }
  const material = await tx.material.update({ where: { id: materialId }, data: { active } });
  await tx.auditEvent.create({ data: {
    tenantId: scope.tenantId, storeId: scope.storeId, actorStaffId: scope.actorStaffId,
    action: active ? "MATERIAL_ACTIVATED" : "MATERIAL_DEACTIVATED",
    entityType: "Material", entityId: material.id,
    beforeSnapshot: { active: current.active }, afterSnapshot: { active },
  } });
  return material;
}

export type SupplierInput = {
  code: string; name: string; contactName?: string | null; phone?: string | null;
  wechat?: string | null; notes?: string | null;
};

function validateSupplier(input: SupplierInput) {
  return {
    code: normalizeMasterCode(input.code),
    name: required(input.name, "供应商名称", 80),
    contactName: optional(input.contactName, 50, "联系人"),
    phone: optional(input.phone, 30, "联系电话"),
    wechat: optional(input.wechat, 50, "微信"),
    notes: optional(input.notes, 500, "备注"),
  };
}

export async function createSupplierMaster(tx: Prisma.TransactionClient, scope: Scope, input: SupplierInput) {
  const data = validateSupplier(input);
  if (await tx.supplier.findFirst({ where: { tenantId: scope.tenantId, code: data.code }, select: { id: true } })) {
    throw new Error("供应商编码已存在");
  }
  const supplier = await tx.supplier.create({ data: { tenantId: scope.tenantId, ...data } });
  await tx.auditEvent.create({ data: {
    tenantId: scope.tenantId, storeId: scope.storeId, actorStaffId: scope.actorStaffId,
    action: "SUPPLIER_CREATED", entityType: "Supplier", entityId: supplier.id,
    afterSnapshot: { code: supplier.code, name: supplier.name, active: supplier.active },
  } });
  return supplier;
}

export async function updateSupplierMaster(tx: Prisma.TransactionClient, scope: Scope, supplierId: string, input: SupplierInput) {
  const data = validateSupplier(input);
  await tx.$queryRaw`SELECT id FROM "Supplier" WHERE id = ${supplierId} FOR UPDATE`;
  const current = await tx.supplier.findFirst({ where: { id: supplierId, tenantId: scope.tenantId } });
  if (!current) throw new Error("供应商不存在或不属于当前租户");
  if (current.code !== data.code) throw new Error("供应商编码创建后不能修改");
  const supplier = await tx.supplier.update({ where: { id: supplierId }, data });
  await tx.auditEvent.create({ data: {
    tenantId: scope.tenantId, storeId: scope.storeId, actorStaffId: scope.actorStaffId,
    action: "SUPPLIER_UPDATED", entityType: "Supplier", entityId: supplier.id,
    beforeSnapshot: { name: current.name, contactName: current.contactName, phone: current.phone, wechat: current.wechat, notes: current.notes },
    afterSnapshot: { name: supplier.name, contactName: supplier.contactName, phone: supplier.phone, wechat: supplier.wechat, notes: supplier.notes },
  } });
  return supplier;
}

export async function setSupplierActive(tx: Prisma.TransactionClient, scope: Scope, supplierId: string, active: boolean) {
  await tx.$queryRaw`SELECT id FROM "Supplier" WHERE id = ${supplierId} FOR UPDATE`;
  const current = await tx.supplier.findFirst({ where: { id: supplierId, tenantId: scope.tenantId } });
  if (!current) throw new Error("供应商不存在或不属于当前租户");
  if (current.active === active) return current;
  if (!active && await tx.purchaseOrder.findFirst({
    where: { supplierId, tenantId: scope.tenantId, storeId: scope.storeId, state: { in: [PurchaseState.DRAFT, PurchaseState.ORDERED, PurchaseState.PARTIALLY_RECEIVED] } },
    select: { id: true },
  })) throw new Error("供应商仍有关联的未完成采购单，不能停用");
  const supplier = await tx.supplier.update({ where: { id: supplierId }, data: { active } });
  await tx.auditEvent.create({ data: {
    tenantId: scope.tenantId, storeId: scope.storeId, actorStaffId: scope.actorStaffId,
    action: active ? "SUPPLIER_ACTIVATED" : "SUPPLIER_DEACTIVATED",
    entityType: "Supplier", entityId: supplier.id,
    beforeSnapshot: { active: current.active }, afterSnapshot: { active },
  } });
  return supplier;
}
