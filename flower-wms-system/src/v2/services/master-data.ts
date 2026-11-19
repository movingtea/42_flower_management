import {
  FloralRole,
  LossMode,
  MaterialKind,
  Prisma,
  PurchaseState,
  ReservationState,
} from "../../generated/prisma-v2/client";
import { toPinyinIndex } from "@/lib/pinyin-index";
import { storageConfigToImageUrlEnv } from "@/lib/storage/config";
import {
  generateEntropy,
  generateMaterialCode,
  generateSupplierCode,
} from "../domain/identifiers";
import { normalizeV2ImageKey } from "../domain/media";
import { assertMaterialQuantity } from "../domain/stock-planning";

const CODE_PATTERN = /^[A-Z0-9][A-Z0-9._-]{1,31}$/;

/** Caps shared by the material form, the AI completion contract and this service. */
const MAX_COLOR_TAGS = 20;
const MAX_COLOR_TAG_LENGTH = 20;
const MAX_ALIASES = 20;
const MAX_ALIAS_LENGTH = 40;
const MAX_MORPHOLOGY_LENGTH = 200;
const LIST_SEPARATOR = /[,，、;；\n]+/;

/** Non-disclosing delete guard: a referenced material must be disabled instead. */
export const MATERIAL_DELETE_REFERENCED_MESSAGE = "该物料已有业务引用，请改为停用";

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

/**
 * A blank code means "let the system generate one". An explicit code is still
 * accepted so imports, tests and the V1-style API keep working.
 */
function optionalMasterCode(value: string | null | undefined): string | null {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw) return null;
  return normalizeMasterCode(raw);
}

export type MaterialInput = {
  /** Optional: `MAT-YYYYMMDD-XXXXXXXX` is generated when blank. Ignored on edit. */
  code?: string | null;
  name: string;
  kind: MaterialKind;
  color?: string | null;
  grade?: string | null;
  gradeSpecification?: string | null;
  specification?: string | null;
  baseUnit: string;
  quantityScale: number;
  reservePerOrder: boolean;
  /** V1 FlowerWiki knowledge and V1 MasterPart attributes. */
  englishName?: string | null;
  flowerLanguage?: string | null;
  maintenance?: string | null;
  maintenanceCare?: unknown;
  supplySeason?: string | null;
  defaultShelfLifeDays?: number | string | null;
  standardUnitCost?: number | string | null;
  costUnit?: string | null;
  costNote?: string | null;
  optimisticUsableRate?: number | string | null;
  standardUsableRate?: number | string | null;
  conservativeUsableRate?: number | string | null;
  lossRateNote?: string | null;
  brand?: string | null;
  model?: string | null;
  notes?: string | null;
  /** OSS objectKey under universe42/wms/materials. */
  imageKey?: string | null;
  safetyStockThreshold?: number | string | null;
  categoryIds?: string[];
  /** V1 material-library parity fields (migration 0014). */
  floralRole?: string | null;
  /** Accepts an array or a comma/、/; separated string; blank clears the tags. */
  colorTags?: readonly string[] | string | null;
  morphology?: string | null;
  /** `{ zh: [...] }` (object) or its JSON text; blank clears all aliases. */
  aliasMap?: unknown;
  defaultUsableRate?: number | string | null;
  defaultLossRate?: number | string | null;
  lossMode?: string | null;
};

function optionalNumber(
  value: number | string | null | undefined,
  label: string,
  options: { min?: number; max?: number; decimals: number; integer?: boolean },
): string | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`${label}必须为有效数字`);
  if (options.min !== undefined && parsed < options.min) throw new Error(`${label}不能小于 ${options.min}`);
  if (options.max !== undefined && parsed > options.max) throw new Error(`${label}不能大于 ${options.max}`);
  if (options.integer && !Number.isInteger(parsed)) throw new Error(`${label}必须为整数`);
  const rounded = Number(parsed.toFixed(options.decimals));
  if (Math.abs(rounded - parsed) > 1e-8) throw new Error(`${label}最多保留 ${options.decimals} 位小数`);
  return rounded.toFixed(options.decimals);
}

