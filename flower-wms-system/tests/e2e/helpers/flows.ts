import { expect, type Page } from "@playwright/test";
import { expectFeedback, futureDateTimeLocal, gotoApp, selectByText, toggle } from "./ui";

/** Creates one material through the real material master form. */
export async function createMaterial(
  page: Page,
  material: {
    code: string;
    name: string;
    kind?: "花材" | "叶材" | "包装" | "耗材" | "其他";
    color?: string;
    grade?: string;
    gradeSpecification?: string;
    baseUnit?: string;
    quantityScale?: number;
  },
): Promise<void> {
  await gotoApp(page, "/v2/materials");
  await toggle(page, "新增物料");
  const form = page.locator("details").filter({ has: page.getByText("新增物料", { exact: true }) }).locator("form").first();
  await form.getByLabel("物料编码").fill(material.code);
  await form.getByLabel("物料名称").fill(material.name);
  await form.getByLabel("物料类别").selectOption({ label: material.kind ?? "花材" });
  if (material.color) await form.getByLabel("颜色").fill(material.color);
  if (material.grade) await form.getByLabel("品质等级").fill(material.grade);
  if (material.gradeSpecification) await form.getByLabel("等级说明（如长度范围）").fill(material.gradeSpecification);
  await form.getByLabel("库存单位").fill(material.baseUnit ?? "支");
  await form.getByLabel("库存小数位数").fill(String(material.quantityScale ?? 0));
  await form.getByRole("button", { name: "保存物料" }).click();
  await expectFeedback(page, "物料已创建");
  await expect(page.getByText(material.code, { exact: false }).first()).toBeVisible();
}

/** Creates one supplier through the real supplier form. */
export async function createSupplier(
  page: Page,
  supplier: { code: string; name: string; contactName?: string; phone?: string },
): Promise<void> {
  await gotoApp(page, "/v2/suppliers");
  await toggle(page, "新增供应商");
  const form = page.locator("details").filter({ has: page.getByText("新增供应商", { exact: true }) }).locator("form").first();
  await form.getByLabel("供应商编码").fill(supplier.code);
  await form.getByLabel("供应商名称").fill(supplier.name);
  if (supplier.contactName) await form.getByLabel("联系人").fill(supplier.contactName);
  if (supplier.phone) await form.getByLabel("联系电话").fill(supplier.phone);
  await form.getByRole("button", { name: "保存供应商" }).click();
  await expectFeedback(page, "供应商已创建");
}

async function searchCatalog(page: Page, query: string): Promise<void> {
  await gotoApp(page, `/v2/catalog?q=${encodeURIComponent(query)}`);
  await expect(page.getByText(query, { exact: false }).first()).toBeVisible();
}

/**
 * Creates a product, one SKU, sets it as the default SKU, enables the product,
 * creates the first recipe draft and publishes it. Returns the generated SKU code.
 */
