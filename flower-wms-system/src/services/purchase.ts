import { Prisma } from "@/generated/prisma/client";
import {
  PurchaseCostAllocationMethod,
  PurchaseOrderStatus,
  StockLogType,
  SupplierType,
} from "@/generated/prisma/enums";
import type { OperatorContext } from "@/lib/operator-context";
import { prisma } from "@/lib/prisma";
import { assertStockMutationOperatorMatches } from "@/lib/stock-mutation-auth";
import { generateBatchNo } from "@/utils/batch-no";
import { generateUniqueSku } from "@/utils/skuGenerator";
import {
  calculatePurchaseOrderTotals,
  money,
  quantity,
  type PurchaseOrderCalcLine,
  type PurchaseOrderTotalsInput,
} from "@/services/purchase-pure";

export { calculatePurchaseOrderTotals } from "@/services/purchase-pure";

type Tx = Prisma.TransactionClient;
type DbClient = Tx | typeof prisma;

type PurchaseOrderLineWriteInput = {
  flowerWikiId: string;
  purchaseName?: string | null;
  grade?: string | null;
  color?: string | null;
  spec?: string | null;
  purchaseQuantity: Prisma.Decimal;
  purchaseUnit: string;
  stemsPerUnit: Prisma.Decimal;
  unitPrice: Prisma.Decimal;
  supplierSkuName?: string | null;
  note?: string | null;
};

type PurchaseOrderWriteInput = {
  supplierId: string;
  purchaseDate: Date;
  expectedArrivalDate?: Date | null;
  status?: PurchaseOrderStatus;
  shippingFee: Prisma.Decimal;
  packagingFee: Prisma.Decimal;
  otherFee: Prisma.Decimal;
  allocationMethod: PurchaseCostAllocationMethod;
  note?: string | null;
  lines: PurchaseOrderLineWriteInput[];
};

export type SupplierListParams = {
  q?: string | null;
  isActive?: boolean | null;
  supplierType?: SupplierType | null;
};

export type PurchaseOrderListParams = {
  q?: string | null;
  status?: PurchaseOrderStatus | null;
  supplierId?: string | null;
  startDate?: string | Date | null;
  endDate?: string | Date | null;
  page?: number | string | null;
  pageSize?: number | string | null;
};

export type ReceivePurchaseOrderOptions = {
  receivedAt?: string | Date | null;
  operator: OperatorContext;
};

type BatchRow = {
  id: string;
  materialId: string;
  batchNo: string | null;
  inboundAt: Date;
  originalQty: number;
  remainingQty: number;
  unitCost: Prisma.Decimal;
  expiresAt: Date | null;
  supplier: string | null;
};

type StockLogRow = {
  id: string;
  materialId: string;
  batchId: string;
  type: StockLogType;
  delta: number;
  quantity: number;
  remark: string | null;
  operator: string | null;
  operatorStaffId: string | null;
  createdAt: Date;
};

const PURCHASE_NO_PATTERN = /^PO-(\d{8})-(\d{3})$/;

const purchaseOrderInclude = {
  supplier: true,
  lines: {
    orderBy: { createdAt: "asc" },
    include: {
      flowerWiki: {
        select: {
          id: true,
          chineseName: true,
          englishName: true,
          colorTags: true,
          defaultShelfLifeDays: true,
        },
      },
      inboundBatch: {
        select: {
          id: true,
          batchNo: true,
          inboundAt: true,
          originalQty: true,
          remainingQty: true,
          unitCost: true,
        },
      },
    },
  },
} as const;

function cleanString(raw: unknown): string {
  return typeof raw === "string" ? raw.trim() : "";
}

function optionalString(raw: unknown): string | null | undefined {
  if (raw === undefined) return undefined;
  if (raw === null) return null;
  return typeof raw === "string" ? raw.trim() || null : null;
}

function requiredString(raw: unknown, message: string): string {
  const value = cleanString(raw);
  if (!value) throw new Error(message);
  return value;
}

function parseDate(raw: unknown, message: string): Date {
  if (raw instanceof Date && !Number.isNaN(raw.getTime())) return raw;
  if (typeof raw !== "string" && typeof raw !== "number") {
    throw new Error(message);
  }
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) throw new Error(message);
  return date;
}

