import { test, expect } from "@playwright/test";
// otplib v13은 함수형 API로 재작성됐다(v12의 `authenticator` 싱글턴 없음) — 앱의
// src/features/auth/twofactor/totp.test.ts가 쓰는 것과 동일한 `generateSync({ secret })`
// 패턴을 그대로 미러링한다(기본 옵션 = totp 전략, sha1/6자리/30초 주기).
import { generateSync } from "otplib";

// 실 DB 필요: docker compose up -d db 후 실행.
const unique = () => `e2e${Date.now().toString(36)}${Math.floor(Math.random() * 1000)}`;
const PASSWORD = "hunter2hunter2";

async function registerAndLogin(
  request: import("@playwright/test").APIRequestContext,
  id: string,
): Promise<{ email: string }> {
  const email = `${id}@example.com`;
  const reg = await request.post("/api/auth/register", {
    data: {
      email,
      phone: "010-1234-5678",
      nickname: id,
      password: PASSWORD,
      passwordConfirm: PASSWORD,
      consent: true,
    },
  });
  expect(reg.status()).toBe(201);

  const login = await request.post("/api/auth/login", { data: { email, password: PASSWORD } });
  expect(login.ok()).toBeTruthy();
  const body = await login.json();
  expect(body.twoFactorRequired).toBeUndefined(); // 아직 2FA 없음 — 바로 세션
  return { email };
}

async function enableTotp(request: import("@playwright/test").APIRequestContext): Promise<string> {
  const start = await request.post("/api/auth/2fa/totp/start");
  expect(start.ok()).toBeTruthy();
  const { secret } = await start.json();
  expect(typeof secret).toBe("string");

  const confirm = await request.post("/api/auth/2fa/totp/confirm", {
    data: { code: generateSync({ secret }) },
  });
  expect(confirm.ok()).toBeTruthy();
  return secret;
}

// 편차(e2e/oauth.spec.ts와 동일 사례): Playwright 최상위 `request` 픽스처는 브라우저
// `context`/`page`와 독립된 쿠키 저장소를 쓴다. 로그인 라우트가 심는 refresh_token·
// 2fa_challenge 쿠키를 이후 페이지 내비게이션(/login/2fa)이나 다른 API 호출이 이어받아야
// 하는 시나리오는 전부 `context.request`를 쓴다.
test.use({ locale: "ko-KR" });

test("TOTP setup → logout → re-login 2FA challenge → verify on /login/2fa page → session", async ({
  page,
  context,
}) => {
  const id = unique();
  const { email } = await registerAndLogin(context.request, id);
  const secret = await enableTotp(context.request);

  const loggedOut = await context.request.post("/api/auth/logout");
  expect(loggedOut.ok()).toBeTruthy();
  const afterLogout = await context.request.post("/api/auth/refresh");
  expect(afterLogout.status()).toBe(401); // 로그아웃이 실제로 세션을 끊었는지 확인

  // 재로그인: 세션 대신 2FA 챌린지가 와야 한다.
  const relogin = await context.request.post("/api/auth/login", { data: { email, password: PASSWORD } });
  expect(relogin.ok()).toBeTruthy();
  const reloginBody = await relogin.json();
  expect(reloginBody).toEqual({ twoFactorRequired: true, method: "TOTP" });
  expect(reloginBody.accessToken).toBeUndefined(); // 챌린지 응답에 세션 토큰이 섞이지 않는다

  // 챌린지 쿠키는 위 context.request 호출로 이미 브라우저 컨텍스트에 실려 있다(공유 쿠키 저장소).
  await page.goto("/login/2fa");
  await expect(page.getByRole("heading", { name: "2단계 인증" })).toBeVisible();
  await expect(page.getByText("가입할 때 설정한 방식으로 받은 코드를 입력해 주세요")).toBeVisible();

  // start 이후 시간이 흘렀을 수 있으니 제출 직전에 코드를 새로 생성한다.
  await page.getByLabel("인증 코드").fill(generateSync({ secret }));
  await page.getByRole("button", { name: "확인" }).click();
  await expect(page).toHaveURL("/");

  // 세션이 실제로 섰는지: refresh → accessToken → /me
  const refreshed = await context.request.post("/api/auth/refresh");
  expect(refreshed.ok()).toBeTruthy();
  const { accessToken } = await refreshed.json();
  const me = await context.request.get("/api/auth/me", { headers: { authorization: `Bearer ${accessToken}` } });
  expect(me.ok()).toBeTruthy();
});

test("2FA disable is step-up gated: 401 without step_up, success after password step-up", async ({ context }) => {
  const id = unique();
  const { email } = await registerAndLogin(context.request, id);
  await enableTotp(context.request);
  void email;

  const disableWithoutStepUp = await context.request.post("/api/auth/2fa/disable");
  expect(disableWithoutStepUp.status()).toBe(401);
  expect((await disableWithoutStepUp.json()).code).toBe("STEP_UP_REQUIRED");

  const stepUp = await context.request.post("/api/auth/step-up", {
    data: { method: "password", password: PASSWORD },
  });
  expect(stepUp.ok()).toBeTruthy();

  const disableWithStepUp = await context.request.post("/api/auth/2fa/disable");
  expect(disableWithStepUp.ok()).toBeTruthy();

  // 실제로 꺼졌는지: 재로그인이 이제 챌린지 없이 바로 세션을 준다.
  await context.request.post("/api/auth/logout");
  const relogin = await context.request.post("/api/auth/login", { data: { email, password: PASSWORD } });
  expect(relogin.ok()).toBeTruthy();
  expect((await relogin.json()).twoFactorRequired).toBeUndefined();
});

test("OAuth login of a 2FA-enabled user also challenges (bypass prevention)", async ({ page, context }) => {
  const id = unique();
  const { email } = await registerAndLogin(context.request, id);
  const secret = await enableTotp(context.request);
  void email;

  // 로컬 계정에 카카오를 연동(link) — 인증된 상태에서만 되므로 refresh 쿠키가 필요하다.
  await page.goto(`/api/auth/oauth/kakao/start?link=1&mock_as=${id}`);
  await expect(page).toHaveURL(/settings\/connections\?linked=kakao/);

  await context.request.post("/api/auth/logout");
  const afterLogout = await context.request.post("/api/auth/refresh");
  expect(afterLogout.status()).toBe(401);

  // 같은 mock_as로 OAuth 로그인(link 아님) — 이미 연동된 신원 + 2FA 켜짐 → 직접 세션이 아니라
  // /login/2fa 챌린지로 리다이렉트돼야 한다(OAuth로 2FA 우회 방지).
  await page.goto(`/api/auth/oauth/kakao/start?mock_as=${id}`);
  await expect(page).toHaveURL(/\/login\/2fa$/);

  const cookies = await context.cookies();
  expect(cookies.find((c) => c.name === "2fa_challenge")).toBeTruthy();
  expect(cookies.find((c) => c.name === "refresh_token")).toBeFalsy(); // 세션은 아직 서지 않았다

  // 챌린지를 통과하면 그제서야 세션이 선다(같은 TOTP 시크릿 — OAuth 경로가 시크릿을 건드리지 않음).
  const verify = await context.request.post("/api/auth/2fa/verify-login", {
    data: { code: generateSync({ secret }) },
  });
  expect(verify.ok()).toBeTruthy();
  const refreshed = await context.request.post("/api/auth/refresh");
  expect(refreshed.ok()).toBeTruthy();
});
