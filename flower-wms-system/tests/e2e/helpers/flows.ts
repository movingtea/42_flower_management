import { expect, type Page } from "@playwright/test";
import { expectFeedback, futureDateTimeLocal, gotoApp, selectByText, toggle } from "./ui";

/** Opens a V2 drawer form by its trigger label and returns the dialog locator. */
async function openDrawer(page: Page, triggerLabel: string) {
  await page.getByRole("button", { name: triggerLabel, exact: true }).first().click();
  const dialog = page.getByRole("dialog").last();
  await expect(dialog).toBeVisible();
  return dialog;
}

function readGeneratedCode(message: string, pattern: RegExp, label: string): string {
  const match = message.match(pattern);
  if (!match) throw new Error(`Could not read generated ${label} from feedback "${message}"`);
  return match[1];
}

/** Material kinds rendered by the consumable master (`/v2/consumables`). */
const CONSUMABLE_KIND_LABELS = ["包装", "耗材", "其他"] as const;

/** Creates one material through the real material master drawer; returns the generated code. */
export async function createMaterial(
  page: Page,
  material: {
    name: string;
    kind?: "花材" | "叶材" | "包装" | "耗材" | "其他";
    color?: string;
    grade?: string;
    gradeSpecification?: string;
    baseUnit?: string;
    quantityScale?: number;
  },
): Promise<string> {
  const kind = material.kind ?? "花材";
  // V2 splits the material master into a flower page and a consumable page.
  const consumable = (CONSUMABLE_KIND_LABELS as readonly string[]).includes(kind);
  await gotoApp(page, consumable ? "/v2/consumables" : "/v2/materials");
  const dialog = await openDrawer(page, consumable ? "新增耗材" : "新增花材");
  const form = dialog.locator("form").first();
  await form.getByLabel("物料名称").fill(material.name);
  await form.getByLabel("物料类别").selectOption({ label: kind });
  if (!consumable) {
    if (material.color) await form.getByLabel("颜色（三级分类）", { exact: true }).fill(material.color);
    if (material.grade) await form.getByLabel("品质等级").fill(material.grade);
    if (material.gradeSpecification) await form.getByLabel("等级说明（如长度范围）").fill(material.gradeSpecification);
  }
  await form.getByLabel("库存单位").fill(material.baseUnit ?? (consumable ? "个" : "支"));
  await form.getByLabel("库存小数位数").fill(String(material.quantityScale ?? 0));
  await form.getByRole("button", { name: consumable ? "保存耗材" : "保存花材" }).click();
  await expectFeedback(page, "物料已创建");
  const banner = await page.locator("main").getByText(/物料已创建，编号\s+\S+/).first().innerText();
  return readGeneratedCode(banner, /物料已创建，编号\s+(\S+)/, "material code");
}

/** Creates one supplier through the real supplier drawer; returns the generated code. */
export async function createSupplier(
  page: Page,
  supplier: { name: string; contactName?: string; phone?: string },
): Promise<string> {
  await gotoApp(page, "/v2/suppliers");
  const dialog = await openDrawer(page, "新增供应商");
  const form = dialog.locator("form").first();
  await form.getByLabel("供应商名称").fill(supplier.name);
  if (supplier.contactName) await form.getByLabel("联系人").fill(supplier.contactName);
  if (supplier.phone) await form.getByLabel("联系电话").fill(supplier.phone);
  await form.getByRole("button", { name: "保存供应商" }).click();
  await expectFeedback(page, "供应商已创建");
  const banner = await page.locator("main").getByText(/供应商已创建，编号\s+\S+/).first().innerText();
  return readGeneratedCode(banner, /供应商已创建，编号\s+(\S+)/, "supplier code");
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
  const createDialog = await openDrawer(page, "新增商品");
  await createDialog.getByLabel("商品名称").fill(input.productName);
  await createDialog.getByRole("button", { name: "创建商品" }).click();
  await expectFeedback(page, "已创建，请添加 SKU");

  const openProduct = async () => {
    await searchCatalog(page, input.productName);
    const details = page.locator("details").filter({ has: page.locator("summary", { hasText: input.productName }) }).first();
    await details.locator("summary").filter({ hasText: input.productName }).first().click();
    return details;
  };

  let productDetails = await openProduct();
  await productDetails.getByRole("button", { name: "新增 SKU" }).click();
  const skuDialog = page.getByRole("dialog").last();
  await expect(skuDialog).toBeVisible();
  await skuDialog.getByLabel("规格名称").fill(input.skuName);
  await skuDialog.getByLabel("售价（元）").fill(String(input.price));
  await skuDialog.getByRole("button", { name: "创建 SKU" }).click();
  await expectFeedback(page, "已创建");
  const skuBanner = await page.locator("main").getByText(/SKU\s+\S+\s+已创建/).first().innerText();
  const skuCode = readGeneratedCode(skuBanner, /SKU\s+(\S+)\s+已创建/, "SKU code");

  // Set the new SKU as the default SKU (the first created SKU may already be
  // auto-promoted by the save action), then enable the product.
  productDetails = await openProduct();
  const skuDetails = productDetails.locator("details").filter({ has: page.locator("summary", { hasText: input.skuName }) }).first();
  await skuDetails.locator("summary").filter({ hasText: input.skuName }).first().click();
  const setDefaultButton = skuDetails.getByRole("button", { name: "设为默认 SKU" });
  if ((await setDefaultButton.count()) > 0) {
    await setDefaultButton.first().click();
    await expectFeedback(page, "默认 SKU 已更新");
  } else {
    await expect(skuDetails.getByText("默认", { exact: true }).first()).toBeVisible();
  }
  productDetails = await openProduct();
  await productDetails.getByRole("button", { name: "启用商品", exact: true }).click();
  await expectFeedback(page, "商品已启用");

  // First recipe draft + publish.
  await gotoApp(page, `/v2/recipes?q=${encodeURIComponent(skuCode)}`);
  const recipeDialog = await openDrawer(page, "新建配方草稿");
  const recipeEditor = recipeDialog.locator("form").first();
  await selectByText(recipeEditor.locator("select").first(), skuCode);
  for (let index = 0; index < input.recipeLines.length; index += 1) {
    if (index > 0) await recipeEditor.getByRole("button", { name: "＋ 添加物料" }).click();
    const line = input.recipeLines[index];
    await selectByText(recipeEditor.getByLabel("物料").nth(index), line.materialCode);
    await recipeEditor.getByLabel("用量").nth(index).fill(String(line.quantity));
  }
  await recipeEditor.getByRole("button", { name: "创建配方草稿" }).click();
  await expectFeedback(page, "配方草稿 v1 已创建");

  await page.getByRole("button", { name: "发布此版本" }).first().click();
  const publishDialog = page.getByRole("dialog").last();
  await expect(publishDialog).toBeVisible();
  await publishDialog.getByRole("button", { name: "确认发布" }).click();
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