function parseOptionalDate(raw: unknown): Date | null | undefined {
  if (raw === undefined) return undefined;
  if (raw === null || raw === "") return null;
  return parseDate(raw, "日期格式不正确");
}

function parseNonNegativeMoney(raw: unknown, label: string): Prisma.Decimal {
  const value = money(raw as Prisma.Decimal | number | string | null | undefined);
  if (value.isNegative()) throw new Error(`${label}不能小于 0`);
  return value;
}

function parsePositiveQuantity(raw: unknown, label: string): Prisma.Decimal {
  const value = quantity(raw as Prisma.Decimal | number | string | null | undefined);
  if (!value.gt(0)) throw new Error(`${label}必须大于 0`);
  return value;
}

function parseSupplierType(raw: unknown): SupplierType {
  const value = cleanString(raw);
  if (!Object.values(SupplierType).includes(value as SupplierType)) {
    throw new Error("请选择正确的供应商类型");
  }
  return value as SupplierType;
}

function parseOptionalSupplierType(raw: unknown): SupplierType | undefined {
  if (raw === undefined || raw === null || raw === "") return undefined;
  return parseSupplierType(raw);
}

function parseOptionalBoolean(raw: unknown): boolean | undefined {
  if (raw === undefined || raw === null || raw === "") return undefined;
  if (typeof raw === "boolean") return raw;
  if (raw === "true") return true;
  if (raw === "false") return false;
  throw new Error("isActive 参数格式不正确");
}

function parseAllocationMethod(raw: unknown): PurchaseCostAllocationMethod {
  if (raw === undefined || raw === null || raw === "") {
    return PurchaseCostAllocationMethod.BY_AMOUNT;
  }
  const value = cleanString(raw);
  if (
    !Object.values(PurchaseCostAllocationMethod).includes(
      value as PurchaseCostAllocationMethod
    )
  ) {
    throw new Error("请选择正确的费用分摊方式");
  }
  return value as PurchaseCostAllocationMethod;
}

function parseWritableStatus(raw: unknown): PurchaseOrderStatus | undefined {
  if (raw === undefined || raw === null || raw === "") return undefined;
  const value = cleanString(raw);
  if (
    value !== PurchaseOrderStatus.DRAFT &&
    value !== PurchaseOrderStatus.ORDERED
  ) {
    throw new Error("采购单状态只能保存为草稿或已下单");
  }
  return value as PurchaseOrderStatus;
}

function parsePurchaseLine(raw: unknown, index: number): PurchaseOrderLineWriteInput {
  if (!raw || typeof raw !== "object") {
    throw new Error(`第 ${index + 1} 行采购明细格式不正确`);
  }
  const row = raw as Record<string, unknown>;
  return {
    flowerWikiId: requiredString(row.flowerWikiId, "花材不存在，请先在花材母表中创建"),
    purchaseName: optionalString(row.purchaseName),
    grade: optionalString(row.grade),
    color: optionalString(row.color),
    spec: optionalString(row.spec),
    purchaseQuantity: parsePositiveQuantity(row.purchaseQuantity, "采购数量"),
    purchaseUnit: requiredString(row.purchaseUnit, "采购单位不能为空"),
    stemsPerUnit: parsePositiveQuantity(row.stemsPerUnit, "折算支数"),
    unitPrice: parseNonNegativeMoney(row.unitPrice, "采购单价"),
    supplierSkuName: optionalString(row.supplierSkuName),
    note: optionalString(row.note),
  };
}

function parsePurchaseOrderInput(raw: unknown): PurchaseOrderWriteInput {
  if (!raw || typeof raw !== "object") {
    throw new Error("请求体须为 JSON 对象");
  }
  const body = raw as Record<string, unknown>;
  const linesRaw = body.lines;
  if (!Array.isArray(linesRaw) || linesRaw.length === 0) {
    throw new Error("请至少添加一条采购明细");
  }
  const lines = linesRaw.map((line, index) => parsePurchaseLine(line, index));

  return {
    supplierId: requiredString(body.supplierId, "供应商不能为空"),
    purchaseDate: parseDate(body.purchaseDate, "采购日期不能为空"),
    expectedArrivalDate: parseOptionalDate(body.expectedArrivalDate),
    status: parseWritableStatus(body.status),
    shippingFee: parseNonNegativeMoney(body.shippingFee, "运费"),
    packagingFee: parseNonNegativeMoney(body.packagingFee, "包装费"),
    otherFee: parseNonNegativeMoney(body.otherFee, "其他费用"),
    allocationMethod: parseAllocationMethod(body.allocationMethod),
    note: optionalString(body.note),
    lines,
  };
}