export async function createProductSkuRecipe(
  page: Page,
  input: {
    productName: string;
    skuName: string;
    price: number;
    recipeLines: { materialCode: string; quantity: number }[];
  },
): Promise<{ skuCode: string }> {
  await gotoApp(page, "/v2/catalog");
  await toggle(page, "新增商品");
  const createForm = page.locator("details").filter({ has: page.getByText("新增商品", { exact: true }) }).locator("form").first();
  await createForm.getByLabel("商品名称").fill(input.productName);
  await createForm.getByRole("button", { name: "创建商品" }).click();
  await expectFeedback(page, "已创建，请添加 SKU");

  await searchCatalog(page, input.productName);
  let productDetails = page.locator("details").filter({ has: page.locator("summary", { hasText: input.productName }) }).first();
  await productDetails.locator("summary").filter({ hasText: input.productName }).first().click();
  await productDetails.getByText("新增 SKU", { exact: true }).click();
  const skuDetails = productDetails.locator("details").filter({ has: page.getByText("新增 SKU", { exact: true }) }).last();
  const skuForm = skuDetails.locator("form");
  await skuForm.getByLabel("规格名称").fill(input.skuName);
  await skuForm.getByLabel("售价（元）").fill(String(input.price));
  await skuForm.getByRole("button", { name: "创建 SKU" }).click();
  await expectFeedback(page, "已创建");

  const banner = page.locator("main").getByText(/SKU\s+\S+\s+已创建/).first();
  const message = await banner.innerText();
  const codeMatch = message.match(/SKU\s+(\S+)\s+已创建/);
  if (!codeMatch) throw new Error(`Could not read generated SKU code from feedback "${message}"`);
  const skuCode = codeMatch[1];

  // Set the new SKU as the default SKU (the first created SKU may already be
  // auto-promoted by the save action), then enable the product.
  await searchCatalog(page, input.productName);
  productDetails = page.locator("details").filter({ has: page.locator("summary", { hasText: input.productName }) }).first();
  await productDetails.locator("summary").filter({ hasText: input.productName }).first().click();
  const allSku = productDetails.locator("details").filter({ has: page.locator("summary", { hasText: input.skuName }) }).first();
  await allSku.locator("summary").filter({ hasText: input.skuName }).first().click();
  const setDefaultButton = allSku.getByRole("button", { name: "设为默认 SKU" });
  if ((await setDefaultButton.count()) > 0) {
    await setDefaultButton.click();
    await expectFeedback(page, "默认 SKU 已更新");
  } else {
    await expect(allSku.getByText("默认", { exact: true }).first()).toBeVisible();
  }
  await searchCatalog(page, input.productName);
  productDetails = page.locator("details").filter({ has: page.locator("summary", { hasText: input.productName }) }).first();
  await productDetails.locator("summary").filter({ hasText: input.productName }).first().click();
  await productDetails.getByRole("button", { name: "启用商品", exact: true }).click();
  await expectFeedback(page, "商品已启用");

  // First recipe draft + publish.
  await gotoApp(page, `/v2/recipes?q=${encodeURIComponent(skuCode)}`);
  await toggle(page, "新建配方草稿");
  const recipeEditor = page
    .locator("form")
    .filter({ has: page.getByRole("button", { name: "创建配方草稿" }), visible: true })
    .first();
  await selectByText(recipeEditor.locator("select").first(), skuCode);
  for (let index = 0; index < input.recipeLines.length; index += 1) {
    if (index > 0) await recipeEditor.getByRole("button", { name: "＋ 添加物料" }).click();
    const line = input.recipeLines[index];
    await selectByText(recipeEditor.getByLabel("物料").nth(index), line.materialCode);
    await recipeEditor.getByLabel("用量").nth(index).fill(String(line.quantity));
  }
  await recipeEditor.getByRole("button", { name: "创建配方草稿" }).click();
  await expectFeedback(page, "配方草稿 v1 已创建");
  await page.getByRole("button", { name: "发布此版本" }).click();
  await expectFeedback(page, "配方 v1 已发布");

  return { skuCode };
}

/** Creates a staff-portal manual inbound (emergency stock) through the operations page. */
export async function createManualInbound(
  page: Page,
  input: { materialCode: string; quantity: number; unitCost?: number; reason?: string; locationCode?: string },
): Promise<void> {
  await gotoApp(page, "/v2/operations");
  const section = page.locator("section").filter({ has: page.getByRole("heading", { name: "手工入库" }) }).first();
  // Native selects wrapped in <label> include their option text in the label's
  // textContent, so getByLabel(name) is ambiguous here; target fields by name.
  await selectByText(section.locator('select[name="materialId"]'), input.materialCode);
  await selectByText(section.locator('select[name="locationId"]'), input.locationCode ?? "STOCK");
  await section.locator('input[name="quantity"]').fill(String(input.quantity));
  await section.locator('input[name="unitCost"]').fill(String(input.unitCost ?? 2));
  await section.locator('textarea[name="reason"]').fill(input.reason ?? "E2E 补入库");
  await section.getByRole("button", { name: "确认入库" }).click();
  await expectFeedback(page, "手工入库已完成");
}

