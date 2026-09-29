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
  { name: "anatomy", hash: "anatomy" },
  { name: "comparison-table-models", hash: "models" },
  { name: "comparison-table-options", hash: "compare", expedition: "options" },
  // Dark theme (@umbel/ui tokens, warm charcoal).
  { name: "cause-effect-risk-dark", hash: "economics-risk", dark: true },
  { name: "cause-effect-risk-trace-dark", hash: "economics-risk/distillation", dark: true },
  { name: "cause-effect-mechanism-dark", hash: "economics", dark: true },
  { name: "evidence-dark", hash: "evidence", dark: true },
  { name: "lineage-dark", hash: "lineage", dark: true },
  { name: "anatomy-dark", hash: "anatomy", dark: true },
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

test("clicking a risk-mode lever lights its real path", async ({ page }) => {
  await page.goto(url("economics-risk"));
  await settled(page);
  const card = (title: string) =>
    page.locator(".umbel-concept", { has: page.locator(".umbel-concept__title", { hasText: new RegExp(`^${title}$`) }) });
  const lever = card("Distillation");
  await expect(lever).toContainText("acts on Serving cost per token");
  const edges = page.locator(".react-flow__edge");
  const before = await edges.count();
  await lever.click();
  await expect(lever).toHaveClass(/umbel-concept--selected/);
  await expect(page).toHaveURL(/#economics-risk\/distillation$/);
  // Its path: serving cost per token, then usage growth, compute demand and the price.
  const lit = await page.locator(".umbel-concept:not(.umbel-concept--dim) .umbel-concept__title").allInnerTexts();
  expect(lit.sort()).toEqual(["Compute demand", "Distillation", "Frontier inference price & scarcity", "Serving cost per token", "Usage growth"]);
  // The lever's real edge replaces its line to the outcome: same count.
  await expect(edges).toHaveCount(before);
  await expect(card("Serving cost per token")).toContainText("▼ lowered");
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
  // The new technique needs MLA, so everything on MLA's path is now shared by
  // one more target. That lifts two foundations over the "shared by enough
  // targets" bar, and they join the core: the technique plus those two.
  await expect(page.locator(".react-flow__node")).toHaveCount(before + 3);
  await expect(page.getByText("Technique 1 (another tab)")).toBeVisible();
  await expect(page.getByText("Heads (Q · K · V)")).toBeVisible();
  await expect(page.getByText("Query, key, value")).toBeVisible();
  await expect(page.locator("[data-settled]")).toBeVisible();
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
