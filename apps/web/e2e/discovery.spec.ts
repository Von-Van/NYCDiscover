import { expect, test, type Page } from "@playwright/test";

async function generatePlan(page: Page) {
  await page.goto("/");
  await page.getByLabel("Neighborhood, landmark, or address").fill("Upper West Side");
  await page.getByRole("button", { name: "Set" }).click();
  await expect(page.getByRole("status")).toContainText(/Starting point set|demo starting point/);
  await page.getByRole("button", { name: /Make my plan/ }).click();
  await expect(page.getByRole("heading", { name: "Here’s your way out the door." })).toBeVisible();
}

test("Upper West Side social plan stays within four hours and $40", async ({ page }) => {
  await generatePlan(page);
  const planTabs = page.getByRole("navigation", { name: "Choose an itinerary" });
  await expect(planTabs).toContainText(/up to \$(\d+)/);
  const costs = await planTabs.getByText(/up to \$(\d+)/).allTextContents();
  expect(costs.length).toBeGreaterThan(0);
  for (const cost of costs) {
    expect(Number(cost.match(/up to \$(\d+)/)?.[1])).toBeLessThanOrEqual(40);
  }
  await expect(page.getByText("What to verify").first()).toBeVisible();
});

test("form reports an unresolved location", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /Make my plan/ }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "Choose a starting location." }),
  ).toContainText("Choose a starting location.");
});

test.describe("desktop editorial workspace", () => {
  test.beforeEach(async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop-chromium", "Desktop-specific acceptance coverage");
    await page.setViewportSize({ width: 1440, height: 900 });
  });

  test("keeps the primary form and results surfaces in the first viewport", async ({ page }) => {
    await page.goto("/");
    const callToAction = page.getByRole("button", { name: /Make my plan/ });
    const callToActionBox = await callToAction.boundingBox();
    expect(callToActionBox).not.toBeNull();
    expect(callToActionBox!.y + callToActionBox!.height).toBeLessThanOrEqual(900);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(0);

    await page.getByLabel("Neighborhood, landmark, or address").fill("Upper West Side");
    await page.getByRole("button", { name: "Set" }).click();
    await expect(page.getByRole("status")).toContainText(/Starting point set|demo starting point/);
    await callToAction.click();
    await expect(page.getByRole("heading", { name: "Here’s your way out the door." })).toBeVisible();

    const resultGridBox = await page.locator(".result-grid").boundingBox();
    expect(resultGridBox).not.toBeNull();
    expect(resultGridBox!.y).toBeLessThanOrEqual(560);
    const planTabs = page.getByRole("navigation", { name: "Choose an itinerary" });
    const comparisonLabels = await planTabs.locator("mark").allTextContents();
    expect(comparisonLabels).toContain("Best overall");
    expect(new Set(comparisonLabels).size).toBe(comparisonLabels.length);
    await expect(page.getByLabel(/Map for/)).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(0);
  });

  test("edits a committed brief in the docked inspector", async ({ page }) => {
    await generatePlan(page);
    await page.getByRole("button", { name: "Change the brief" }).click();

    const inspector = page.locator(".brief-inspector");
    const inspectorBox = await inspector.boundingBox();
    expect(inspectorBox).not.toBeNull();
    expect(inspectorBox!.width).toBe(360);
    expect(inspectorBox!.y + inspectorBox!.height).toBeLessThanOrEqual(900);

    await page.getByRole("button", { name: "transit" }).click();
    await page.keyboard.press("Escape");
    await expect(inspector).toBeHidden();
    await page.getByRole("button", { name: "Change the brief" }).click();
    await expect(page.getByRole("button", { name: "walk" })).toHaveAttribute("aria-pressed", "true");

    await page.getByRole("button", { name: "transit" }).click();
    await page.getByRole("button", { name: /Update plans/ }).click();
    await expect(inspector).toBeHidden();
    await expect(page.getByText("Travel", { exact: true }).locator("..")).toContainText("transit");
  });

  test("synchronizes marker and timeline selection without rebuilding the workspace", async ({ page }) => {
    await generatePlan(page);
    const timelineStops = page.locator(".timeline > li");
    const timelineButtons = page.getByRole("button", { name: /^Show stop \d/ });
    const mapPins = page.locator(".map-shell .map-pin");
    const firstPin = mapPins.nth(0);
    const secondPin = mapPins.nth(1);
    const secondStop = timelineStops.nth(1);
    expect(await timelineStops.count()).toBeGreaterThanOrEqual(2);
    await expect(secondPin).toBeVisible();

    await timelineButtons.nth(0).hover();
    await expect(firstPin).toHaveClass(/active/);
    await secondPin.hover();
    await expect(secondStop).toHaveClass(/active/);
    const secondStopName = (await secondPin.getAttribute("aria-label"))?.replace(/^Stop 2: /, "");
    expect(secondStopName).toBeTruthy();
    await secondPin.focus();
    await page.keyboard.press("Enter");
    await expect(secondPin).toHaveClass(/selected/);
    await expect(secondStop).toHaveClass(/active/);
    await expect(page.locator(".maplibregl-popup-content")).toContainText(secondStopName!);

    await page.getByRole("button", { name: /Plan B/ }).click();
    await expect(page.locator(".map-pin.selected")).toHaveCount(0);
    await expect(page.locator(".map-shell .map-pin").first()).toBeVisible();
  });

  test("uses overlay and full-width inspector modes below desktop", async ({ page }) => {
    await generatePlan(page);
    await page.setViewportSize({ width: 1099, height: 800 });
    await page.getByRole("button", { name: "Change the brief" }).click();
    const inspector = page.locator(".brief-inspector");
    await expect(inspector).toHaveCSS("position", "fixed");
    expect((await inspector.boundingBox())!.width).toBe(360);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(0);

    await page.keyboard.press("Escape");
    await page.setViewportSize({ width: 720, height: 800 });
    await page.getByRole("button", { name: "Change the brief" }).click();
    expect((await inspector.boundingBox())!.width).toBe(720);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(0);
  });
});
