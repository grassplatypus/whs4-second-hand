import { test, expect } from "@playwright/test";

// 실 DB 필요: docker compose up -d db 후 실행. 목 provider라 실 네트워크 없음.
// mock_as로 실행마다 고유 신원 → 이전 실행 행과 충돌 없음.
const unique = () => `e2e${Date.now()}${Math.floor(Math.random() * 1000)}`;

// 편차: Playwright의 최상위 `request` 픽스처는 독립된 쿠키 저장소를 쓴다(브라우저
// `context`/`page`와 공유하지 않음) — 실측 확인(디버그 스펙: plain request 401 vs
// context.request 200, 동일 refresh_token 쿠키로). 그래서 page.goto로 발급받은
// refresh_token 쿠키를 태워 보내야 하는 호출은 `context.request`를 쓴다. Authorization
// 헤더만으로 인증하는 호출(/me)이나 사전에 쿠키가 없는 최초 호출(register)은 브리프
// 원문대로 `request`를 그대로 쓴다.
test.use({ locale: "ko-KR" });

test("social signup → relogin same user → link second → unlink", async ({ page, context, request }) => {
  const alice = unique();

  // 1) 카카오로 소셜 가입 (start가 목 콜백으로 바로 되돌림)
  await page.goto(`/api/auth/oauth/kakao/start?mock_as=${alice}`);
  await expect(page).toHaveURL(/\/$/); // 콜백이 / 로 리다이렉트
  const afterSignup = await context.cookies();
  expect(afterSignup.find((c) => c.name === "refresh_token")).toBeTruthy();

  // access 취득 → /me 동작 (쿠키는 context.request로만 전달됨 — 위 편차 설명 참고)
  const me1 = await context.request.post("/api/auth/refresh");
  expect(me1.ok()).toBeTruthy();
  const { accessToken } = await me1.json();
  const meRes = await request.get("/api/auth/me", { headers: { authorization: `Bearer ${accessToken}` } });
  expect(meRes.ok()).toBeTruthy();

  // 2) 같은 mock_as로 재로그인 → 같은 유저(중복 생성 없음): 연동 페이지에 KAKAO 1개
  await page.goto("/settings/connections");
  await expect(page.getByText("카카오로 계속하기")).toBeVisible();
  await expect(page.getByRole("button", { name: "연결 해제" })).toHaveCount(1); // 카카오만 연결됨

  // 3) 네이버 연동 (로그인 상태 = refresh 쿠키)
  await page.goto(`/api/auth/oauth/naver/start?link=1&mock_as=${alice}`);
  await expect(page).toHaveURL(/settings\/connections/);
  await page.reload();
  await expect(page.getByRole("button", { name: "연결 해제" })).toHaveCount(2); // 카카오+네이버

  // 4) 네이버 해제 성공 (자격증명 2개라 마지막 아님)
  await page.getByRole("button", { name: "연결 해제" }).nth(1).click();
  await expect(page.getByRole("button", { name: "연결 해제" })).toHaveCount(1);
});

test("last-credential unlink is refused", async ({ page }) => {
  const bob = unique();
  await page.goto(`/api/auth/oauth/google/start?mock_as=${bob}`);
  await expect(page).toHaveURL(/\/$/);
  await page.goto("/settings/connections");
  await page.getByRole("button", { name: "연결 해제" }).click();
  // 편차: Next.js가 심는 route-announcer div도 role="alert"라 getByRole("alert")가
  // strict-mode에서 2개와 충돌한다(e2e/auth.spec.ts와 동일 사례). 문구로 좁힌다.
  const alert = page.getByRole("alert").filter({ hasText: "마지막 로그인 수단이라 해제할 수 없어요" });
  await expect(alert).toHaveText("마지막 로그인 수단이라 해제할 수 없어요");
});

test("forged callback state is rejected", async ({ page }) => {
  // state 쿠키 없이 콜백 직접 호출 → 로그인 페이지로 에러 리다이렉트
  await page.goto("/api/auth/oauth/kakao/callback?code=x&state=forged");
  await expect(page).toHaveURL(/\/login\?error=oauth_failed/);
});

test("oauth email collision is not auto-linked", async ({ page, request }) => {
  const carol = unique();
  const email = `kakao.${carol}@example.com`; // 목 카카오가 만들 이메일과 동일
  // 먼저 로컬 가입으로 그 이메일 선점
  const reg = await request.post("/api/auth/register", {
    data: { email, phone: "010-1234-5678", nickname: carol.slice(0, 18), password: "hunter2hunter2", passwordConfirm: "hunter2hunter2", consent: true },
  });
  expect(reg.status()).toBe(201);
  // 같은 이메일로 카카오 OAuth → 자동 연동 안 하고 에러 + 안내 문구 렌더링
  await page.goto(`/api/auth/oauth/kakao/start?mock_as=${carol}`);
  await expect(page).toHaveURL(/\/login\?error=email_exists/);
  // 편차: Next.js가 심는 route-announcer div도 role="alert"라 getByRole("alert")가
  // strict-mode에서 2개와 충돌한다(위 last-credential 테스트와 동일 사례). 문구로 좁힌다.
  const alert = page.getByRole("alert").filter({ hasText: "이 이메일은 이미 가입돼 있어요. 로그인 후 여기서 연결해 주세요" });
  await expect(alert).toBeVisible();
});
