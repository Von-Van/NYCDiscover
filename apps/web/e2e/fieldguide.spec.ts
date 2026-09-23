import { expect, test } from "@playwright/test";

// Visitors may have a device timezone on a different calendar day.
test.use({ timezoneId: "Asia/Tokyo" });

test("daily discovery, kept centerpiece, outing remix, and dated share", async ({ page }, testInfo) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Your day, around here." })).toBeVisible();
  await page.getByRole("button", { name: "Manhattan", exact: true }).click();
  const free = page.locator(".discovery-card").filter({ hasText: "Something free" });
  await expect(free).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("daily-edition.png"), fullPage: true });
  const centerpiece = await free.locator("h3").innerText();
  const generationRequest = page.waitForRequest((request) => request.url().includes("/v1/itineraries/generate"));
  await free.getByRole("button", { name: /Build a plan around this/ }).focus();
  await page.keyboard.press("Enter");
  const brief = (await generationRequest).postDataJSON();
  expect(brief.centerpiece_id).toBeTruthy();
  await expect(page.locator(".timeline")).toContainText(centerpiece);
  await expect(page.getByRole("button", { name: "Kept · unlock" })).toHaveCount(1);
  await page.getByRole("button", { name: "Regenerate", exact: true }).click();
  await expect(page.getByRole("button", { name: "Regenerate", exact: true })).toBeEnabled();
  await expect(page.locator(".timeline")).toContainText(centerpiece);
  await page.getByRole("button", { name: "Kept · unlock" }).click();
  await page.getByRole("button", { name: /Start this outing/ }).click();
  await expect(page.getByRole("link", { name: /Get directions/ })).toHaveAttribute("href", /google\.com\/maps\/dir\/\?api=1/);
  await page.screenshot({ path: testInfo.outputPath("outing.png"), fullPage: true });
  await page.getByRole("button", { name: /Mark stop complete/ }).click();
  await expect(page.getByText(/1\/\d stops/)).toBeVisible();
  await page.getByText("Find another next stop", { exact: true }).click();
  const remixRequest = page.waitForRequest((request) => request.url().includes("/v1/itineraries/remix"));
  await page.getByRole("button", { name: "Find another stop", exact: true }).click();
  const remix = (await remixRequest).postDataJSON();
  expect(remix.completed_candidate_ids).toHaveLength(1);
  expect(remix.continue_outing).toBe(true);
  await expect(page.getByRole("button", { name: "Find another stop", exact: true })).toBeEnabled();
  await expect(page.locator(".results-error")).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(0);
  await page.reload();
  await page.getByRole("button", { name: /Resume/ }).click();
  await expect(page.getByText(/1\/\d stops/)).toBeVisible();
  await page.getByRole("button", { name: "See the whole plan" }).click();
  await page.getByRole("button", { name: "Share plan", exact: true }).click();
  const link = page.locator(".share-message a");
  await expect(link).toBeVisible();
  await page.goto((await link.getAttribute("href"))!);
  await expect(page.getByRole("article", { name: "Shared daily edition" })).toBeVisible();
  await expect(page.getByRole("link", { name: /Make a plan for today/ })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(0);
  await page.screenshot({ path: testInfo.outputPath("shared-edition.png"), fullPage: true });
  expect(pageErrors).toEqual([]);
});

test("session controls work when browser storage is unavailable", async ({ page }) => {
  await page.addInitScript(() => {
    for (const method of ["getItem", "setItem", "removeItem"] as const) {
      Object.defineProperty(Storage.prototype, method, { value: () => { throw new Error("Storage disabled"); } });
    }
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Surprise me", exact: true }).click();
  await expect(page.getByRole("button", { name: "Surprise me", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Reset this session", exact: true }).click();
  await expect(page.getByRole("button", { name: "Something new", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Manhattan", exact: true }).click();
  await expect(page.locator(".discovery-card").first()).toBeVisible();
});
