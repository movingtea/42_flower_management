import { expect, test } from "@playwright/test";
import { openRolePage } from "./helpers/auth";
import { createMarker, markerLabel } from "./helpers/marker";
import {
  createManualOrder,
  createMaterial,
  createProductSkuRecipe,
  createSupplier,
  confirmOrderCard,
  openOrderDrawer,
  receivePurchaseLine,
} from "./helpers/flows";
import { expectFeedback, futureDateTimeLocal, gotoApp, selectByText, toggle, waitForUrl } from "./helpers/ui";
import {
  activeReservationQty,
  activeReservationsByMaterial,
  batchOnHand,
  costAdjustmentsForOrder,
  costSnapshotsForOrder,
  deliveryAttemptsForOrder,
  latestBatchForMaterial,
  latestPurchaseOrderForSupplier,
  materialByCode,
  materialUsageForOrder,
  orderByBuyer,
  productSkuByProductName,
  publishedRecipeLines,
} from "./helpers/db";

/**
 * E1.5 main chain (serial):
 * admin login → material/supplier/catalog → shortage order → linked purchase →
 * split original/downgraded receiving → manual substitution → production actual
 * usage and loss → delivery failure/reschedule → delivery completion and cost.
 *
 * Data is created through the browser with a unique run marker, so every run is
 * reproducible against the harness' fresh database.
 */
