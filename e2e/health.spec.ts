import { test, expect } from "@playwright/test";

test("home shows heading + status, and locale toggle switches to English", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading")).toBeVisible();
  await expect(page.getByRole("status")).toBeVisible();

  await page.getByRole("button", { name: "English" }).click();
  await expect(page.getByRole("heading", { name: "Server status" })).toBeVisible();
});

test("api health returns ok json", async ({ request }) => {
  const res = await request.get("/api/health");
  expect(res.ok()).toBeTruthy();
  const body = await res.json();
  expect(body.status).toBe("ok");
});
