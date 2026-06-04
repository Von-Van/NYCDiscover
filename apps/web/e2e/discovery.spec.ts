import { expect, test } from "@playwright/test";

test("Upper West Side social plan stays within four hours and $40", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Neighborhood, landmark, or address").fill("Upper West Side");
  await page.getByRole("button", { name: "Set" }).click();
  await expect(page.getByRole("status")).toContainText(/Starting point set|demo starting point/);
  await page.getByRole("button", { name: "Social" }).click();
  await page.getByRole("button", { name: /Make my plan/ }).click();
  await expect(page.getByRole("heading", { name: "Here’s your way out the door." })).toBeVisible();
  await expect(page.getByText(/up to \$40|up to \$25|up to \$24/).first()).toBeVisible();
  await expect(page.getByText("What to verify").first()).toBeVisible();
});

test("form reports an unresolved location", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /Make my plan/ }).click();
  await expect(page.getByRole("alert")).toContainText("Choose a starting location.");
});

