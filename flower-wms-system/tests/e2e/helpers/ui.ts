import { expect, type Locator, type Page } from "@playwright/test";

/**
 * Navigates within the app and waits until the Next dev client runtime is
 * hydrated.
 *
 * Next dev renders HTML on the server immediately, but the React client runtime
 * connects its HMR websocket afterwards and only then attaches event handlers to
 * client components. Interacting before that turns a form submit into a native
 * GET request, so every navigation waits for "[HMR] connected" (plus the load
 * state) before a test touches the page. Production `next start` has no HMR
 * client; the helper falls back to a short settle after network idle.
 */
export async function gotoApp(page: Page, path: string): Promise<void> {
  let hmrConnected = false;
  const onConsole = (message: import("@playwright/test").ConsoleMessage) => {
    if (message.text().includes("[HMR] connected")) hmrConnected = true;
  };
  page.on("console", onConsole);
  try {
    await page.goto(path);
    await page.waitForLoadState("networkidle").catch(() => undefined);
    const deadline = Date.now() + 90_000;
    while (!hmrConnected && Date.now() < deadline) {
      await page.waitForTimeout(100);
    }
    // Hydration starts around the HMR handshake; give React one paint cycle.
    await page.evaluate(() => new Promise<void>((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    }));
    await page.waitForTimeout(300);
  } finally {
    page.off("console", onConsole);
  }
}

/** Waits for the client runtime of the current page without navigating. */
export async function waitForHydration(page: Page): Promise<void> {
  const hydrated = await page.evaluate(() => ({
    readyState: document.readyState,
    hasNextRuntime: typeof (window as { next?: unknown }).next !== "undefined",
  }));
  expect(hydrated.readyState).toBe("complete");
}

/** Asia/Shanghai `datetime-local` value for `days` days from now. */
export function futureDateTimeLocal(days: number, hour = 10): string {
  const date = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}T${String(hour).padStart(2, "0")}:00`;
}

/** Clicks a `<summary>` toggle by its exact visible text. */
export async function toggle(page: Page, name: string): Promise<void> {
  const summary = page.locator("summary").filter({ hasText: name }).first();
  if ((await summary.count()) > 0) {
    await summary.click();
    return;
  }
  await page.getByText(name, { exact: true }).first().click();
}

/** Selects the option of a native `<select>` whose visible text contains `text`. */
export async function selectByText(select: Locator, text: string): Promise<void> {
  const option = select.locator("option").filter({ hasText: text }).first();
  const value = await option.getAttribute("value");
  if (!value) throw new Error(`No option matching "${text}"`);
  await select.selectOption(value);
}

/** Asserts the module feedback banner (message or error) contains `text`. */
export async function expectFeedback(page: Page, text: string): Promise<void> {
  await expect(page.locator("main").getByText(text, { exact: false }).first()).toBeVisible();
}

/** Waits for a redirect whose URL contains `fragment`. */
export async function waitForUrl(page: Page, fragment: string): Promise<void> {
  await page.waitForURL((url) => url.toString().includes(fragment), { timeout: 90_000 });
}

/** Opens a V2 module through the sidebar link. */
export async function gotoModule(page: Page, label: string): Promise<void> {
  await page.getByRole("link", { name: label, exact: true }).click();
}
