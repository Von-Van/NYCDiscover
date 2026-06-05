import { expect, test } from "@playwright/test";

test("Upper West Side social plan stays within four hours and $40", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Neighborhood, landmark, or address").fill("Upper West Side");
  await page.getByRole("button", { name: "Set" }).click();
  await expect(page.getByRole("status")).toContainText(/Starting point set|demo starting point/);
  await page.getByRole("button", { name: "Social" }).click();
  await page.getByRole("button", { name: /Make my plan/ }).click();
  await expect(page.getByRole("heading", { name: "Here’s your way out the door." })).toBeVisible();
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