/** Creates a staff-portal manual order through the order board form. */
export async function createManualOrder(
  page: Page,
  input: {
    buyerName: string;
    skuLabel: string;
    quantity: number;
    deliveryDays?: number;
    fulfillmentKind?: "DELIVERY" | "PICKUP";
    recipient?: { name: string; phone: string; address: string };
  },
): Promise<void> {
  await gotoApp(page, "/v2/orders");
  await toggle(page, "新建后台订单");
  const form = page.locator("form").filter({ has: page.getByRole("button", { name: "保存订单草稿" }) });
  await selectByText(form.locator('select[name="itemSkuId"]').first(), input.skuLabel);
  await form.locator('input[name="itemQuantity"]').first().fill(String(input.quantity));
  await form.getByLabel("顾客称呼").fill(input.buyerName);
  await form.getByLabel("交付时间").fill(futureDateTimeLocal(input.deliveryDays ?? 3));
  const kind = input.fulfillmentKind ?? "DELIVERY";
  await form.getByLabel("交付方式").selectOption(kind);
  if (kind === "DELIVERY") {
    const recipient = input.recipient ?? { name: "收货人", phone: "13800000000", address: "上海市测试路 1 号" };
    await form.getByLabel("收件人（配送填写）").fill(recipient.name);
    await form.getByLabel("收件电话（配送填写）").fill(recipient.phone);
    await form.getByLabel("配送地址（配送填写）").fill(recipient.address);
  }
  await form.getByRole("button", { name: "保存订单草稿" }).click();
  await expectFeedback(page, "订单草稿已创建");
}

/** Opens the drawer of the board card whose text contains 
eedle`. */
export async function openOrderDrawer(page: Page, needle: string): Promise<import("@playwright/test").Locator> {
  await gotoApp(page, `/v2/orders?q=${encodeURIComponent(needle)}`);
  const card = page.locator("article").filter({ hasText: needle }).first();
  await expect(card).toBeVisible();
  await card.getByRole("link").first().click();
  const dialog = page.getByRole("dialog", { name: "订单详情" });
  await expect(dialog).toBeVisible();
  return dialog;
}

/** Confirms the board card whose text contains 
eedle` and waits for feedback. */
export async function confirmOrderCard(page: Page, needle: string): Promise<void> {
  const card = page.locator("article").filter({ hasText: needle }).first();
  await card.getByRole("button", { name: "确认并预留" }).click();
  await expectFeedback(page, "订单已核对供应状态");
}

/** Receives one purchase line (accepted or downgraded) from the purchase detail panel. */
export async function receivePurchaseLine(
  page: Page,
  input: {
    purchaseOrderNumber: string;
    quantity: number;
    disposition?: "ACCEPTED" | "DOWNGRADED";
    downgradedMaterialCode?: string;
    gradeChangeReason?: string;
    finalUnitCost?: number;
  },
): Promise<void> {
  await gotoApp(page, `/v2/purchase-orders?q=${encodeURIComponent(input.purchaseOrderNumber)}&state=open`);
  const row = page.locator("tr").filter({ hasText: input.purchaseOrderNumber }).first();
  await row.getByText("查看详情", { exact: true }).click();
  const panel = page.locator("div.fixed").filter({ hasText: input.purchaseOrderNumber }).first();
  const form = panel.locator("form").filter({ has: page.getByRole("button", { name: "确认验收" }) }).first();
  await form.getByLabel("验收结果").selectOption(input.disposition ?? "ACCEPTED");
  if (input.disposition === "DOWNGRADED" && input.downgradedMaterialCode) {
    await selectByText(form.getByLabel("降级后的物料"), input.downgradedMaterialCode);
  }
  await form.getByLabel("数量", { exact: true }).fill(String(input.quantity));
  await form.getByLabel("最终单位成本").fill(String(input.finalUnitCost ?? 2));
  if (input.disposition === "DOWNGRADED") {
    await form.getByLabel("降级原因").fill(input.gradeChangeReason ?? "等级不符，按降级验收");
  }
  await form.getByRole("button", { name: "确认验收" }).click();
  await expectFeedback(page, "验收入库完成");
}

/** Rejects the remainder of one purchase line from the purchase detail panel. */
export async function rejectPurchaseLine(
  page: Page,
  input: { purchaseOrderNumber: string; quantity: number; reason: string },
): Promise<void> {
  await gotoApp(page, `/v2/purchase-orders?q=${encodeURIComponent(input.purchaseOrderNumber)}&state=open`);
  const row = page.locator("tr").filter({ hasText: input.purchaseOrderNumber }).first();
  await row.getByText("查看详情", { exact: true }).click();
  const panel = page.locator("div.fixed").filter({ hasText: input.purchaseOrderNumber }).first();
  const form = panel.locator("form").filter({ has: page.getByRole("button", { name: "记录拒收" }) }).first();
  await form.getByLabel("拒收数量").fill(String(input.quantity));
  await form.getByLabel("拒收原因").fill(input.reason);
  await form.getByRole("button", { name: "记录拒收" }).click();
  await expectFeedback(page, "已拒收");
}
