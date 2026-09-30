// Screenshots and interactions of the Map and Timeline Views in the harness:
// the synthetic trip (Map and Timeline) and the compute sample's Timeline,
// light and dark. Baselines live in e2e/__screenshots__ (Linux Chromium).
//
// Every request off the harness's origin is aborted, so the shots never
// depend on the network: the Map's detailed tiles come from a tiny PMTiles
// test extract the harness serves (harness/public/tiles, Natural Earth in
// the Protomaps schema; see its README), and "the tile host is down" is that
// file's request aborted. The clock is fixed, so the Timeline's "now" line
// stays put.
import { expect, test, type Page } from "@playwright/test";

const TEST_TILES = "/tiles/alps-test.pmtiles";

test.beforeEach(async ({ page }) => {
  await page.route((url) => !["localhost", "127.0.0.1"].includes(url.hostname), (route) => route.abort());
  await page.clock.setFixedTime(new Date("2026-09-29T12:00:00"));
});

const open = async (page: Page, hash: string, opts: { expedition?: string; dark?: boolean; tiles?: string | null } = {}) => {
  const q = ["instant", opts.expedition && `expedition=${opts.expedition}`, opts.dark && "theme=dark", opts.tiles && `tiles=${opts.tiles}`];
  await page.goto(`/?${q.filter(Boolean).join("&")}#${hash}`);
  await expect(page.locator("[data-settled]")).toBeVisible({ timeout: 20_000 });
};

for (const dark of [false, true]) {
  const theme = dark ? "-dark" : "";

  test(`map: the trip on our PMTiles${theme}`, async ({ page }) => {
    await open(page, "map", { expedition: "trip", dark, tiles: TEST_TILES });
    await expect(page.locator(".seply-pin")).toHaveCount(12);
    await expect(page.getByTestId("map-note")).toHaveCount(0);
    await expect(page).toHaveScreenshot(`map-trip${theme}.png`);
  });

  test(`map: the tile host blocked shows the coarse world with a note${theme}`, async ({ page }) => {
    await page.route((url) => url.pathname === TEST_TILES, (route) => route.abort());
    await open(page, "map", { expedition: "trip", dark, tiles: TEST_TILES });
    await expect(page.getByTestId("map-note")).toHaveText(/Detailed map unavailable/);
    await expect(page.locator(".seply-pin")).toHaveCount(12);
    await expect(page).toHaveScreenshot(`map-trip-coarse${theme}.png`);
  });

  test(`timeline: the trip${theme}`, async ({ page }) => {
    await open(page, "timeline", { expedition: "trip", dark });
    // The week's items (the planning months are outside the opening window).
    await expect(page.locator(".seply-tl-label")).toHaveCount(13);
    await expect(page).toHaveScreenshot(`timeline-trip${theme}.png`);
  });

  test(`timeline: the compute sample${theme}`, async ({ page }) => {
    await open(page, "timeline", { dark });
    await expect(page.locator(".vis-labelset .vis-label")).toHaveText(["Ideas", "Models", "Compute & market"]);
    await expect(page.locator(".seply-tl-label", { hasText: "Multi-head Latent Attention (MLA)" })).toBeVisible();
    // Baselined outside CI's Chromium build: text antialiasing across this
    // dense, label-heavy shot differs by ~2.9% (as lineage-dark's does).
    // TODO: re-baseline it from CI's Chromium and drop the looser ratio.
    await expect(page).toHaveScreenshot(`timeline-compute${theme}.png`, { maxDiffPixelRatio: 0.035 });
  });
}

test("map: with no tiles configured, the OpenFreeMap fallback is tried, and blocked, it leaves the coarse world", async ({ page }) => {
  const asked: string[] = [];
  page.on("request", (r) => asked.push(r.url()));
  await open(page, "map", { expedition: "trip" });
  expect(asked.some((u) => u.startsWith("https://tiles.openfreemap.org/styles/positron"))).toBe(true);
  await expect(page.getByTestId("map-note")).toBeVisible();
  await expect(page.locator(".seply-pin")).toHaveCount(12);
});

test("map: clicking a pin selects its Concept; switching theme keeps the pins", async ({ page }) => {
  await open(page, "map", { expedition: "trip", tiles: TEST_TILES });
  await page.getByRole("button", { name: "Zermatt", exact: true }).click();
  await expect(page).toHaveURL(/#map\/zermatt$/);
  await expect(page.locator(".seply-pin--selected")).toHaveAttribute("aria-label", "Zermatt");
  await page.getByRole("button", { name: "Dark theme" }).click();
  await expect(page.locator("html")).toHaveClass(/dark/);
  await expect(page.locator(".seply-pin")).toHaveCount(12);
  await expect(page.locator(".seply-pin--selected")).toHaveAttribute("aria-label", "Zermatt");
});

test("map and timeline: another tab's new place appears as a pin and an item", async ({ page }) => {
  await open(page, "map", { expedition: "trip", tiles: TEST_TILES });
  await page.getByRole("button", { name: /Another tab's edit/ }).click();
  await expect(page.locator(".seply-pin")).toHaveCount(13);
  await page.getByRole("button", { name: "The week" }).click();
  await expect(page.locator(".seply-tl-label")).toHaveCount(14);
});

test("timeline: clicking an item selects its Concept", async ({ page }) => {
  await open(page, "timeline", { expedition: "trip" });
  await page.locator(".vis-item", { hasText: "Up the Rigi" }).click();
  await expect(page).toHaveURL(/#timeline\/day-rigi$/);
  await expect(page.locator(".vis-item.vis-selected:not(.vis-dot)")).toHaveText(/Up the Rigi/);
});
