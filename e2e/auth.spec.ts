import { test, expect } from "@playwright/test";

// 이 스펙은 실제 DB가 필요하다: `docker compose up -d db` 후 실행.
// 편차: 브리프 원문의 `e2e-${Date.now()}-${random}`은 20~22자로, registerSchema의
// nickname max(20)을 거의 항상 초과해 가입이 400으로 실패한다(닉네임+"-other"까지 감안해
// base36 타임스탬프로 축약, 최대 20자 유지). 유일성·타임+난수 기반 성질은 그대로.
const unique = () => `e2e${Date.now().toString(36)}${Math.floor(Math.random() * 1000)}`;

// 편차: 이 머신의 Chromium 기본 Accept-Language가 en-US라, 쿠키 없는 첫 방문에서도
// src/i18n/request.ts의 Accept-Language 폴백이 영어를 골라 "기본은 한국어" 가정이 깨진다.
// 실제 타깃 사용자(한국어 브라우저)를 재현하도록 컨텍스트 locale을 ko-KR로 고정.
test.use({ locale: "ko-KR" });

test("register → login → authed call → logout", async ({ request }) => {
  const id = unique();
  const email = `${id}@example.com`;

  const registered = await request.post("/api/auth/register", {
    data: {
      email,
      phone: "010-1234-5678",
      nickname: id,
      password: "hunter2hunter2",
      passwordConfirm: "hunter2hunter2",
      consent: true,
    },
  });
  expect(registered.status()).toBe(201);

  const duplicate = await request.post("/api/auth/register", {
    data: {
      email,
      phone: "010-1234-5678",
      nickname: `${id}-other`,
      password: "hunter2hunter2",
      passwordConfirm: "hunter2hunter2",
      consent: true,
    },
  });
  expect(duplicate.status()).toBe(409);
  expect((await duplicate.json()).code).toBe("EMAIL_TAKEN");

  const loggedIn = await request.post("/api/auth/login", { data: { email, password: "hunter2hunter2" } });
  expect(loggedIn.ok()).toBeTruthy();
  const { accessToken } = await loggedIn.json();

  const me = await request.get("/api/auth/me", { headers: { authorization: `Bearer ${accessToken}` } });
  expect(me.ok()).toBeTruthy();
  expect((await me.json()).role).toBe("USER");

  const anonymous = await request.get("/api/auth/me");
  expect(anonymous.status()).toBe(401);

  const refreshed = await request.post("/api/auth/refresh");
  expect(refreshed.ok()).toBeTruthy();

  const loggedOut = await request.post("/api/auth/logout");
  expect(loggedOut.ok()).toBeTruthy();

  const afterLogout = await request.post("/api/auth/refresh");
  expect(afterLogout.status()).toBe(401);
});

test("wrong password gives a generic 401", async ({ request }) => {
  const res = await request.post("/api/auth/login", {
    data: { email: "nobody@example.com", password: "wrong-password" },
  });
  expect(res.status()).toBe(401);
  const body = await res.json();
  expect(body.code).toBe("AUTH_FAILED");
  expect(JSON.stringify(body)).not.toContain("nobody@example.com");
});

test("signup page renders in Korean and switches to English", async ({ page }) => {
  await page.goto("/signup");
  await expect(page.getByRole("heading", { name: "회원가입" })).toBeVisible();
  await expect(page.getByLabel("이메일")).toBeVisible();
  await expect(page.getByLabel("개인정보 수집·이용에 동의해요")).toBeVisible();

  await page.context().addCookies([{ name: "NEXT_LOCALE", value: "en", url: "http://localhost:3000" }]);
  await page.goto("/signup");
  await expect(page.getByRole("heading", { name: "Sign up" })).toBeVisible();
});

test("login page shows a friendly failure message", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("이메일").fill("nobody@example.com");
  await page.getByLabel("비밀번호").fill("wrong-password");
  await page.getByRole("button", { name: "로그인하기" }).click();
  // 편차: Next.js가 내부적으로 심어 두는 route-announcer div도 role="alert"라
  // getByRole("alert")가 strict-mode에서 두 요소와 충돌한다. 문구로 좁혀서 우리 쪽
  // 에러 배너만 가리키게 한다.
  const alert = page.getByRole("alert").filter({ hasText: "이메일이나 비밀번호를 다시 확인해 주세요" });
  await expect(alert).toHaveText("이메일이나 비밀번호를 다시 확인해 주세요");
});
