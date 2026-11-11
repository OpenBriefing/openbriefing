// Not a test of behaviour: writes screenshots for a person to look at.
// Run with SHOTS=1 npx playwright test e2e/shots.spec.ts
import { expect, test } from "@playwright/test";

test.skip(!process.env.SHOTS, "set SHOTS=1 to write screenshots");

const dir = process.env.SHOTS_DIR ?? "test-results/shots";
for (const [name, width, scheme] of [["desktop", 1280, "light"], ["mobile", 390, "light"], ["desktop-dark", 1280, "dark"]] as const) {
  test(`shots ${name}`, async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: scheme, deviceScaleFactor: 1 });
    const page = await context.newPage();
    for (const path of ["/", "/ns", "/spec/v1", "/adopters"]) {
      await page.goto(path);
      await page.screenshot({ path: `${dir}/${name}${path === "/" ? "-home" : path.replace(/\//gu, "-")}.png`, fullPage: path !== "/spec/v1" });
    }
    await page.goto("/check");
    await page.getByRole("button", { name: "every tag" }).click();
    await expect(page.locator("#check-result .verdict")).toBeVisible();
    await page.waitForTimeout(600);
    await page.screenshot({ path: `${dir}/${name}-check.png`, fullPage: true });
    await context.close();
  });
}
