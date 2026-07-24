import { test, expect } from "@playwright/test";

// 프론트엔드 회귀 — 이번에 발견된 실제 버그들을 코드로 고정한다.
// (navbar가 로그인 반영 안 함 / 가입 링크 404 / 페이지 로드 콘솔 크래시 / 앱 셸 부재 등)
test.use({ locale: "ko-KR" });

const DEMO = { email: "demo@example.com", password: "demo12345", nickname: "데모유저" };

async function login(page: import("@playwright/test").Page) {
  await page.goto("/login");
  await page.getByRole("textbox").first().fill(DEMO.email);
  await page.locator('input[type="password"]').fill(DEMO.password);
  await page.getByRole("button", { name: /로그인|log in/i }).click();
  await page.waitForLoadState("networkidle");
}

test("홈: 앱 셸(네비·히어로·상품 그리드)이 있고 가입 링크가 /signup을 가리킨다", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("banner")).toContainText("동네장터");
  // 히어로 CTA
  await expect(page.getByRole("link", { name: /상품 둘러보기/ })).toBeVisible();
  // 회원가입 링크는 존재하는 /signup을 가리켜야 한다(과거 /register 404 버그)
  const signupLinks = page.locator('a[href="/signup"]');
  await expect(signupLinks.first()).toBeVisible();
  await expect(page.locator('a[href="/register"]')).toHaveCount(0);
});

test("로그인하면 navbar가 즉시 로그인 상태를 반영한다(RSC 갱신)", async ({ page }) => {
  await login(page);
  const header = page.getByRole("banner");
  await expect(header).toContainText(DEMO.nickname);
  await expect(header.getByRole("button", { name: /로그아웃/ })).toBeVisible();
  await expect(header.getByRole("link", { name: /판매하기/ })).toBeVisible();
});

test("로그아웃하면 navbar가 즉시 로그아웃 상태로 돌아간다", async ({ page }) => {
  await login(page);
  await page.getByRole("banner").getByRole("button", { name: /로그아웃/ }).click();
  await page.waitForLoadState("networkidle");
  await expect(page.getByRole("banner").getByRole("link", { name: /로그인/ })).toBeVisible();
  await expect(page.getByRole("banner")).not.toContainText(DEMO.nickname);
});

test("주요 페이지 로드 시 콘솔/페이지 에러가 없다", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push(e.message));
  await login(page);
  for (const path of ["/", "/products", "/chat", "/escrow", "/mypage", "/settings"]) {
    await page.goto(path, { waitUntil: "networkidle" });
  }
  // 상품 상세 하나
  await page.goto("/products");
  const href = await page.locator('a[href^="/products/"]').first().getAttribute("href");
  if (href) await page.goto(href, { waitUntil: "networkidle" });
  expect(errors, `콘솔/페이지 에러:\n${errors.join("\n")}`).toEqual([]);
});

test("없는 페이지는 브랜드형 404를 보여준다(기본 미스타일 화면 아님)", async ({ page }) => {
  await page.goto("/this-page-does-not-exist-xyz");
  await expect(page.getByText("페이지를 찾을 수 없어요")).toBeVisible();
  await expect(page.getByRole("link", { name: /홈으로/ })).toBeVisible();
  // 앱 셸(네비)은 유지된다
  await expect(page.getByRole("banner")).toContainText("동네장터");
});

test("가입·약관·설정 페이지가 실제로 존재한다(404 아님)", async ({ page }) => {
  for (const path of ["/signup", "/terms"]) {
    const res = await page.goto(path);
    expect(res?.status(), path).toBe(200);
  }
  // 설정은 로그인 필요 — 로그인 후 200
  await login(page);
  const res = await page.goto("/settings");
  expect(res?.status()).toBe(200);
  await expect(page.getByRole("heading", { name: /설정/ })).toBeVisible();
});
