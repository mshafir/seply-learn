// Screenshots of the compute sample's non-canvas Views (Outline, Quadrant and
// its progression ladder, Rates & estimates), drawn from live collections, in
// the light and dark themes. Baselines live in e2e/__screenshots__ (Linux
// Chromium).
import { expect, test, type Page } from "@playwright/test";

const views: { name: string; hash: string; dark?: boolean }[] = [
  { name: "outline", hash: "outline" },
  { name: "outline-selected", hash: "outline/mla" },
  { name: "quadrant", hash: "quadrant" },
  { name: "quadrant-ladder", hash: "maturity" },
  { name: "rates", hash: "rates" },
];
const shots = views.flatMap((v) => [v, { ...v, name: `${v.name}-dark`, dark: true }]);

const settled = async (page: Page) => {
  await expect(page.locator("[data-settled]")).toBeVisible();
  await expect(page.getByTestId("metrics")).toContainText("no layout");
};

for (const { name, hash, dark } of shots) {
  test(name, async ({ page }) => {
    await page.goto(`/?instant${dark ? "&theme=dark" : ""}#${hash}`);
    await settled(page);
    await expect(page).toHaveScreenshot(`${name}.png`);
  });
}

test("the Outline opens and closes lines, and selects without toggling", async ({ page }) => {
  await page.goto("/?instant#outline");
  await settled(page);
  const inside = page.getByRole("treeitem", { name: "Inside a transformer", exact: true });
  await expect(inside).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByRole("treeitem", { name: "Multi-head Latent Attention (MLA)", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Close Inside a transformer" }).click();
  await expect(inside).toHaveAttribute("aria-expanded", "false");
  await page.getByRole("button", { name: "Open Inside a transformer" }).click();
  await expect(inside).toHaveAttribute("aria-expanded", "true");
  await page.locator('[data-concept] >> text="Compute economics"').click();
  await expect(page.locator(".seply-outline__line--selected")).toContainText("Compute economics");
  await expect(page).toHaveURL(/#outline\/t-econ$/);
});

test("switching from a canvas View to the Rates and back", async ({ page }) => {
  await page.goto("/?instant#learn");
  await expect(page.locator("[data-settled]")).toBeVisible();
  await page.getByRole("button", { name: "Rates & estimates" }).click();
  await expect(page.locator('.seply-view[data-view-type="rates"]')).toBeVisible();
  await expect(page.locator(".react-flow")).toHaveCount(0);
  await page.getByRole("button", { name: "Learning path" }).click();
  await expect(page.locator("[data-settled]")).toBeVisible();
  await expect(page.locator(".react-flow__node")).toHaveCount(24);
});
