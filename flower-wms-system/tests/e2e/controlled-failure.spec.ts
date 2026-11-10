import { expect, test } from "@playwright/test";

/**
 * Controlled failure used to prove that Playwright artifacts (trace, screenshot,
 * HTML report) are locatable. It is skipped during normal runs and only executes
 * when E2E_CONTROLLED_FAILURE=1 is set for the run.
 *
 * The case deliberately avoids login so the failure always lands on the target
 * assertion instead of a cold-start auth hiccup.
 */
test.describe("受控失败产物", () => {
  test.skip(
    process.env.E2E_CONTROLLED_FAILURE !== "1",
    "Set E2E_CONTROLLED_FAILURE=1 to run the controlled-failure evidence case.",
  );

  test("故意失败：不存在的标题断言以产出 trace/screenshot", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByRole("heading", { name: "受控失败占位标题" })).toBeVisible({ timeout: 5_000 });
  });
});
