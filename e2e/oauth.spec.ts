import { test, expect } from "@playwright/test";
// otplib v13은 함수형 API(v12의 `authenticator` 싱글턴 없음) — e2e/twofactor.spec.ts,
// src/features/auth/twofactor/totp.test.ts와 동일하게 `generateSync({ secret })`을 쓴다.
import { generateSync } from "otplib";

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

  // 4) 연동 해제는 이제(ext-2) step-up 재인증이 선행돼야 한다 — step_up 쿠키 없이는
  // last-credential 체크 전에 401 STEP_UP_REQUIRED가 난다. alice는 OAuth만 있는 계정이라
  // password step-up은 못 쓴다(비밀번호가 없음). 이메일 OTP도 유효한 프로덕션 경로지만
  // 콘솔 목 메일러라 E2E에서 코드를 읽을 수 없다 — 그래서 TOTP를 새로 켜서 그걸로
  // step-up한다. TOTP 활성화는 "다음" 로그인부터 2FA 챌린지를 요구할 뿐, 지금 이미 선
  // 세션(refresh 쿠키)은 그대로 유효하다 — 재로그인하지 않고 같은 세션을 계속 쓴다.
  const totpStart = await context.request.post("/api/auth/2fa/totp/start");
  expect(totpStart.ok()).toBeTruthy();
  const { secret } = await totpStart.json();
  const totpConfirm = await context.request.post("/api/auth/2fa/totp/confirm", {
    data: { code: generateSync({ secret }) },
  });
  expect(totpConfirm.ok()).toBeTruthy();

  // step-up 코드는 여기서 새로 생성한다(설정용 코드를 재사용하지 않는다) — TOTP 스텝(30초)이
  // 그 사이 넘어갔을 수 있어서다.
  const stepUp = await context.request.post("/api/auth/step-up", {
    data: { method: "totp", code: generateSync({ secret }) },
  });
  expect(stepUp.ok()).toBeTruthy();

  // 5) 네이버 해제 성공 (자격증명 2개라 마지막 아님 + step-up 확보됨)
  await page.reload();
  await page.getByRole("button", { name: "연결 해제" }).nth(1).click();
  await expect(page.getByRole("button", { name: "연결 해제" })).toHaveCount(1);
});

test("unlink without step-up is refused (step-up gate)", async ({ page, context }) => {
  const bob = unique();
  await page.goto(`/api/auth/oauth/google/start?mock_as=${bob}`);
  await expect(page).toHaveURL(/\/$/);

  // ext-2 회귀: unlink 라우트(src/app/api/auth/oauth/[provider]/unlink/route.ts)는
  // last-credential 가드보다 먼저 step-up 재인증을 확인한다. bob은 구글 신원 하나뿐이라
  // 원래는 last-credential(409)로 막혀야 하지만, step-up 쿠키가 아예 없으니 그 체크에
  // 도달하기도 전에 401 STEP_UP_REQUIRED가 난다 — 이 테스트는 그 게이트 자체를 검증한다.
  //
  // 참고(src/features/auth/oauth/link.ts의 unlinkIdentity): last-credential 가드는
  // passwordHash 유무 + AuthIdentity 행 개수만 센다. TOTP는 User.twoFactorMethod
  // 컬럼일 뿐 AuthIdentity 행이 아니라서, bob이 TOTP를 켜서 step-up을 통과하더라도
  // 여전히 "자격증명 1개"인 채라 이 구글 신원을 해제하면 LAST_CREDENTIAL(409)이 나야
  // 정상이다 — 즉 TOTP를 얹는다고 last-credential 게이트를 우회할 수 없다. 여기서는
  // step-up 게이트 자체만 단독으로 검증한다(더 단순하고 정직한 커버리지).
  const res = await context.request.post("/api/auth/oauth/google/unlink");
  expect(res.status()).toBe(401);
  expect((await res.json()).code).toBe("STEP_UP_REQUIRED");
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