function optionalInteger(
  value: number | string | null | undefined,
  label: string,
  min: number,
): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) throw new Error(`${label}必须为整数`);
  if (parsed < min) throw new Error(`${label}不能小于 ${min}`);
  return parsed;
}

function optionalRate(value: number | string | null | undefined, label: string): string | null {
  return optionalNumber(value, label, { min: 0, max: 1, decimals: 4 });
}

function optionalCare(value: unknown): Prisma.InputJsonValue | typeof Prisma.JsonNull | undefined {
  if (value === undefined) return undefined;
  if (value === null) return Prisma.JsonNull;
  if (typeof value !== "object") throw new Error("养护指南表格格式无效");
  return value as Prisma.InputJsonValue;
}

function optionalEnum<T extends string>(
  value: unknown,
  allowed: readonly T[],
  label: string,
): T | null {
  if (value === undefined || value === null) return null;
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw) return null;
  if (!(allowed as readonly string[]).includes(raw)) throw new Error(`${label}无效`);
  return raw as T;
}

function normalizeFloralRole(value: unknown): FloralRole | null {
  return optionalEnum(value, Object.values(FloralRole), "花材角色");
}

function normalizeLossMode(value: unknown): LossMode {
  return optionalEnum(value, Object.values(LossMode), "损耗模式") ?? LossMode.STANDARD;
}

function normalizeColorTags(
  value: readonly string[] | string | null | undefined,
): string[] {
  if (value === undefined || value === null) return [];
  const raw = typeof value === "string" ? value.split(LIST_SEPARATOR) : value;
  const tags: string[] = [];
  for (const entry of raw) {
    const tag = typeof entry === "string" ? entry.trim() : "";
    if (!tag) continue;
    if (tag.length > MAX_COLOR_TAG_LENGTH) {
      throw new Error(`颜色标签不能超过 ${MAX_COLOR_TAG_LENGTH} 个字符`);
    }
    if (!tags.includes(tag)) tags.push(tag);
  }
  if (tags.length > MAX_COLOR_TAGS) throw new Error(`颜色标签最多 ${MAX_COLOR_TAGS} 个`);
  return tags;
}

type AliasMap = Record<string, string[]>;

function normalizeAliasMap(value: unknown): AliasMap {
  if (value === undefined || value === null) return {};
  let source: unknown = value;
  if (typeof value === "string") {
    const raw = value.trim();
    if (!raw) return {};
    try {
      source = JSON.parse(raw);
    } catch {
      throw new Error("别名数据格式无效");
    }
  }
  if (typeof source !== "object" || source === null || Array.isArray(source)) {
    throw new Error("别名数据格式无效");
  }
  const aliasMap: AliasMap = {};
  const seen = new Set<string>();
  let total = 0;
  for (const [rawKey, rawValue] of Object.entries(source as Record<string, unknown>)) {
    const language = rawKey.trim().toLowerCase();
    if (!language) continue;
    const list = Array.isArray(rawValue)
      ? rawValue
      : typeof rawValue === "string"
        ? rawValue.split(LIST_SEPARATOR)
        : null;
    if (list === null) throw new Error("别名数据格式无效");
    const aliases: string[] = [];
    for (const entry of list) {
      const alias = typeof entry === "string" ? entry.trim() : "";
      if (!alias) continue;
      if (alias.length > MAX_ALIAS_LENGTH) {
        throw new Error(`单个别名不能超过 ${MAX_ALIAS_LENGTH} 个字符`);
      }
      if (seen.has(alias)) continue;
      seen.add(alias);
      aliases.push(alias);
      total += 1;
      if (total > MAX_ALIASES) throw new Error(`别名最多 ${MAX_ALIASES} 个`);
    }
    aliasMap[language] = aliases;
  }
  return aliasMap;
}

function aliasTextOf(aliasMap: AliasMap): string {
  return Object.values(aliasMap).flat().join(",");
}

