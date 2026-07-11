import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { resolve } from "node:path";

const generatedFixtureDir = resolve("tests/fixtures/generated");

test.beforeEach(async ({ page }) => {
  await routeGeneratedData(page);
});

test.describe("visual regression", () => {
  const viewports = [
    { name: "mobile", width: 390, height: 844 },
    { name: "tablet", width: 768, height: 1024 },
    { name: "desktop", width: 1440, height: 900 }
  ];

  for (const viewport of viewports) {
    test(`home ${viewport.name}`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await page.goto("/");
      await expect(page.getByRole("heading", { name: "郡山の施設・お知らせ" })).toBeVisible();
      await expect(page).toHaveScreenshot(`home-${viewport.name}.png`, {
        fullPage: true,
        animations: "disabled"
      });
    });
  }
});

test.describe("accessibility", () => {
  const routes = ["/", "/news", "/search?type=place&category=aed", "/map?category=aed"];

  for (const route of routes) {
    test(`axe ${route}`, async ({ page }) => {
      await page.goto(route);
      await page.locator("main").waitFor();
      const results = await new AxeBuilder({ page }).include("main").analyze();

      expect(results.violations).toEqual([]);
    });
  }
});

test("news renders 24 items first and loads 24 more", async ({ page }) => {
  await page.goto("/news");
  await expect(page.getByRole("heading", { name: "すべてのお知らせ 30件" })).toBeVisible();
  await expect(page.locator(".news-card")).toHaveCount(24);

  await page.getByRole("button", { name: "さらに表示" }).click();
  await expect(page.locator(".news-card")).toHaveCount(30);

  await page.getByRole("button", { name: "防災" }).click();
  await expect(page.getByRole("button", { name: "防災" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("heading", { name: "防災のお知らせ 5件" })).toBeVisible();
  await expect(page.locator(".news-card")).toHaveCount(5);
});

test("news card click target covers the card", async ({ page }) => {
  await page.goto("/news");

  await page.locator(".news-card").first().click({ position: { x: 18, y: 18 } });
  await expect(page).toHaveURL(/\/news\/01$/);
});

test("structured place category search returns places and map link", async ({ page }) => {
  await page.goto("/search?type=place&category=aed");

  await expect(page.getByRole("heading", { name: "AEDの施設 2件" })).toBeVisible();
  await expect(page.locator(".place-card")).toHaveCount(2);
  await expect(page.getByRole("link", { name: "地図で見る" }).first()).toHaveAttribute("href", "/map?category=aed");
});

test("free text search can be limited to news", async ({ page }) => {
  await page.goto("/search?q=熱中症&type=news");

  await expect(page.getByRole("heading", { name: "「熱中症」の結果 1件" })).toBeVisible();
  await expect(page.locator(".news-card")).toHaveCount(1);
  await expect(page.locator(".news-card mark").first()).toHaveText("熱中症");
  await expect(page.locator(".place-card")).toHaveCount(0);
});

test("map list selects a place on the same page", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/map?category=aed");

  await expect(page.getByText("2件の施設があります。")).toBeVisible();
  await expect(page.getByRole("group", { name: "表示方法" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "施設一覧" })).toBeVisible();
  await expect(page.locator(".map-place-select")).toHaveCount(2);

  await page.locator(".map-place-select").first().click();
  await expect(page.getByRole("button", { name: "閉じる" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "郡山駅前AED" })).toBeVisible();
  await expect(page.locator(".map-canvas")).toBeInViewport();
  await expect(page.locator(".map-pin.is-selected")).toBeVisible();
});

async function routeGeneratedData(page: Page): Promise<void> {
  const files = [
    "build-meta.json",
    "home.json",
    "news.json",
    "places.json",
    "places.geojson",
    "search-index.json"
  ];

  for (const file of files) {
    await page.route(`**/generated/${file}`, (route) =>
      route.fulfill({
        path: resolve(generatedFixtureDir, file),
        contentType: file.endsWith(".geojson") ? "application/geo+json" : "application/json"
      })
    );
  }
}
