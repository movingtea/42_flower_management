import { Prisma } from "@/generated/prisma/client";

export type DecimalInput = Prisma.Decimal | number | string | null | undefined;

export function money(value: DecimalInput = 0): Prisma.Decimal {
  if (value === null || value === undefined || value === "") {
    return new Prisma.Decimal(0);
  }
  return new Prisma.Decimal(value).toDecimalPlaces(2);
}

export function ratio(value: DecimalInput = 0): Prisma.Decimal {
  if (value === null || value === undefined || value === "") {
    return new Prisma.Decimal(0);
  }
  return new Prisma.Decimal(value).toDecimalPlaces(4);
}

export function decimalToString(value: DecimalInput = 0, places = 2): string {
  return new Prisma.Decimal(value ?? 0).toFixed(places);
}

export type FlowerCostInput = {
  stockLogId: string;
  batchId: string;
  batchNo: string | null;
  quantity: number;
  unitCost: DecimalInput;
  materialName: string;
  wikiName: string | null;
};

export type FlowerMaterialCostLine = {
  stockLogId: string;
  batchId: string;
  batchNo: string | null;
  quantity: number;
  unitCost: string;
  lineCost: string;
  materialName: string;
  wikiName: string;
};

export type PackagingCostInput = {
  orderItemId: string;
  skuId: string;
  productName: string;
  specName: string;
  quantity: number;
  recipeId: string | null;
  recipeName: string | null;
  packagingKitId: string | null;
  packagingKitName: string | null;
  standardCost: DecimalInput;
};

export type PackagingCostLine = {
  orderItemId: string;
  skuId: string;
  productName: string;
  specName: string;
  quantity: number;
  recipeId: string | null;
  recipeName: string | null;
  packagingKitId: string | null;
  packagingKitName: string | null;
  unitCost: string;
  lineCost: string;
};

export function calculateFlowerMaterialCostFromInputs(
  inputs: FlowerCostInput[]
): {
  totalCost: Prisma.Decimal;
  lines: FlowerMaterialCostLine[];
  warnings: string[];
} {
  let totalCost = money(0);
  const warnings: string[] = [];

  const lines = inputs.map((input) => {
    const safeQuantity = Number.isFinite(input.quantity) ? input.quantity : 0;
    const missingUnitCost = input.unitCost === null || input.unitCost === undefined;
    if (missingUnitCost) {
      warnings.push(
        `批次 ${input.batchNo ?? input.batchId} 缺少 unitCost，已按 0 计入花材成本`
      );
    }
    const unitCost = money(input.unitCost);
    const lineCost = money(unitCost.times(safeQuantity));
    totalCost = money(totalCost.plus(lineCost));

    return {
      stockLogId: input.stockLogId,
      batchId: input.batchId,
      batchNo: input.batchNo,
      quantity: safeQuantity,
      unitCost: decimalToString(unitCost),
      lineCost: decimalToString(lineCost),
      materialName: input.materialName,
      wikiName: input.wikiName?.trim() || input.materialName || "未知花材",
    };
  });

  return { totalCost, lines, warnings };
}

export function calculatePackagingCostFromInputs(
  inputs: PackagingCostInput[]
): {
  totalCost: Prisma.Decimal;
  lines: PackagingCostLine[];
  warnings: string[];
} {
  let totalCost = money(0);
  const warnings: string[] = [];
  const lines: PackagingCostLine[] = [];

  for (const input of inputs) {
    const label = `${input.productName}（${input.specName}）`;
    if (!input.recipeId) {
      warnings.push(`${label} 未绑定 Recipe，包装成本按 0 计算`);
      continue;
    }
    if (!input.packagingKitId) {
      warnings.push(
        `${label} 的配方「${input.recipeName ?? input.recipeId}」未绑定包装方案，包装成本按 0 计算`
      );
      continue;
    }

    const safeQuantity = Number.isFinite(input.quantity) ? input.quantity : 0;
    const unitCost = money(input.standardCost);
    const lineCost = money(unitCost.times(safeQuantity));
    totalCost = money(totalCost.plus(lineCost));
    lines.push({
      orderItemId: input.orderItemId,
      skuId: input.skuId,
      productName: input.productName,
      specName: input.specName,
      quantity: safeQuantity,
      recipeId: input.recipeId,
      recipeName: input.recipeName,
      packagingKitId: input.packagingKitId,
      packagingKitName: input.packagingKitName,
      unitCost: decimalToString(unitCost),
      lineCost: decimalToString(lineCost),
    });
  }

  return { totalCost, lines, warnings };
}

export function calculateGrossValues(input: {
  paidAmount: DecimalInput;
  flowerMaterialCost: DecimalInput;
  packagingCost: DecimalInput;
  deliveryCostActual?: DecimalInput;
  platformFee?: DecimalInput;
  floristLaborCost?: DecimalInput;
  otherCost?: DecimalInput;
}): {
  totalCost: Prisma.Decimal;
  grossProfit: Prisma.Decimal;
  grossMargin: Prisma.Decimal;
} {
  const paidAmount = money(input.paidAmount);
  const totalCost = money(
    money(input.flowerMaterialCost)
      .plus(money(input.packagingCost))
      .plus(money(input.deliveryCostActual))
      .plus(money(input.platformFee))
      .plus(money(input.floristLaborCost))
      .plus(money(input.otherCost))
  );
  const grossProfit = money(paidAmount.minus(totalCost));
  const grossMargin = paidAmount.greaterThan(0)
    ? ratio(grossProfit.div(paidAmount))
    : ratio(0);

  return { totalCost, grossProfit, grossMargin };
}
