import { expect, test } from "@playwright/test";
import { openRolePage } from "./helpers/auth";
import { createMarker } from "./helpers/marker";
import { createMaterial, createSupplier, receivePurchaseLine, rejectPurchaseLine } from "./helpers/flows";
import { expectFeedback, futureDateTimeLocal, gotoApp, selectByText, toggle } from "./helpers/ui";
import {
  latestPurchaseOrderForSupplier,
  materialByCode,
  purchaseLineProgress,
  totalOnHandForMaterial,
} from "./helpers/db";

/**
 * E11-PUR-02 browser case (WMS-BR-PUR-001): the original line is capped, a
 * rejected remainder gets a linked replacement delivery, an extra order adds a
 * second linked line, and receiving both never exceeds the original quantity.
 *
 * Scenario mirrors the E1.1 matrix wording: order 5, reject 2, replacement 2,
 * extra 3.
 */
test.describe("独立用例 · 补送与额外收货（E11-PUR-02）", () => {
  test.setTimeout(480_000);

  test("订 5 拒收 2，关联补送 2 与额外收货 3 分别入库且原明细封顶", async ({ browser }) => {
    const marker = createMarker("PUR");
    const materialCode = `${marker}-ROSE`;
    const supplierCode = `${marker}-SUP`;

    const { context, page } = await openRolePage(browser, "admin", "/v2/materials");
    try {
      await createMaterial(page, {
        code: materialCode,
        name: `${marker} 拒收玫瑰`,
        kind: "花材",
        color: "香槟",
        grade: "A",
        baseUnit: "支",
        quantityScale: 0,
      });
      await createSupplier(page, { code: supplierCode, name: `${marker} 补送供应商` });

      // Create and submit one purchase order with a single 5-stem original line.
      await gotoApp(page, "/v2/purchase-orders");
      await toggle(page, "新建采购单");
      const draftForm = page
        .locator("form")
        .filter({ has: page.getByRole("button", { name: "创建采购草稿" }) })
        .first();
      await selectByText(draftForm.getByLabel("供应商"), supplierCode);
      await draftForm.getByLabel("预计到货时间").fill(futureDateTimeLocal(2));
      await selectByText(draftForm.locator("select").nth(1), materialCode);
      await draftForm.getByLabel("采购数量").fill("5");
      await draftForm.getByLabel("采购单价").fill("2");
      await draftForm.getByRole("button", { name: "创建采购草稿" }).click();
      await expectFeedback(page, "采购草稿已创建");

      const draft = await latestPurchaseOrderForSupplier(supplierCode);
      expect(draft.state).toBe("DRAFT");
      await gotoApp(page, `/v2/purchase-orders?q=${encodeURIComponent(draft.number)}&state=DRAFT`);
      await page.locator("tr").filter({ hasText: draft.number }).first().getByText("查看详情", { exact: true }).click();
      const draftPanel = page.locator("div.fixed").filter({ hasText: draft.number }).first();
      await draftPanel.getByRole("button", { name: "确认下单" }).click();
      await expectFeedback(page, "采购单已下单");

      // Receive 3 of 5, then reject the remaining 2.
      await receivePurchaseLine(page, { purchaseOrderNumber: draft.number, quantity: 3, finalUnitCost: 2 });
      await rejectPurchaseLine(page, { purchaseOrderNumber: draft.number, quantity: 2, reason: "花瓣折损，整批拒收" });

      // Create the linked replacement-delivery (2) and extra-order (3) lines.
      await gotoApp(page, `/v2/purchase-orders?q=${encodeURIComponent(draft.number)}&state=all`);
      await page.locator("tr").filter({ hasText: draft.number }).first().getByText("查看详情", { exact: true }).click();
      let panel = page.locator("div.fixed").filter({ hasText: draft.number }).first();
      await panel.locator("summary").filter({ hasText: "关联补单 / 额外到货" }).first().click();
      const extraForm = panel
        .locator("form")
        .filter({ has: page.getByRole("button", { name: "创建关联补单明细" }) })
        .first();
      await extraForm.getByLabel("额外数量").fill("3");
      await extraForm.getByLabel("采购单价").fill("2");
      await extraForm.getByRole("button", { name: "创建关联补单明细" }).click();
      await expectFeedback(page, "关联采购明细已创建");

      await gotoApp(page, `/v2/purchase-orders?q=${encodeURIComponent(draft.number)}&state=all`);
      await page.locator("tr").filter({ hasText: draft.number }).first().getByText("查看详情", { exact: true }).click();
      panel = page.locator("div.fixed").filter({ hasText: draft.number }).first();
      await panel.locator("summary").filter({ hasText: "登记供应商补送" }).first().click();
      const replacementForm = panel
        .locator("form")
        .filter({ has: page.getByRole("button", { name: "创建关联补送明细" }) })
        .first();
      await replacementForm.getByLabel("补送数量").fill("2");
      await replacementForm.getByLabel("采购单价").fill("2");
      await replacementForm.getByRole("button", { name: "创建关联补送明细" }).click();
      await expectFeedback(page, "关联采购明细已创建");

      // Receive both linked lines in full.
      await gotoApp(page, `/v2/purchase-orders?q=${encodeURIComponent(draft.number)}&state=all`);
      await page.locator("tr").filter({ hasText: draft.number }).first().getByText("查看详情", { exact: true }).click();
      panel = page.locator("div.fixed").filter({ hasText: draft.number }).first();
      await expect(panel.getByText("关联补单 / 额外到货", { exact: false }).first()).toBeVisible();
      await expect(panel.getByText("拒收后关联补送", { exact: false }).first()).toBeVisible();

      for (const [relationText, quantity] of [["关联补单 / 额外到货", 3], ["拒收后关联补送", 2]] as const) {
        // Supplement lines are the rounded line containers that still expose an
        // acceptance form; the original line is fully processed and shows none.
        const block = panel
          .locator("div.rounded-lg.border.border-zinc-200")
          .filter({ hasText: relationText })
          .filter({ has: page.getByRole("button", { name: "确认验收" }) })
          .first();
        const form = block.locator("form").filter({ has: page.getByRole("button", { name: "确认验收" }) }).first();
        await form.getByLabel("数量", { exact: true }).fill(String(quantity));
        await form.getByLabel("最终单位成本").fill("2");
        await form.getByRole("button", { name: "确认验收" }).click();
        await expectFeedback(page, "验收入库完成");
        await gotoApp(page, `/v2/purchase-orders?q=${encodeURIComponent(draft.number)}&state=all`);
        await page.locator("tr").filter({ hasText: draft.number }).first().getByText("查看详情", { exact: true }).click();
        panel = page.locator("div.fixed").filter({ hasText: draft.number }).first();
      }
    } finally {
      await context.close();
    }

    // Data state: the original line stays capped at 5; both linked lines keep
    // their source line and were individually received.
    const progress = await purchaseLineProgress((await latestPurchaseOrderForSupplier(supplierCode)).number);
    const original = progress.find((row) => row.relation_kind === "ORIGINAL");
    expect(original).toBeDefined();
    expect(Number(original?.ordered_qty)).toBe(5);
    expect(Number(original?.accepted)).toBe(3);
    expect(Number(original?.rejected)).toBe(2);
    expect(Number(original?.downgraded)).toBe(0);

    const extra = progress.find((row) => row.relation_kind === "EXTRA_ORDER");
    expect(extra).toBeDefined();
    expect(Number(extra?.ordered_qty)).toBe(3);
    expect(Number(extra?.accepted)).toBe(3);

    const replacement = progress.find((row) => row.relation_kind === "REPLACEMENT_DELIVERY");
    expect(replacement).toBeDefined();
    expect(Number(replacement?.ordered_qty)).toBe(2);
    expect(Number(replacement?.accepted)).toBe(2);

    // Each receipt creates its own batch; the sum proves all three receipts landed.
    expect(await totalOnHandForMaterial(materialCode)).toBe(8);
    expect((await materialByCode(materialCode)).code).toBe(materialCode);
  });
});