function purchaseLineForCalc(
  line: PurchaseOrderLineWriteInput
): PurchaseOrderTotalsInput["lines"][number] {
  return {
    flowerWikiId: line.flowerWikiId,
    purchaseName: line.purchaseName,
    grade: line.grade,
    color: line.color,
    spec: line.spec,
    purchaseQuantity: line.purchaseQuantity,
    purchaseUnit: line.purchaseUnit,
    stemsPerUnit: line.stemsPerUnit,
    unitPrice: line.unitPrice,
    supplierSkuName: line.supplierSkuName,
    note: line.note,
  };
}

export function validatePurchaseOrderInput(raw: unknown): PurchaseOrderWriteInput {
  return parsePurchaseOrderInput(raw);
}

export function formatPurchaseDateKey(date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}${m}${d}`;
}

export async function generatePurchaseNo(
  client: DbClient = prisma,
  date = new Date()
): Promise<string> {
  const dateKey = formatPurchaseDateKey(date);
  const prefix = `PO-${dateKey}-`;
  const latest = await client.purchaseOrder.findFirst({
    where: { purchaseNo: { startsWith: prefix } },
    orderBy: { purchaseNo: "desc" },
    select: { purchaseNo: true },
  });

  let nextSeq = 1;
  if (latest?.purchaseNo) {
    const match = PURCHASE_NO_PATTERN.exec(latest.purchaseNo);
    if (match && match[1] === dateKey) {
      nextSeq = Number.parseInt(match[2], 10) + 1;
    }
  }

  if (nextSeq > 999) {
    throw new Error("当日采购单流水号已用尽，请明日再试");
  }

  return `${prefix}${String(nextSeq).padStart(3, "0")}`;
}

async function assertActiveSupplier(tx: DbClient, supplierId: string) {
  const supplier = await tx.supplier.findFirst({
    where: { id: supplierId, isActive: true },
    select: { id: true },
  });
  if (!supplier) throw new Error("供应商不存在或已停用");
}

async function assertFlowerWikiIdsExist(tx: DbClient, lines: PurchaseOrderLineWriteInput[]) {
  const ids = Array.from(new Set(lines.map((line) => line.flowerWikiId)));
  const found = await tx.flowerWiki.findMany({
    where: { id: { in: ids } },
    select: { id: true },
  });
  if (found.length !== ids.length) {
    throw new Error("花材不存在，请先在花材母表中创建");
  }
}

function buildCalculatedLines(input: PurchaseOrderWriteInput) {
  return calculatePurchaseOrderTotals({
    lines: input.lines.map(purchaseLineForCalc),
    shippingFee: input.shippingFee,
    packagingFee: input.packagingFee,
    otherFee: input.otherFee,
    allocationMethod: input.allocationMethod,
  });
}

function lineCreateData(purchaseOrderId: string, line: PurchaseOrderCalcLine) {
  return {
    purchaseOrderId,
    flowerWikiId: line.flowerWikiId,
    purchaseName: line.purchaseName ?? null,
    grade: line.grade ?? null,
    color: line.color ?? null,
    spec: line.spec ?? null,
    purchaseQuantity: line.purchaseQuantity,
    purchaseUnit: line.purchaseUnit,
    stemsPerUnit: line.stemsPerUnit,
    totalStems: line.totalStems,
    unitPrice: line.unitPrice,
    lineAmount: line.lineAmount,
    allocatedExtraFee: line.allocatedExtraFee,
    actualTotalCost: line.actualTotalCost,
    actualUnitCost: line.actualUnitCost,
    supplierSkuName: line.supplierSkuName ?? null,
    note: line.note ?? null,
  };
}

async function loadPurchaseOrderById(id: string, tx: DbClient = prisma) {
  const purchaseOrder = await tx.purchaseOrder.findUnique({
    where: { id },
    include: purchaseOrderInclude,
  });
  if (!purchaseOrder) throw new Error("采购单不存在");
  return serializePurchaseOrder(purchaseOrder);
}

function serializeSupplier(row: {
  id: string;
  name: string;
  supplierType: SupplierType;
  contactName: string | null;
  phone: string | null;
  wechat: string | null;
  address: string | null;
  note: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: row.id,
    name: row.name,
    supplierType: row.supplierType,
    contactName: row.contactName,
    phone: row.phone,
    wechat: row.wechat,
    address: row.address,
    note: row.note,
    isActive: row.isActive,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function serializePurchaseOrder(row: Prisma.PurchaseOrderGetPayload<{
  include: typeof purchaseOrderInclude;
}>) {
  return {
    id: row.id,
    purchaseNo: row.purchaseNo,
    supplierId: row.supplierId,
    supplier: serializeSupplier(row.supplier),
    purchaseDate: row.purchaseDate.toISOString(),
    expectedArrivalDate: row.expectedArrivalDate?.toISOString() ?? null,
    receivedAt: row.receivedAt?.toISOString() ?? null,
    status: row.status,
    goodsAmount: row.goodsAmount.toFixed(2),
    shippingFee: row.shippingFee.toFixed(2),
    packagingFee: row.packagingFee.toFixed(2),
    otherFee: row.otherFee.toFixed(2),
    totalExtraFee: row.totalExtraFee.toFixed(2),
    totalAmount: row.totalAmount.toFixed(2),
    allocationMethod: row.allocationMethod,
    note: row.note,
    lines: row.lines.map((line) => ({
      id: line.id,
      purchaseOrderId: line.purchaseOrderId,
      flowerWikiId: line.flowerWikiId,
      flowerWiki: line.flowerWiki,
      purchaseName: line.purchaseName,
      grade: line.grade,
      color: line.color,
      spec: line.spec,
      purchaseQuantity: line.purchaseQuantity.toFixed(2),
      purchaseUnit: line.purchaseUnit,
      stemsPerUnit: line.stemsPerUnit.toFixed(2),
      totalStems: line.totalStems.toFixed(2),
      unitPrice: line.unitPrice.toFixed(2),
      lineAmount: line.lineAmount.toFixed(2),
      allocatedExtraFee: line.allocatedExtraFee.toFixed(2),
      actualTotalCost: line.actualTotalCost.toFixed(2),
      actualUnitCost: line.actualUnitCost.toFixed(4),
      supplierSkuName: line.supplierSkuName,
      note: line.note,
      inboundBatchId: line.inboundBatchId,
      inboundBatch: line.inboundBatch
        ? {
            id: line.inboundBatch.id,
            batchNo: line.inboundBatch.batchNo,
            inboundAt: line.inboundBatch.inboundAt.toISOString(),
            originalQty: line.inboundBatch.originalQty,
            remainingQty: line.inboundBatch.remainingQty,
            unitCost: line.inboundBatch.unitCost.toFixed(4),
          }
        : null,
      createdAt: line.createdAt.toISOString(),
      updatedAt: line.updatedAt.toISOString(),
    })),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function serializePurchaseOrderListItem(row: Prisma.PurchaseOrderGetPayload<{
  include: {
    supplier: true;
    _count: { select: { lines: true } };
  };
}>) {
  return {
    id: row.id,
    purchaseNo: row.purchaseNo,
    supplierId: row.supplierId,
    supplier: serializeSupplier(row.supplier),
    lineCount: row._count.lines,
    goodsAmount: row.goodsAmount.toFixed(2),
    shippingFee: row.shippingFee.toFixed(2),
    packagingFee: row.packagingFee.toFixed(2),
    otherFee: row.otherFee.toFixed(2),
    totalAmount: row.totalAmount.toFixed(2),
    status: row.status,
    purchaseDate: row.purchaseDate.toISOString(),
    receivedAt: row.receivedAt?.toISOString() ?? null,
    note: row.note,
  };
}

export async function listSuppliers(params: SupplierListParams = {}) {
  const where: Prisma.SupplierWhereInput = {};
  const q = params.q?.trim();
  if (q) {
    where.OR = [
      { name: { contains: q, mode: "insensitive" } },
      { contactName: { contains: q, mode: "insensitive" } },
      { phone: { contains: q, mode: "insensitive" } },
      { wechat: { contains: q, mode: "insensitive" } },
      { note: { contains: q, mode: "insensitive" } },
    ];
  }
  if (params.isActive !== undefined && params.isActive !== null) {
    where.isActive = params.isActive;
  }
  if (params.supplierType) {
    where.supplierType = params.supplierType;
  }

  const suppliers = await prisma.supplier.findMany({
    where,
    orderBy: [{ isActive: "desc" }, { updatedAt: "desc" }],
  });
  return suppliers.map(serializeSupplier);
}

export async function getSupplierById(id: string) {
  const supplier = await prisma.supplier.findUnique({ where: { id } });
  if (!supplier) throw new Error("供应商不存在");
  return serializeSupplier(supplier);
}

export async function createSupplier(raw: unknown) {
  if (!raw || typeof raw !== "object") throw new Error("请求体须为 JSON 对象");
  const body = raw as Record<string, unknown>;
  const supplier = await prisma.supplier.create({
    data: {
      name: requiredString(body.name, "供应商名称不能为空"),
      supplierType: parseSupplierType(body.supplierType),
      contactName: optionalString(body.contactName) ?? null,
      phone: optionalString(body.phone) ?? null,
      wechat: optionalString(body.wechat) ?? null,
      address: optionalString(body.address) ?? null,
      note: optionalString(body.note) ?? null,
      isActive: parseOptionalBoolean(body.isActive) ?? true,
    },
  });
  return serializeSupplier(supplier);
}

export async function updateSupplier(id: string, raw: unknown) {
  if (!raw || typeof raw !== "object") throw new Error("请求体须为 JSON 对象");
  const body = raw as Record<string, unknown>;
  await getSupplierById(id);
  const supplier = await prisma.supplier.update({
    where: { id },
    data: {
      ...(body.name !== undefined
        ? { name: requiredString(body.name, "供应商名称不能为空") }
        : {}),
      ...(body.supplierType !== undefined
        ? { supplierType: parseSupplierType(body.supplierType) }
        : {}),
      ...(body.contactName !== undefined
        ? { contactName: optionalString(body.contactName) ?? null }
        : {}),
      ...(body.phone !== undefined
        ? { phone: optionalString(body.phone) ?? null }
        : {}),
      ...(body.wechat !== undefined
        ? { wechat: optionalString(body.wechat) ?? null }
        : {}),
      ...(body.address !== undefined
        ? { address: optionalString(body.address) ?? null }
        : {}),
      ...(body.note !== undefined
        ? { note: optionalString(body.note) ?? null }
        : {}),
      ...(body.isActive !== undefined
        ? { isActive: parseOptionalBoolean(body.isActive) ?? true }
        : {}),
    },
  });
  return serializeSupplier(supplier);
}

export async function deactivateSupplier(id: string) {
  await getSupplierById(id);
  const supplier = await prisma.supplier.update({
    where: { id },
    data: { isActive: false },
  });
  return serializeSupplier(supplier);
}

export async function createPurchaseOrder(raw: unknown) {
  const input = validatePurchaseOrderInput(raw);
  const calculated = buildCalculatedLines(input);
  const maxAttempts = 5;
  let lastError: unknown;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await prisma.$transaction(
        async (tx) => {
          await assertActiveSupplier(tx, input.supplierId);
          await assertFlowerWikiIdsExist(tx, input.lines);
          const purchaseNo = await generatePurchaseNo(tx, input.purchaseDate);
          const purchaseOrder = await tx.purchaseOrder.create({
            data: {
              purchaseNo,
              supplierId: input.supplierId,
              purchaseDate: input.purchaseDate,
              expectedArrivalDate: input.expectedArrivalDate ?? null,
              status: input.status ?? PurchaseOrderStatus.DRAFT,
              goodsAmount: calculated.goodsAmount,
              shippingFee: calculated.shippingFee,
              packagingFee: calculated.packagingFee,
              otherFee: calculated.otherFee,
              totalExtraFee: calculated.totalExtraFee,
              totalAmount: calculated.totalAmount,
              allocationMethod: calculated.allocationMethod,
              note: input.note ?? null,
            },
            select: { id: true },
          });

          await tx.purchaseOrderLine.createMany({
            data: calculated.lines.map((line) =>
              lineCreateData(purchaseOrder.id, line)
            ),
          });

          return loadPurchaseOrderById(purchaseOrder.id, tx);
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
      );
    } catch (err) {
      lastError = err;
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === "P2002"
      ) {
        continue;
      }
      throw err;
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("采购单号生成冲突，请重试");
}

function buildUpdateInput(existing: Awaited<ReturnType<typeof getPurchaseOrderById>>, raw: unknown) {
  if (!raw || typeof raw !== "object") throw new Error("请求体须为 JSON 对象");
  const body = raw as Record<string, unknown>;
  return {
    supplierId: body.supplierId ?? existing.supplierId,
    purchaseDate: body.purchaseDate ?? existing.purchaseDate,
    expectedArrivalDate:
      body.expectedArrivalDate !== undefined
        ? body.expectedArrivalDate
        : existing.expectedArrivalDate,
    status: body.status ?? existing.status,
    shippingFee: body.shippingFee ?? existing.shippingFee,
    packagingFee: body.packagingFee ?? existing.packagingFee,
    otherFee: body.otherFee ?? existing.otherFee,
    allocationMethod: body.allocationMethod ?? existing.allocationMethod,
    note: body.note !== undefined ? body.note : existing.note,
    lines:
      body.lines ??
      existing.lines.map((line) => ({
        flowerWikiId: line.flowerWikiId,
        purchaseName: line.purchaseName,
        grade: line.grade,
        color: line.color,
        spec: line.spec,
        purchaseQuantity: line.purchaseQuantity,
        purchaseUnit: line.purchaseUnit,
        stemsPerUnit: line.stemsPerUnit,
        unitPrice: line.unitPrice,
        supplierSkuName: line.supplierSkuName,
        note: line.note,
      })),
  };
}

export async function updatePurchaseOrder(id: string, raw: unknown) {
  const existing = await getPurchaseOrderById(id);
  if (existing.status === PurchaseOrderStatus.RECEIVED) {
    throw new Error("已入库采购单不能修改");
  }
  if (existing.status === PurchaseOrderStatus.CANCELLED) {
    throw new Error("已取消采购单不能修改");
  }
  const input = validatePurchaseOrderInput(buildUpdateInput(existing, raw));
  const calculated = buildCalculatedLines(input);

  return prisma.$transaction(async (tx) => {
    if (input.supplierId !== existing.supplierId) {
      await assertActiveSupplier(tx, input.supplierId);
    }
    await assertFlowerWikiIdsExist(tx, input.lines);
    await tx.purchaseOrder.update({
      where: { id },
      data: {
        supplierId: input.supplierId,
        purchaseDate: input.purchaseDate,
        expectedArrivalDate: input.expectedArrivalDate ?? null,
        status: input.status ?? existing.status,
        goodsAmount: calculated.goodsAmount,
        shippingFee: calculated.shippingFee,
        packagingFee: calculated.packagingFee,
        otherFee: calculated.otherFee,
        totalExtraFee: calculated.totalExtraFee,
        totalAmount: calculated.totalAmount,
        allocationMethod: calculated.allocationMethod,
        note: input.note ?? null,
      },
    });
    await tx.purchaseOrderLine.deleteMany({ where: { purchaseOrderId: id } });
    await tx.purchaseOrderLine.createMany({
      data: calculated.lines.map((line) => lineCreateData(id, line)),
    });
    return loadPurchaseOrderById(id, tx);
  });
}

export async function listPurchaseOrders(params: PurchaseOrderListParams = {}) {
  const page = Math.max(1, Number(params.page ?? 1) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(params.pageSize ?? 20) || 20));
  const where: Prisma.PurchaseOrderWhereInput = {};
  const q = params.q?.trim();
  if (q) {
    where.OR = [
      { purchaseNo: { contains: q, mode: "insensitive" } },
      { note: { contains: q, mode: "insensitive" } },
      { supplier: { name: { contains: q, mode: "insensitive" } } },
    ];
  }
  if (params.status) where.status = params.status;
  if (params.supplierId?.trim()) where.supplierId = params.supplierId.trim();
  if (params.startDate || params.endDate) {
    where.purchaseDate = {};
    if (params.startDate) {
      where.purchaseDate.gte = parseDate(params.startDate, "开始日期格式不正确");
    }
    if (params.endDate) {
      where.purchaseDate.lte = parseDate(params.endDate, "结束日期格式不正确");
    }
  }

  const [items, total] = await prisma.$transaction([
    prisma.purchaseOrder.findMany({
      where,
      include: { supplier: true, _count: { select: { lines: true } } },
      orderBy: { purchaseDate: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.purchaseOrder.count({ where }),
  ]);

  return {
    items: items.map(serializePurchaseOrderListItem),
    total,
    page,
    pageSize,
  };
}

export async function getPurchaseOrderById(id: string) {
  return loadPurchaseOrderById(id);
}

export async function cancelPurchaseOrder(id: string) {
  const existing = await prisma.purchaseOrder.findUnique({
    where: { id },
    select: { id: true, status: true },
  });
  if (!existing) throw new Error("采购单不存在");
  if (existing.status === PurchaseOrderStatus.RECEIVED) {
    throw new Error("已入库采购单不能取消");
  }
  if (existing.status === PurchaseOrderStatus.CANCELLED) {
    return getPurchaseOrderById(id);
  }
  await prisma.purchaseOrder.update({
    where: { id },
    data: { status: PurchaseOrderStatus.CANCELLED },
  });
  return getPurchaseOrderById(id);
}

async function resolveOrCreateMaterial(tx: Tx, flowerWikiId: string) {
  const wiki = await tx.flowerWiki.findUnique({
    where: { id: flowerWikiId },
    select: { id: true, chineseName: true },
  });
  if (!wiki) throw new Error("花材不存在，请先在花材母表中创建");

  let material = await tx.material.findFirst({ where: { wikiId: flowerWikiId } });
  if (!material) {
    const materialCode = await generateUniqueSku("material", tx);
    material = await tx.material.create({
      data: {
        materialCode,
        name: wiki.chineseName,
        unit: "支",
        wikiId: flowerWikiId,
      },
    });
  }
  return material;
}

function resolveBatchExpiresAt(inboundAt: Date, shelfLifeDays?: number | null) {
  if (!shelfLifeDays || shelfLifeDays <= 0) return null;
  return new Date(inboundAt.getTime() + shelfLifeDays * 24 * 60 * 60 * 1000);
}

function decimalStemsToInt(value: Prisma.Decimal, lineLabel: string): number {
  if (!value.gt(0)) throw new Error(`${lineLabel}入库支数必须大于 0`);
  const n = value.toNumber();
  if (!Number.isInteger(n)) {
    throw new Error(`${lineLabel}折算后的总支数必须是整数，才能生成库存批次`);
  }
  return n;
}

function serializeBatch(row: BatchRow) {
  return {
    id: row.id,
    materialId: row.materialId,
    batchNo: row.batchNo,
    inboundAt: row.inboundAt.toISOString(),
    originalQty: row.originalQty,
    remainingQty: row.remainingQty,
    unitCost: row.unitCost.toFixed(4),
    expiresAt: row.expiresAt?.toISOString() ?? null,
    supplier: row.supplier,
  };
}

function serializeStockLog(row: StockLogRow) {
  return {
    id: row.id,
    materialId: row.materialId,
    batchId: row.batchId,
    type: row.type,
    delta: row.delta,
    quantity: row.quantity,
    remark: row.remark,
    operator: row.operator,
    operatorStaffId: row.operatorStaffId,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function receivePurchaseOrder(
  id: string,
  options: ReceivePurchaseOrderOptions
) {
  if (!options?.operator) throw new Error("操作员不能为空");
  const operator = await assertStockMutationOperatorMatches(
    "wms:write",
    options.operator
  );
  const receivedAt = options.receivedAt
    ? parseDate(options.receivedAt, "到货日期格式不正确")
    : new Date();

  return prisma.$transaction(async (tx) => {
    const purchaseOrder = await tx.purchaseOrder.findUnique({
      where: { id },
      include: purchaseOrderInclude,
    });
    if (!purchaseOrder) throw new Error("采购单不存在");
    if (purchaseOrder.status === PurchaseOrderStatus.CANCELLED) {
      throw new Error("已取消采购单不能入库");
    }
    if (purchaseOrder.status === PurchaseOrderStatus.RECEIVED) {
      throw new Error("采购单已入库，不能重复入库");
    }
    if (purchaseOrder.lines.length === 0) {
      throw new Error("采购单没有明细，不能入库");
    }
    if (purchaseOrder.lines.some((line) => line.inboundBatchId)) {
      throw new Error("采购单明细已存在入库批次，不能重复入库");
    }

    const createdBatches: BatchRow[] = [];
    const stockLogs: StockLogRow[] = [];
    const remark = `采购单入库：${purchaseOrder.purchaseNo}`;

    for (const [index, line] of purchaseOrder.lines.entries()) {
      const lineLabel = `第 ${index + 1} 行`;
      const totalStems = decimalStemsToInt(line.totalStems, lineLabel);
      const material = await resolveOrCreateMaterial(tx, line.flowerWikiId);
      const batchNo = await generateBatchNo(tx);
      const expiresAt = resolveBatchExpiresAt(
        receivedAt,
        line.flowerWiki.defaultShelfLifeDays
      );
      const batch = await tx.batch.create({
        data: {
          materialId: material.id,
          batchNo,
          inboundAt: receivedAt,
          originalQty: totalStems,
          remainingQty: totalStems,
          unitCost: line.actualUnitCost,
          expiresAt,
          supplier: purchaseOrder.supplier.name,
          note: remark,
        },
      });
      const stockLog = await tx.stockLog.create({
        data: {
          materialId: material.id,
          batchId: batch.id,
          type: StockLogType.INBOUND,
          delta: totalStems,
          quantity: totalStems,
          remark,
          operator: operator.operatorLabel,
          operatorStaffId: operator.operatorStaffId,
        },
      });
      await tx.purchaseOrderLine.update({
        where: { id: line.id },
        data: { inboundBatchId: batch.id },
      });
      createdBatches.push(batch);
      stockLogs.push(stockLog);
    }

    await tx.purchaseOrder.update({
      where: { id },
      data: {
        status: PurchaseOrderStatus.RECEIVED,
        receivedAt,
      },
    });

    return {
      purchaseOrder: await loadPurchaseOrderById(id, tx),
      createdBatches: createdBatches.map(serializeBatch),
      stockLogs: stockLogs.map(serializeStockLog),
    };
  });
}

export async function updateFlowerStandardCostFromPurchaseLine(lineId: string) {
  const line = await prisma.purchaseOrderLine.findUnique({
    where: { id: lineId },
    include: {
      purchaseOrder: { select: { purchaseNo: true, status: true } },
    },
  });
  if (!line) throw new Error("采购明细不存在");
  if (line.purchaseOrder.status !== PurchaseOrderStatus.RECEIVED) {
    throw new Error("只有已入库采购单的明细才能更新标准成本");
  }
  const wiki = await prisma.flowerWiki.update({
    where: { id: line.flowerWikiId },
    data: {
      standardUnitCost: line.actualUnitCost,
      costUpdatedAt: new Date(),
      costNote: `来自采购单 ${line.purchaseOrder.purchaseNo}`,
    },
    select: {
      id: true,
      chineseName: true,
      standardUnitCost: true,
      costUpdatedAt: true,
      costNote: true,
    },
  });
  return {
    ...wiki,
    standardUnitCost: wiki.standardUnitCost?.toFixed(4) ?? null,
    costUpdatedAt: wiki.costUpdatedAt?.toISOString() ?? null,
  };
}

export function parseSupplierListSearchParams(searchParams: URLSearchParams) {
  return {
    q: searchParams.get("q"),
    isActive: parseOptionalBoolean(searchParams.get("isActive")),
    supplierType: parseOptionalSupplierType(searchParams.get("supplierType")),
  };
}

export function parsePurchaseOrderListSearchParams(searchParams: URLSearchParams) {
  const statusRaw = searchParams.get("status");
  const status =
    statusRaw && Object.values(PurchaseOrderStatus).includes(statusRaw as PurchaseOrderStatus)
      ? (statusRaw as PurchaseOrderStatus)
      : null;
  if (statusRaw && !status) throw new Error("采购单状态参数不正确");
  return {
    q: searchParams.get("q"),
    status,
    supplierId: searchParams.get("supplierId"),
    startDate: searchParams.get("startDate"),
    endDate: searchParams.get("endDate"),
    page: searchParams.get("page"),
    pageSize: searchParams.get("pageSize"),
  };
}