test.describe.serial("E1.5 主链路", () => {
  const marker = createMarker("MAIN");
  let roseCode = "";
  let carnationCode = "";
  let supplierCode = "";
  const productName = markerLabel(marker);
  const skuName = `${marker} 花束规格`;
  const buyerName = markerLabel(marker);
  let skuCode = "";
  let purchaseOrderNumber = "";

  test("准备主数据：物料、供应商、商品 SKU 与已发布配方", async ({ browser }) => {
    test.setTimeout(300_000);
    const { context, page } = await openRolePage(browser, "admin", "/v2/materials");
    try {
      roseCode = await createMaterial(page, {
        name: `${marker} 红玫瑰`,
        kind: "花材",
        color: "红",
        grade: "A",
        baseUnit: "支",
        quantityScale: 0,
      });
      carnationCode = await createMaterial(page, {
        name: `${marker} 粉康乃馨`,
        kind: "花材",
        color: "粉",
        grade: "B",
        baseUnit: "支",
        quantityScale: 0,
      });
      supplierCode = await createSupplier(page, {
        name: `${marker} 花材供应商`,
        contactName: "采购联系人",
        phone: "13900000000",
      });
      const created = await createProductSkuRecipe(page, {
        productName,
        skuName,
        price: 199,
        recipeLines: [{ materialCode: roseCode, quantity: 10 }],
      });
      skuCode = created.skuCode;
    } finally {
      await context.close();
    }

    // Service-layer data state double-checks what the browser flow produced.
    const rose = await materialByCode(roseCode);
    expect(rose.code).toBe(roseCode);
    const sku = await productSkuByProductName(productName);
    expect(sku.code).toBe(skuCode);
    const lines = await publishedRecipeLines(sku.id);
    expect(lines).toHaveLength(1);
    expect(lines[0]?.material_code).toBe(roseCode);
    expect(Number(lines[0]?.planned_qty)).toBe(10);
  });

  test("创建缺料订单并关联采购单", async ({ browser }) => {
    test.setTimeout(300_000);
    const { context, page } = await openRolePage(browser, "admin", "/v2/orders");
    try {
      await createManualOrder(page, {
        buyerName,
        skuLabel: skuName,
        quantity: 1,
        deliveryDays: 4,
      });
      await confirmOrderCard(page, buyerName);

      const pending = await orderByBuyer(buyerName);
      expect(pending.commercial_state).toBe("PENDING_CONFIRMATION");
      expect(pending.supply_state).toBe("PURCHASE_REQUIRED");
      expect(await activeReservationQty(pending.id)).toBe(0);

      const dialog = await openOrderDrawer(page, buyerName);
      await dialog.getByRole("link", { name: "新建采购单并关联" }).click();
      await waitForUrl(page, "requirementId=");
      const linkedForm = page
        .locator("form")
        .filter({ has: page.getByRole("button", { name: "创建采购单并关联" }) })
        .first();
      await selectByText(linkedForm.getByLabel("供应商"), supplierCode);
      await linkedForm.getByLabel("预计到货").fill(futureDateTimeLocal(2));
      await linkedForm.getByLabel("采购数量").fill("10");
      await linkedForm.getByLabel("分配数量").fill("10");
      await linkedForm.getByLabel("采购单价").fill("2");
      await linkedForm.getByRole("button", { name: "创建采购单并关联" }).click();
      await expectFeedback(page, "已创建并关联缺料需求");

      const purchaseOrder = await latestPurchaseOrderForSupplier(supplierCode);
      expect(purchaseOrder.state).toBe("ORDERED");
      purchaseOrderNumber = purchaseOrder.number;
    } finally {
      await context.close();
    }
  });

  test("分次原级与降级验收：先收原级 4 支，再降级 6 支", async ({ browser }) => {
    test.setTimeout(300_000);
    const { context, page } = await openRolePage(browser, "admin", "/v2/purchase-orders");
    try {
      await receivePurchaseLine(page, { purchaseOrderNumber, quantity: 4, finalUnitCost: 2 });
      await receivePurchaseLine(page, {
        purchaseOrderNumber,
        quantity: 6,
        disposition: "DOWNGRADED",
        downgradedMaterialCode: carnationCode,
        gradeChangeReason: "等级不符，按降级验收",
        finalUnitCost: 2,
      });
    } finally {
      await context.close();
    }

    const order = await orderByBuyer(buyerName);
    expect(order.commercial_state).toBe("PENDING_CONFIRMATION");
    const reservations = await activeReservationsByMaterial(order.id);
    expect(Number(reservations.find((row) => row.code === roseCode)?.quantity ?? 0)).toBe(4);
    expect(reservations.find((row) => row.code === carnationCode)).toBeUndefined();

    const roseBatch = await latestBatchForMaterial(roseCode);
    const carnationBatch = await latestBatchForMaterial(carnationCode);
    expect(await batchOnHand(roseBatch.id)).toBe(4);
    expect(await batchOnHand(carnationBatch.id)).toBe(6);
  });

  test("拒绝不等缺口的人工换料，再整条换料并完成制作实耗与损耗", async ({ browser }) => {
    test.setTimeout(420_000);
    const { context, page } = await openRolePage(browser, "admin", "/v2/orders");
    try {
      // Negative case: the replacement quantity must equal the whole current shortage.
      let dialog = await openOrderDrawer(page, buyerName);
      await dialog.getByText("人工替换物料（不自动替换）", { exact: true }).click();
      let substituteForm = dialog
        .locator("form")
        .filter({ has: page.getByRole("button", { name: "确认人工替换" }) })
        .first();
      await selectByText(substituteForm.getByLabel("替换为同单位物料"), carnationCode);
      await substituteForm.getByLabel("替换数量").fill("5");
      await substituteForm.getByLabel("操作原因").fill("同色系替代，数量待补");
      await substituteForm.getByLabel("顾客已确认等级 / 颜色 / 规格变化").check();
      await substituteForm.getByRole("button", { name: "确认人工替换" }).click();
      await expectFeedback(page, "替换数量必须等于当前缺口");

      const unchanged = await orderByBuyer(buyerName);
      expect(unchanged.commercial_state).toBe("PENDING_CONFIRMATION");
      expect(await activeReservationQty(unchanged.id)).toBe(4);
      const unchangedReservations = await activeReservationsByMaterial(unchanged.id);
      expect(Number(unchangedReservations.find((row) => row.code === roseCode)?.quantity ?? 0)).toBe(4);

      // Correct case: replace the remaining 6-unit shortage with carnation.
      dialog = await openOrderDrawer(page, buyerName);
      await dialog.getByText("人工替换物料（不自动替换）", { exact: true }).click();
      substituteForm = dialog
        .locator("form")
        .filter({ has: page.getByRole("button", { name: "确认人工替换" }) })
        .first();
      await selectByText(substituteForm.getByLabel("替换为同单位物料"), carnationCode);
      await substituteForm.getByLabel("替换数量").fill("6");
      await substituteForm.getByLabel("操作原因").fill("同色系替代，已与顾客说明");
      await substituteForm.getByLabel("顾客已确认等级 / 颜色 / 规格变化").check();
      await substituteForm.getByRole("button", { name: "确认人工替换" }).click();
      await expectFeedback(page, "现货已覆盖");

      const covered = await orderByBuyer(buyerName);
      expect(covered.commercial_state).toBe("CONFIRMED");
      expect(covered.supply_state).toBe("ON_HAND_COVERED");
      expect(covered.production_state).toBe("READY");
      expect(await activeReservationQty(covered.id)).toBe(10);

      // Start production, then record actual usage: rose used 3 + lost 1, carnation used 6.
      dialog = await openOrderDrawer(page, buyerName);
      await dialog.getByRole("button", { name: "开始制作" }).click();
      await expectFeedback(page, "订单已开始制作");

      dialog = await openOrderDrawer(page, buyerName);
      await toggle(page, "登记实际用料（有差异时展开）");
      const usageForm = dialog
        .locator("form")
        .filter({ has: page.getByRole("button", { name: "按实际用料完成制作" }) })
        .first();
      const usedInputs = usageForm.getByLabel("实际用量");
      await expect(usedInputs).toHaveCount(2);
      for (let index = 0; index < 2; index += 1) {
        // input -> label -> grid -> row container (the row header holds material identity).
        const row = usedInputs.nth(index).locator("../../..");
        const rowText = await row.innerText();
        if (rowText.includes(roseCode)) {
          await row.getByLabel("实际用量").fill("3");
          await row.getByLabel("损耗", { exact: true }).fill("1");
          await row.getByLabel("差异原因（与预留不一致时必填）").fill("修剪损耗");
        } else if (rowText.includes(carnationCode)) {
          await row.getByLabel("实际用量").fill("6");
        } else {
          throw new Error(`Unexpected usage row: ${rowText}`);
        }
      }
      await usageForm.getByRole("button", { name: "按实际用料完成制作" }).click();
      await expectFeedback(page, "已登记 2 个批次的实际用料");

      const produced = await orderByBuyer(buyerName);
      expect(produced.production_state).toBe("COMPLETED");
      expect(produced.fulfillment_state).toBe("WAITING_DELIVERY");
    } finally {
      await context.close();
    }

    const producedOrder = await orderByBuyer(buyerName);
    const usages = await materialUsageForOrder(producedOrder.id);
    expect(usages).toHaveLength(2);
    const roseUsage = usages.find((row) => row.material_code === roseCode);
    expect(Number(roseUsage?.used_qty)).toBe(3);
    expect(Number(roseUsage?.lost_qty)).toBe(1);
    expect(roseUsage?.difference_reason).toBe("修剪损耗");
    const carnationUsage = usages.find((row) => row.material_code === carnationCode);
    expect(Number(carnationUsage?.used_qty)).toBe(6);

    const roseBatch = await latestBatchForMaterial(roseCode);
    const carnationBatch = await latestBatchForMaterial(carnationCode);
    expect(await batchOnHand(roseBatch.id)).toBe(0);
    expect(await batchOnHand(carnationBatch.id)).toBe(0);
  });

  test("配送失败、人工重排、交付完成与实际成本", async ({ browser }) => {
    test.setTimeout(420_000);
    const { context, page } = await openRolePage(browser, "admin", "/v2/orders");
    try {
      // First delivery attempt fails.
      let dialog = await openOrderDrawer(page, buyerName);
      await toggle(page, "新建配送尝试");
      const createForm = dialog
        .locator("form")
        .filter({ has: page.getByRole("button", { name: "创建配送尝试" }) })
        .first();
      await createForm.getByRole("button", { name: "创建配送尝试" }).click();
      await expectFeedback(page, "配送尝试已创建");

      dialog = await openOrderDrawer(page, buyerName);
      await dialog.getByRole("button", { name: "开始配送" }).click();
      await expectFeedback(page, "配送已开始");

      dialog = await openOrderDrawer(page, buyerName);
      await toggle(page, "记录配送失败");
      const failForm = dialog
        .locator("form")
        .filter({ has: page.getByRole("button", { name: "确认失败" }) })
        .first();
      await failForm.getByPlaceholder("失败原因").fill("顾客临时不在");
      await failForm.getByRole("button", { name: "确认失败" }).click();
      await expectFeedback(page, "配送失败已记录");

      // Manual reschedule creates a new scheduled attempt.
      dialog = await openOrderDrawer(page, buyerName);
      await toggle(page, "重排配送");
      const rescheduleForm = dialog
        .locator("form")
        .filter({ has: page.getByRole("button", { name: "确认重排" }) })
        .first();
      await rescheduleForm.getByLabel("新时间").fill(futureDateTimeLocal(5));
      await rescheduleForm.getByLabel("备注").fill("顾客改约至次日");
      await rescheduleForm.getByRole("button", { name: "确认重排" }).click();
      await expectFeedback(page, "配送已重新安排");

      dialog = await openOrderDrawer(page, buyerName);
      await dialog.getByRole("button", { name: "开始配送" }).click();
      await expectFeedback(page, "配送已开始");

      dialog = await openOrderDrawer(page, buyerName);
      await dialog.getByRole("button", { name: "交付完成并生成成本快照" }).click();
      await expectFeedback(page, "交付完成，成本快照已生成");

      // Actual delivery cost after delivery records a visible cost adjustment.
      dialog = await openOrderDrawer(page, buyerName);
      await toggle(page, "登记配送实际成本");
      const costForm = dialog
        .locator("form")
        .filter({ has: page.getByRole("button", { name: "保存配送成本" }) })
        .first();
      await costForm.getByLabel("实际成本（元）").fill("15.5");
      await costForm.getByLabel("备注").fill("同城跑腿");
      await costForm.getByRole("button", { name: "保存配送成本" }).click();
      await expectFeedback(page, "配送实际成本已登记");

      dialog = await openOrderDrawer(page, buyerName);
      await expect(dialog.getByText("成本调整（1 条）", { exact: false }).first()).toBeVisible();
    } finally {
      await context.close();
    }
  });

  test("最终数据核对：状态、流水、成本调整与失败尝试保留", async () => {
    test.setTimeout(120_000);
    const order = await orderByBuyer(buyerName);
    expect(order.commercial_state).toBe("CONFIRMED");
    expect(order.production_state).toBe("COMPLETED");
    expect(order.fulfillment_state).toBe("DELIVERED");
    expect(await activeReservationQty(order.id)).toBe(0);

    const attempts = await deliveryAttemptsForOrder(order.id);
    expect(attempts).toHaveLength(2);
    expect(attempts[0]?.state).toBe("FAILED");
    expect(attempts[0]?.failure_reason).toBe("顾客临时不在");
    expect(attempts[1]?.state).toBe("DELIVERED");
    expect(Number(attempts[1]?.delivery_cost)).toBe(15.5);

    const snapshots = await costSnapshotsForOrder(order.id);
    expect(snapshots).toHaveLength(1);
    const adjustments = await costAdjustmentsForOrder(order.id);
    const deliveryAdjustment = adjustments.find((row) => row.kind === "DELIVERY");
    expect(deliveryAdjustment).toBeDefined();
    expect(Number(deliveryAdjustment?.amount_delta)).toBe(15.5);
  });
});
