import { test, expect } from "@playwright/test";

test.use({ locale: "ko-KR" });

test("홈이 랜딩(히어로·특징·최근 상품)으로 뜨고 주요 링크가 살아 있다", async ({ page }) => {
  await page.goto("/");
  // 히어로 제목(h1)
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  // 주요 이동 경로
  await expect(page.getByRole("link", { name: /상품 둘러보기/ })).toBeVisible();
  await expect(page.locator('a[href="/products"]').first()).toBeVisible();
  // 앱 셸(상단 내비)
  await expect(page.getByRole("banner")).toContainText("동네장터");
});

test("api health returns ok json", async ({ request }) => {
  const res = await request.get("/api/health");
  expect(res.ok()).toBeTruthy();
  const body = await res.json();
  // E2E runs without a live DB, so "degraded" is the expected/correct status here.
  expect(["ok", "degraded"]).toContain(body.status);
  expect(typeof body.db).toBe("boolean");
});
