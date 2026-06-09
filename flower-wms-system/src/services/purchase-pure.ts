import { Prisma } from "@/generated/prisma/client";
import { PurchaseCostAllocationMethod } from "@/generated/prisma/enums";

export type DecimalInput = Prisma.Decimal | number | string | null | undefined;

export type PurchaseOrderCalcLineInput = {
  flowerWikiId: string;
  purchaseName?: string | null;
  grade?: string | null;
  color?: string | null;
  spec?: string | null;
  purchaseQuantity: DecimalInput;
  purchaseUnit: string;
  stemsPerUnit: DecimalInput;
  unitPrice: DecimalInput;
  supplierSkuName?: string | null;
  note?: string | null;
};

export type PurchaseOrderTotalsInput = {
  lines: PurchaseOrderCalcLineInput[];
  shippingFee?: DecimalInput;
  packagingFee?: DecimalInput;
  otherFee?: DecimalInput;
  allocationMethod?: PurchaseCostAllocationMethod;
};

export type PurchaseOrderCalcLine = PurchaseOrderCalcLineInput & {
  purchaseQuantity: Prisma.Decimal;
  stemsPerUnit: Prisma.Decimal;
  unitPrice: Prisma.Decimal;
  totalStems: Prisma.Decimal;
  lineAmount: Prisma.Decimal;
  allocatedExtraFee: Prisma.Decimal;
  actualTotalCost: Prisma.Decimal;
  actualUnitCost: Prisma.Decimal;
};

export type PurchaseOrderTotalsResult = {
  goodsAmount: Prisma.Decimal;
  shippingFee: Prisma.Decimal;
  packagingFee: Prisma.Decimal;
  otherFee: Prisma.Decimal;
  totalExtraFee: Prisma.Decimal;
  totalAmount: Prisma.Decimal;
  allocationMethod: PurchaseCostAllocationMethod;
  lines: PurchaseOrderCalcLine[];
  warnings: string[];
};

export function decimal(value: DecimalInput = 0): Prisma.Decimal {
  if (value === null || value === undefined || value === "") {
    return new Prisma.Decimal(0);
  }
  return new Prisma.Decimal(value);
}

export function money(value: DecimalInput = 0): Prisma.Decimal {
  return decimal(value).toDecimalPlaces(2);
}

export function quantity(value: DecimalInput = 0): Prisma.Decimal {
  return decimal(value).toDecimalPlaces(2);
}

export function unitCost(value: DecimalInput = 0): Prisma.Decimal {
  return decimal(value).toDecimalPlaces(4);
}

function allocationBaseTotal(
  lines: PurchaseOrderCalcLine[],
  allocationMethod: PurchaseCostAllocationMethod
): Prisma.Decimal {
  if (allocationMethod === PurchaseCostAllocationMethod.BY_QUANTITY) {
    return lines.reduce(
      (sum, line) => sum.plus(line.totalStems),
      new Prisma.Decimal(0)
    );
  }
  return lines.reduce(
    (sum, line) => sum.plus(line.lineAmount),
    new Prisma.Decimal(0)
  );
}

function allocationBaseForLine(
  line: PurchaseOrderCalcLine,
  allocationMethod: PurchaseCostAllocationMethod
): Prisma.Decimal {
  if (allocationMethod === PurchaseCostAllocationMethod.BY_QUANTITY) {
    return line.totalStems;
  }
  return line.lineAmount;
}

export function calculatePurchaseOrderTotals(
  input: PurchaseOrderTotalsInput
): PurchaseOrderTotalsResult {
  const allocationMethod =
    input.allocationMethod ?? PurchaseCostAllocationMethod.BY_AMOUNT;
  const warnings: string[] = [];
  const shippingFee = money(input.shippingFee);
  const packagingFee = money(input.packagingFee);
  const otherFee = money(input.otherFee);
  const totalExtraFee = money(shippingFee.plus(packagingFee).plus(otherFee));

  let goodsAmount = money(0);
  const baseLines: PurchaseOrderCalcLine[] = input.lines.map((line, index) => {
    const purchaseQuantity = quantity(line.purchaseQuantity);
    const stemsPerUnit = quantity(line.stemsPerUnit);
    const unitPrice = money(line.unitPrice);
    const totalStems = quantity(purchaseQuantity.times(stemsPerUnit));
    const lineAmount = money(purchaseQuantity.times(unitPrice));
    goodsAmount = money(goodsAmount.plus(lineAmount));
    if (totalStems.isZero()) {
      warnings.push(`第 ${index + 1} 行总支数为 0，实际单支成本按 0 计算`);
    }
    return {
      ...line,
      purchaseQuantity,
      stemsPerUnit,
      unitPrice,
      totalStems,
      lineAmount,
      allocatedExtraFee: money(0),
      actualTotalCost: lineAmount,
      actualUnitCost: unitCost(0),
    };
  });

  const allocationTotal = goodsAmount.isZero()
    ? money(0)
    : allocationBaseTotal(baseLines, allocationMethod);
  if (allocationTotal.isZero()) {
    if (!totalExtraFee.isZero()) {
      warnings.push("采购明细金额或数量为 0，附加费用暂无法分摊");
    }
  } else {
    let allocatedSoFar = money(0);
    baseLines.forEach((line, index) => {
      const isLast = index === baseLines.length - 1;
      const allocatedExtraFee = isLast
        ? money(totalExtraFee.minus(allocatedSoFar))
        : money(
            totalExtraFee
              .times(allocationBaseForLine(line, allocationMethod))
              .div(allocationTotal)
          );
      line.allocatedExtraFee = allocatedExtraFee;
      allocatedSoFar = money(allocatedSoFar.plus(allocatedExtraFee));
    });
  }

  const lines = baseLines.map((line) => {
    const actualTotalCost = money(line.lineAmount.plus(line.allocatedExtraFee));
    const actualUnitCost = line.totalStems.isZero()
      ? unitCost(0)
      : unitCost(actualTotalCost.div(line.totalStems));
    return { ...line, actualTotalCost, actualUnitCost };
  });

  return {
    goodsAmount,
    shippingFee,
    packagingFee,
    otherFee,
    totalExtraFee,
    totalAmount: money(goodsAmount.plus(totalExtraFee)),
    allocationMethod,
    lines,
    warnings,
  };
}
