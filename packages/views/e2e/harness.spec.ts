// Screenshots of the harness: each canvas View of the compute sample, as the
// prototype draws it, in the light theme and (risk mode, Evidence) the dark.
// Baselines live in e2e/__screenshots__ (Linux Chromium).
import { expect, test } from "@playwright/test";

const shots = [
  { name: "learning-path", hash: "learn" },
  { name: "learning-path-focus", hash: "learn/mla" },
  { name: "cause-effect-mechanism", hash: "economics" },
  { name: "cause-effect-risk", hash: "economics-risk" },
  { name: "cause-effect-risk-trace", hash: "economics-risk/distillation" },
  { name: "evidence", hash: "evidence" },
  { name: "lineage", hash: "lineage" },
  // Dark theme (@umbel/ui tokens, warm charcoal).
  { name: "cause-effect-risk-dark", hash: "economics-risk", dark: true },
  { name: "cause-effect-risk-trace-dark", hash: "economics-risk/distillation", dark: true },
  { name: "evidence-dark", hash: "evidence", dark: true },
];

for (const { name, hash, dark } of shots) {
  test(name, async ({ page }) => {
    await page.goto(`/?instant${dark ? "&theme=dark" : ""}#${hash}`);
    await expect(page.locator("[data-settled]")).toBeVisible();
    await expect(page.getByTestId("metrics")).not.toHaveText("measuring…");
    await expect(page).toHaveScreenshot(`${name}.png`);
  });
}

test("switching Views tweens and settles", async ({ page }) => {
  await page.goto("/#economics");
  await expect(page.locator("[data-settled]")).toBeVisible();
  await page.getByRole("button", { name: "Compute economics · risk" }).click();
  await expect(page.locator("[data-settled]")).toBeVisible();
  await expect(page.getByTestId("metrics")).toContainText("Compute economics · risk");
  await expect(page.locator(".umbel-band__label")).toHaveText("What you can do");
});
