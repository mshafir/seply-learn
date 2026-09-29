// Screenshots of the harness: the Views of the compute sample (and the
// synthetic options table), drawn from live collections, in the light theme
// and some in the dark. Baselines live in e2e/__screenshots__ (Linux
// Chromium).
import { expect, test, type Page } from "@playwright/test";

const shots = [
  { name: "learning-path", hash: "learn" },
  { name: "learning-path-focus", hash: "learn/mla" },
  { name: "cause-effect-mechanism", hash: "economics" },
  { name: "cause-effect-risk", hash: "economics-risk" },
  { name: "cause-effect-risk-trace", hash: "economics-risk/distillation" },
  { name: "evidence", hash: "evidence" },
  { name: "lineage", hash: "lineage" },
  { name: "comparison-table-models", hash: "models" },
  { name: "comparison-table-options", hash: "compare", expedition: "options" },
  // Dark theme (@umbel/ui tokens, warm charcoal).
  { name: "cause-effect-risk-dark", hash: "economics-risk", dark: true },
  { name: "cause-effect-risk-trace-dark", hash: "economics-risk/distillation", dark: true },
  { name: "evidence-dark", hash: "evidence", dark: true },
  { name: "comparison-table-options-dark", hash: "compare", expedition: "options", dark: true },
];

const url = (hash: string, opts: { expedition?: string; dark?: boolean; instant?: boolean } = {}) => {
  const q = [opts.instant !== false && "instant", opts.expedition && `expedition=${opts.expedition}`, opts.dark && "theme=dark"];
  return `/?${q.filter(Boolean).join("&")}#${hash}`;
};
const settled = async (page: Page) => {
  await expect(page.locator("[data-settled]")).toBeVisible();
  await expect(page.getByTestId("metrics")).not.toHaveText("measuring…");
};

for (const { name, hash, dark, expedition } of shots) {
  test(name, async ({ page }) => {
    await page.goto(url(hash, { dark, expedition }));
    await settled(page);
    await expect(page).toHaveScreenshot(`${name}.png`);
  });
}

test("switching Views tweens and settles", async ({ page }) => {
  await page.goto(url("economics", { instant: false }));
  await expect(page.locator("[data-settled]")).toBeVisible();
  await page.getByRole("button", { name: "Compute economics · risk" }).click();
  await expect(page.locator("[data-settled]")).toBeVisible();
  await expect(page.getByTestId("metrics")).toContainText("Compute economics · risk");
  await expect(page.locator(".umbel-band__label")).toHaveText("What you can do");
});

test("switching between the Learning path and a Comparison Table", async ({ page }) => {
  await page.goto(url("learn", { instant: false }));
  await expect(page.locator("[data-settled]")).toBeVisible();
  await page.getByRole("button", { name: "Open models" }).click();
  await expect(page.locator('.umbel-view[data-view-type="comparison-table"]')).toBeVisible();
  await expect(page.locator(".react-flow")).toHaveCount(0);
  await page.getByRole("button", { name: "Learning path" }).click();
  await expect(page.locator('.umbel-view[data-view-type="learning-path"]')).toBeVisible();
  await expect(page.locator("[data-settled]")).toBeVisible();
  await expect(page.locator(".react-flow__node")).toHaveCount(24);
});

test("another tab's edit reflows the Learning path after a pull", async ({ page }) => {
  await page.goto(url("learn"));
  await settled(page);
  const before = await page.locator(".react-flow__node").count();
  await page.getByRole("button", { name: /Another tab's edit/ }).click();
  await expect(page.locator(".react-flow__node")).toHaveCount(before + 1);
  await expect(page.getByText("Technique 1 (another tab)")).toBeVisible();
  await expect(page).toHaveScreenshot("learning-path-after-pull.png");
});

test("another tab's verdict fills a '?' in the Comparison Table", async ({ page }) => {
  await page.goto(url("compare", { expedition: "options" }));
  await settled(page);
  const crema = page.locator("tr", { hasText: "Crema Compact" });
  await expect(crema.locator(".umbel-table__unknown")).toHaveCount(2);
  await page.getByRole("button", { name: /Another tab's edit/ }).click();
  await expect(crema.locator(".umbel-table__unknown")).toHaveCount(1);
  await expect(crema).toHaveClass(/umbel-table__row--fails/);
});