function categoryIds(value: string[] | undefined): string[] | undefined {
  if (value === undefined) return undefined;
  const unique = [...new Set(value.map((id) => id.trim()).filter(Boolean))];
  if (unique.length > 20) throw new Error("单个物料最多关联 20 个分类");
  return unique;
}

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
  const name = required(input.name, "物料名称", 80);
  const aliasMap = normalizeAliasMap(input.aliasMap);
  return {
    explicitCode: optionalMasterCode(input.code),
    data: {
      name,
      kind: input.kind,
      color: optional(input.color, 40, "颜色"),
      floralRole: normalizeFloralRole(input.floralRole),
      colorTags: normalizeColorTags(input.colorTags),
      morphology: optional(input.morphology, MAX_MORPHOLOGY_LENGTH, "形态特征"),
      aliasMap: aliasMap as Prisma.InputJsonValue,
      aliasText: aliasTextOf(aliasMap),
      pinyinIndex: toPinyinIndex(name),
      grade: optional(input.grade, 40, "品质等级"),
      gradeSpecification: optional(input.gradeSpecification, 80, "等级说明"),
      specification: optional(input.specification, 80, "规格"),
      baseUnit,
      quantityScale: input.quantityScale,
      reservePerOrder: input.reservePerOrder,
      englishName: optional(input.englishName, 160, "拉丁学名 / 英文名"),
      flowerLanguage: optional(input.flowerLanguage, 2000, "花语"),
      maintenance: optional(input.maintenance, 8000, "养护指南"),
      supplySeason: optional(input.supplySeason, 120, "供货周期"),
      costUnit: optional(input.costUnit, 12, "成本单位"),
      costNote: optional(input.costNote, 1000, "成本备注"),
      lossRateNote: optional(input.lossRateNote, 1000, "损耗说明"),
      brand: optional(input.brand, 80, "品牌"),
      model: optional(input.model, 80, "型号"),
      notes: optional(input.notes, 2000, "备注"),
      imageKey: normalizeV2ImageKey(input.imageKey, storageConfigToImageUrlEnv()),
      defaultShelfLifeDays: optionalInteger(input.defaultShelfLifeDays, "默认保质期", 1),
      standardUnitCost: optionalNumber(input.standardUnitCost, "标准单位成本", {
        min: 0, decimals: 4,
      }),
      safetyStockThreshold: optionalNumber(input.safetyStockThreshold, "安全库存", {
        min: 0, decimals: 3,
      }) ?? "0",
      optimisticUsableRate: optionalRate(input.optimisticUsableRate, "乐观可用率"),
      standardUsableRate: optionalRate(input.standardUsableRate, "标准可用率"),
      conservativeUsableRate: optionalRate(input.conservativeUsableRate, "保守可用率"),
      defaultUsableRate: optionalRate(input.defaultUsableRate, "默认可用率"),
      defaultLossRate: optionalRate(input.defaultLossRate, "默认损耗率"),
      lossMode: normalizeLossMode(input.lossMode),
      maintenanceCare: optionalCare(input.maintenanceCare),
    },
    categoryIds: categoryIds(input.categoryIds),
  };
}

