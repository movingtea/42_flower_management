/**
 * Run with:
 *   npx tsx src/lib/purchase-receive-pure.test.ts
 */
import assert from "node:assert/strict";
import { Prisma } from "@/generated/prisma/client";
import {
  buildNonFlowerMaterialInput,
  isFlowerReceiveLine,
  parseReceiveQuantityFromDecimal,
  resolvePurchaseLineItemTypeForReceive,
  validateFlowerReceiveLine,
  validateNonFlowerReceiveLine,
} from "@/lib/purchase-receive-pure";

function testResolveItemType() {
  assert.equal(
    resolvePurchaseLineItemTypeForReceive({ itemType: "PACKAGING", masterPartId: "mp-1" }),
    "PACKAGING"
  );
  assert.equal(
    resolvePurchaseLineItemTypeForReceive({ flowerWikiId: "fw-1" }),
    "FLOWER"
  );
  assert.equal(
    resolvePurchaseLineItemTypeForReceive({ masterPartId: "mp-1" }),
    "OTHER"
  );
}

function testIsFlowerReceiveLine() {
  assert.equal(isFlowerReceiveLine({ itemType: "FLOWER", flowerWikiId: "fw-1" }), true);
  assert.equal(isFlowerReceiveLine({ itemType: "TOOL", masterPartId: "mp-1" }), false);
}

function testBuildNonFlowerMaterialInput() {
  const input = buildNonFlowerMaterialInput({
    masterPart: {
      id: "mp-1",
      name: "韩素纸",
      spec: "50×70cm",
      defaultUnit: "张",
    },
    purchaseUnit: "包",
  });
  assert.equal(input.masterPartId, "mp-1");
  assert.equal(input.name, "韩素纸 50×70cm");
  assert.equal(input.unit, "包");
  assert.equal(input.wikiId, null);
}

function testValidateNonFlowerReceiveLineSuccess() {
  assert.doesNotThrow(() =>
    validateNonFlowerReceiveLine(
      {
        itemType: "PACKAGING",
        masterPartId: "mp-1",
        purchaseUnit: "张",
        masterPart: { id: "mp-1", type: "PACKAGING", name: "韩素纸", isActive: true },
      },
      0
    )
  );
}

function testValidateNonFlowerReceiveLineMissingMasterPart() {
  assert.throws(
    () => validateNonFlowerReceiveLine({ itemType: "SUPPLY" }, 1),
    /非花材明细必须关联通用物料母表/
  );
}

function testValidateNonFlowerReceiveLineTypeMismatch() {
  assert.throws(
    () =>
      validateNonFlowerReceiveLine(
        {
          itemType: "PACKAGING",
          masterPartId: "mp-1",
          masterPart: { id: "mp-1", type: "TOOL", name: "剪刀", isActive: true },
        },
        0
      ),
    /类型与采购品类不一致/
  );
}

function testValidateNonFlowerReceiveLineMissingIsActive() {
  assert.doesNotThrow(() =>
    validateNonFlowerReceiveLine(
      {
        itemType: "TOOL",
        masterPartId: "mp-1",
        masterPart: { id: "mp-1", type: "TOOL", name: "剪刀" },
      },
      0
    )
  );
}

function testValidateNonFlowerReceiveLineInactive() {
  assert.throws(
    () =>
      validateNonFlowerReceiveLine(
        {
          itemType: "TOOL",
          masterPartId: "mp-1",
          masterPart: { id: "mp-1", type: "TOOL", name: "剪刀", isActive: false },
        },
        0
      ),
    /已停用/
  );
}

function testValidateFlowerReceiveLine() {
  assert.doesNotThrow(() =>
    validateFlowerReceiveLine({ itemType: "FLOWER", flowerWikiId: "fw-1" }, 0)
  );
  assert.throws(
    () => validateFlowerReceiveLine({ itemType: "FLOWER" }, 0),
    /花材明细必须关联花材母表/
  );
}

function testParseReceiveQuantity() {
  assert.equal(
    parseReceiveQuantityFromDecimal(new Prisma.Decimal(100), "第 1 行：", "入库数量"),
    100
  );
  assert.throws(
    () => parseReceiveQuantityFromDecimal(new Prisma.Decimal(0), "第 1 行：", "入库数量"),
    /必须大于 0/
  );
  assert.throws(
    () => parseReceiveQuantityFromDecimal(new Prisma.Decimal("1.5"), "第 1 行：", "入库数量"),
    /必须是整数/
  );
}

function run() {
  testResolveItemType();
  testIsFlowerReceiveLine();
  testBuildNonFlowerMaterialInput();
  testValidateNonFlowerReceiveLineSuccess();
  testValidateNonFlowerReceiveLineMissingMasterPart();
  testValidateNonFlowerReceiveLineTypeMismatch();
  testValidateNonFlowerReceiveLineMissingIsActive();
  testValidateNonFlowerReceiveLineInactive();
  testValidateFlowerReceiveLine();
  testParseReceiveQuantity();
  console.log("purchase-receive-pure.test.ts: all passed");
}

run();
