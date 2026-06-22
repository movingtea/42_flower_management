import { Prisma } from "@/generated/prisma/client";
import { PurchaseCostAllocationMethod } from "@/generated/prisma/enums";
import {
  isFlowerPurchaseLineItemType,
  type PurchaseLineItemType,
} from "@/lib/purchase-line-form-pure";
import {
  calculateLossAdjustedLineCost,
  DEFAULT_STANDARD_USABLE_RATE,
} from "@/services/loss-model-pure";

export type DecimalInput = Prisma.Decimal | number | string | null | undefined;

export type PurchaseOrderCalcLineInput = {
  itemType?: PurchaseLineItemType | null;
  flowerWikiId?: string | null;
  masterPartId?: string | null;
  purchaseName?: string | null;
  grade?: string | null;
  color?: string | null;
  spec?: string | null;
  purchaseQuantity: DecimalInput;
  purchaseUnit: string;
  stemsPerUnit: DecimalInput;
  unitPrice: DecimalInput;
  usableRate?: DecimalInput;
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
  usableRate: Prisma.Decimal;
  lossRate: Prisma.Decimal;
  lossAdjustedTotalCost: Prisma.Decimal;
  lossAdjustedUnitCost: Prisma.Decimal;
  lossModelExtraCost: Prisma.Decimal;
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

function hasExplicitUsableRate(value: DecimalInput | undefined): boolean {
  return value !== null && value !== undefined && value !== "";
}

function isFlowerCalcLine(line: PurchaseOrderCalcLineInput): boolean {
  if (line.itemType) {
    return isFlowerPurchaseLineItemType(line.itemType);
  }
  return Boolean(line.flowerWikiId?.trim()) || !line.masterPartId?.trim();
}

function defaultUsableRateForCalcLine(line: PurchaseOrderCalcLineInput): DecimalInput {
  return isFlowerCalcLine(line) ? DEFAULT_STANDARD_USABLE_RATE : 1;
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
  const baseLines: Array<
    PurchaseOrderCalcLineInput & {
      purchaseQuantity: Prisma.Decimal;
      stemsPerUnit: Prisma.Decimal;
      unitPrice: Prisma.Decimal;
      totalStems: Prisma.Decimal;
      lineAmount: Prisma.Decimal;
      allocatedExtraFee: Prisma.Decimal;
      actualTotalCost: Prisma.Decimal;
      actualUnitCost: Prisma.Decimal;
    }
  > = input.lines.map((line, index) => {
    const purchaseQuantity = quantity(line.purchaseQuantity);
    const stemsPerUnit = quantity(line.stemsPerUnit);
    const unitPrice = money(line.unitPrice);
    const totalStems = quantity(purchaseQuantity.times(stemsPerUnit));
    const lineAmount = money(purchaseQuantity.times(unitPrice));
    goodsAmount = money(goodsAmount.plus(lineAmount));
    const isFlower = isFlowerCalcLine(line);
    if (isFlower && totalStems.isZero()) {
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
    : allocationBaseTotal(
        baseLines as PurchaseOrderCalcLine[],
        allocationMethod
      );
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
              .times(allocationBaseForLine(line as PurchaseOrderCalcLine, allocationMethod))
              .div(allocationTotal)
          );
      line.allocatedExtraFee = allocatedExtraFee;
      allocatedSoFar = money(allocatedSoFar.plus(allocatedExtraFee));
    });
  }

  const lines = baseLines.map((line, index) => {
    const actualTotalCost = money(line.lineAmount.plus(line.allocatedExtraFee));
    const actualUnitCost = line.totalStems.isZero()
      ? unitCost(0)
      : unitCost(actualTotalCost.div(line.totalStems));

    let usableRateInput = line.usableRate;
    const isFlower = isFlowerCalcLine(line);
    if (!hasExplicitUsableRate(usableRateInput)) {
      if (isFlower) {
        warnings.push(`第 ${index + 1} 行花材未设置可用率，已使用默认 85%`);
      }
      usableRateInput = defaultUsableRateForCalcLine(line);
    }

    const lossAdjusted = calculateLossAdjustedLineCost({
      actualTotalCost,
      actualUnitCost,
      totalStems: line.totalStems,
      usableRate: usableRateInput,
    });
    warnings.push(...lossAdjusted.warnings);

    return {
      ...line,
      actualTotalCost,
      actualUnitCost,
      usableRate: lossAdjusted.usableRate,
      lossRate: lossAdjusted.lossRate,
      lossAdjustedTotalCost: lossAdjusted.lossAdjustedTotalCost,
      lossAdjustedUnitCost: lossAdjusted.lossAdjustedUnitCost,
      lossModelExtraCost: lossAdjusted.lossModelExtraCost,
    };
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