function decimalNumberOf(value: Prisma.Decimal | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Any loss-model rate: the three usable rates plus the two default rates. */
function hasAnyLossRate(data: {
  optimisticUsableRate: string | null;
  standardUsableRate: string | null;
  conservativeUsableRate: string | null;
  defaultUsableRate: string | null;
  defaultLossRate: string | null;
}): boolean {
  return data.optimisticUsableRate !== null
    || data.standardUsableRate !== null
    || data.conservativeUsableRate !== null
    || data.defaultUsableRate !== null
    || data.defaultLossRate !== null;
}
/** True when a stored Decimal changes to the newly validated string value. */
function storedValueChanged(
  previous: Prisma.Decimal | null | undefined,
  next: string | null,
): boolean {
  const before = decimalNumberOf(previous);
  const after = next === null ? null : Number(next);
  if (before === null || after === null) return before !== after;
  return Math.abs(before - after) > 1e-9;
}

/** True when any loss-model rate changes, so `lossRateUpdatedAt` must move. */
function rateChanged(
  current: {
    optimisticUsableRate: Prisma.Decimal | null;
    standardUsableRate: Prisma.Decimal | null;
    conservativeUsableRate: Prisma.Decimal | null;
    defaultUsableRate: Prisma.Decimal | null;
    defaultLossRate: Prisma.Decimal | null;
  },
  next: {
    optimisticUsableRate: string | null;
    standardUsableRate: string | null;
    conservativeUsableRate: string | null;
    defaultUsableRate: string | null;
    defaultLossRate: string | null;
  },
): boolean {
  return storedValueChanged(current.optimisticUsableRate, next.optimisticUsableRate)
    || storedValueChanged(current.standardUsableRate, next.standardUsableRate)
    || storedValueChanged(current.conservativeUsableRate, next.conservativeUsableRate)
    || storedValueChanged(current.defaultUsableRate, next.defaultUsableRate)
    || storedValueChanged(current.defaultLossRate, next.defaultLossRate);
}

async function assertCategories(
  tx: Prisma.TransactionClient,
  tenantId: string,
  ids: string[] | undefined,
): Promise<void> {
  if (!ids || ids.length === 0) return;
  const found = await tx.materialCategory.findMany({
    where: { tenantId, id: { in: ids } },
    select: { id: true },
  });
  if (found.length !== ids.length) throw new Error("物料分类不存在或不属于当前租户");
}

type Scope = { tenantId: string; storeId: string; actorStaffId: string };

function materialAuditSnapshot(material: {
  code: string;
  name: string;
  kind: string;
  active: boolean;
  pinyinIndex: string;
  aliasText: string;
  floralRole: string | null;
  colorTags: string[];
}) {
  return {
    code: material.code,
    name: material.name,
    kind: material.kind,
    active: material.active,
    pinyinIndex: material.pinyinIndex,
    aliasText: material.aliasText,
    floralRole: material.floralRole,
    colorTags: material.colorTags,
  };
}

export async function createMaterialMaster(
  tx: Prisma.TransactionClient,
  scope: Scope,
  input: MaterialInput,
) {
  const { data, categoryIds: selectedCategoryIds, explicitCode } = validateMaterial(input);
  const code = explicitCode ?? generateMaterialCode(new Date(), generateEntropy());
  const duplicate = await tx.material.findFirst({
    where: { tenantId: scope.tenantId, code },
    select: { id: true },
  });
  if (duplicate) throw new Error("物料编码已存在");
  await assertCategories(tx, scope.tenantId, selectedCategoryIds);
  const now = new Date();
  const hasLossRate = hasAnyLossRate(data);
  const material = await tx.material.create({
    data: {
      tenantId: scope.tenantId,
      code,
      ...data,
      ...(hasLossRate ? { lossRateUpdatedAt: now } : {}),
      ...(data.standardUnitCost !== null ? { costUpdatedAt: now } : {}),
      ...(selectedCategoryIds && selectedCategoryIds.length > 0
        ? { categories: { create: selectedCategoryIds.map((categoryId) => ({ categoryId })) } }
        : {}),
    },
  });
  await tx.auditEvent.create({ data: {
    tenantId: scope.tenantId, storeId: scope.storeId, actorStaffId: scope.actorStaffId,
    action: "MATERIAL_CREATED", entityType: "Material", entityId: material.id,
    afterSnapshot: {
      ...materialAuditSnapshot(material),
      imageKey: material.imageKey,
      defaultUsableRate: decimalNumberOf(material.defaultUsableRate),
      defaultLossRate: decimalNumberOf(material.defaultLossRate),
      lossMode: material.lossMode,
      categoryIds: selectedCategoryIds ?? [],
    },
  } });
  return material;
}

export async function updateMaterialMaster(
  tx: Prisma.TransactionClient,
  scope: Scope,
  materialId: string,
  input: MaterialInput,
) {
  const { data, categoryIds: selectedCategoryIds } = validateMaterial(input);
  await tx.$queryRaw`SELECT id FROM "Material" WHERE id = ${materialId} FOR UPDATE`;
  const current = await tx.material.findFirst({ where: { id: materialId, tenantId: scope.tenantId } });
  if (!current) throw new Error("物料不存在或不属于当前租户");
  const hasStock = await tx.batchBalance.findFirst({
    where: { batch: { materialId, storeId: scope.storeId }, OR: [{ onHandQty: { not: 0 } }, { frozenQty: { not: 0 } }] },
    select: { id: true },
  });
  if (hasStock && (data.baseUnit !== current.baseUnit || data.quantityScale !== current.quantityScale)) {
    throw new Error("存在库存时不能修改库存单位或小数位数");
  }
  await assertCategories(tx, scope.tenantId, selectedCategoryIds);
  const now = new Date();
  const lossRateChanged = rateChanged(current, data);
  const costChanged = storedValueChanged(current.standardUnitCost, data.standardUnitCost);
  const material = await tx.material.update({
    where: { id: materialId },
    // `data` never contains `code`: an edit keeps the existing identifier.
    data: {
      ...data,
      ...(lossRateChanged ? { lossRateUpdatedAt: now } : {}),
      ...(costChanged ? { costUpdatedAt: now } : {}),
      ...(selectedCategoryIds === undefined
        ? {}
        : {
            categories: {
              deleteMany: {},
              ...(selectedCategoryIds.length > 0
                ? { create: selectedCategoryIds.map((categoryId) => ({ categoryId })) }
                : {}),
            },
          }),
    },
  });
  await tx.auditEvent.create({ data: {
    tenantId: scope.tenantId, storeId: scope.storeId, actorStaffId: scope.actorStaffId,
    action: "MATERIAL_UPDATED", entityType: "Material", entityId: material.id,
    beforeSnapshot: {
      ...materialAuditSnapshot(current),
      imageKey: current.imageKey,
      standardUnitCost: decimalNumberOf(current.standardUnitCost),
      defaultUsableRate: decimalNumberOf(current.defaultUsableRate),
      defaultLossRate: decimalNumberOf(current.defaultLossRate),
      lossMode: current.lossMode,
      categoryIds: selectedCategoryIds ?? [],
    },
    afterSnapshot: {
      ...materialAuditSnapshot(material),
      imageKey: material.imageKey,
      standardUnitCost: decimalNumberOf(material.standardUnitCost),
      defaultUsableRate: decimalNumberOf(material.defaultUsableRate),
      defaultLossRate: decimalNumberOf(material.defaultLossRate),
      lossMode: material.lossMode,
      categoryIds: selectedCategoryIds ?? [],
    },
  } });
  return material;
}

/**
 * Row-inline standard cost edit. Only the cost and its timestamp change; the
 * change is audited while an unchanged value is an idempotent no-op.
 */
export async function updateMaterialStandardCost(
  tx: Prisma.TransactionClient,
  scope: Scope,
  materialIdInput: string,
  standardUnitCost: number | string | null,
) {
  const materialId = required(materialIdInput, "物料", 64);
  const cost = optionalNumber(standardUnitCost, "标准单位成本", { min: 0, decimals: 4 });
  if (cost === null) throw new Error("标准单位成本必填");
  await tx.$queryRaw`SELECT id FROM "Material" WHERE id = ${materialId} FOR UPDATE`;
  const current = await tx.material.findFirst({ where: { id: materialId, tenantId: scope.tenantId } });
  if (!current) throw new Error("物料不存在或不属于当前租户");
  if (!storedValueChanged(current.standardUnitCost, cost)) return current;
  const material = await tx.material.update({
    where: { id: materialId },
    data: { standardUnitCost: cost, costUpdatedAt: new Date() },
  });
  await tx.auditEvent.create({ data: {
    tenantId: scope.tenantId, storeId: scope.storeId, actorStaffId: scope.actorStaffId,
    action: "MATERIAL_COST_UPDATED", entityType: "Material", entityId: material.id,
    beforeSnapshot: { code: current.code, standardUnitCost: decimalNumberOf(current.standardUnitCost) },
    afterSnapshot: { code: material.code, standardUnitCost: decimalNumberOf(material.standardUnitCost) },
  } });
  return material;
}

/**
 * Every relation that makes a material part of business history. A material with
 * any of them can only be disabled, never deleted.
 */
async function findMaterialReference(
  tx: Prisma.TransactionClient,
  materialId: string,
): Promise<string | null> {
  const where = { materialId };
  const checks: Array<[string, Promise<{ id: string } | null>]> = [
    ["InventoryBatch", tx.inventoryBatch.findFirst({ where, select: { id: true } })],
    ["OrderMaterialRequirement", tx.orderMaterialRequirement.findFirst({ where, select: { id: true } })],
    ["RecipeLine", tx.recipeLine.findFirst({ where, select: { id: true } })],
    ["PurchaseOrderLine", tx.purchaseOrderLine.findFirst({ where, select: { id: true } })],
    ["GoodsReceiptLine", tx.goodsReceiptLine.findFirst({
      where: { acceptedMaterialId: materialId }, select: { id: true },
    })],
    ["SampleMaterial", tx.sampleMaterial.findFirst({ where, select: { id: true } })],
    ["SamplePlanMaterial", tx.samplePlanMaterial.findFirst({ where, select: { id: true } })],
    ["SamplePlanStepMaterial", tx.samplePlanStepMaterial.findFirst({ where, select: { id: true } })],
    ["SampleDisassemblyMaterial", tx.sampleDisassemblyMaterial.findFirst({ where, select: { id: true } })],
    ["PackagingKitLine", tx.packagingKitLine.findFirst({ where, select: { id: true } })],
    ["LossRecord", tx.lossRecord.findFirst({ where, select: { id: true } })],
    ["AvailabilityHoldMaterial", tx.availabilityHoldMaterial.findFirst({ where, select: { id: true } })],
    ["SamplePlanInventorySnapshot", tx.samplePlanInventorySnapshot.findFirst({ where, select: { id: true } })],
  ];
  for (const [label, query] of checks) {
    if (await query) return label;
  }
  return null;
}

/**
 * Deletes a material that has never taken part in business data. Category links
 * are removed first; the material row and the audit event are the only writes.
 */
export async function deleteMaterial(
  tx: Prisma.TransactionClient,
  scope: Scope,
  materialIdInput: string,
) {
  const materialId = required(materialIdInput, "物料", 64);
  await tx.$queryRaw`SELECT id FROM "Material" WHERE id = ${materialId} FOR UPDATE`;
  const current = await tx.material.findFirst({ where: { id: materialId, tenantId: scope.tenantId } });
  if (!current) throw new Error("物料不存在或不属于当前租户");
  if (await findMaterialReference(tx, materialId)) {
    throw new Error(MATERIAL_DELETE_REFERENCED_MESSAGE);
  }
  await tx.materialCategoryRelation.deleteMany({ where: { materialId } });
  await tx.material.delete({ where: { id: materialId } });
  await tx.auditEvent.create({ data: {
    tenantId: scope.tenantId, storeId: scope.storeId, actorStaffId: scope.actorStaffId,
    action: "MATERIAL_DELETED", entityType: "Material", entityId: materialId,
    beforeSnapshot: {
      ...materialAuditSnapshot(current),
      imageKey: current.imageKey,
      defaultUsableRate: decimalNumberOf(current.defaultUsableRate),
      defaultLossRate: decimalNumberOf(current.defaultLossRate),
      lossMode: current.lossMode,
    },
  } });
  return current;
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
  /** Optional: `SUP-YYYYMMDD-XXXXXXXX` is generated when blank. Ignored on edit. */
  code?: string | null; name: string; contactName?: string | null; phone?: string | null;
  wechat?: string | null; notes?: string | null;
};

function validateSupplier(input: SupplierInput) {
  return {
    name: required(input.name, "供应商名称", 80),
    contactName: optional(input.contactName, 50, "联系人"),
    phone: optional(input.phone, 30, "联系电话"),
    wechat: optional(input.wechat, 50, "微信"),
    notes: optional(input.notes, 500, "备注"),
  };
}

export async function createSupplierMaster(tx: Prisma.TransactionClient, scope: Scope, input: SupplierInput) {
  const data = validateSupplier(input);
  const code = optionalMasterCode(input.code) ?? generateSupplierCode(new Date(), generateEntropy());
  if (await tx.supplier.findFirst({ where: { tenantId: scope.tenantId, code }, select: { id: true } })) {
    throw new Error("供应商编码已存在");
  }
  const supplier = await tx.supplier.create({ data: { tenantId: scope.tenantId, code, ...data } });
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
  // The supplier code is an immutable system identifier; edit input is ignored.
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
