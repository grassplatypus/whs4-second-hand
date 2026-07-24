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

test("reused refresh token triggers reuse detection and kills the whole family", async ({ request }) => {
  const id = unique();
  const email = `${id}@example.com`;

  await request.post("/api/auth/register", {
    data: {
      email,
      phone: "010-1234-5678",
      nickname: id,
      password: "hunter2hunter2",
      passwordConfirm: "hunter2hunter2",
      consent: true,
    },
  });

  await request.post("/api/auth/login", { data: { email, password: "hunter2hunter2" } });

  // 회전 전 refresh 쿠키(구 토큰)를 캡처해 둔다 — request 컨텍스트는 로그인 응답의
  // set-cookie를 자동 저장하므로, 이후 한 번 회전되고 나면 컨텍스트의 쿠키는 새 토큰으로
  // 바뀐다. 재사용 감지를 트리거하려면 이 구 토큰을 따로 들고 있어야 한다.
  const afterLogin = await request.storageState();
  const oldRefreshCookie = afterLogin.cookies.find((c) => c.name === "refresh_token");
  expect(oldRefreshCookie).toBeDefined();

  const rotated = await request.post("/api/auth/refresh");
  expect(rotated.ok()).toBeTruthy();

  // 캡처해 둔 구 쿠키로 다시 refresh — 이미 회전(폐기)된 토큰의 재사용이므로 401과 함께
  // 같은 familyId의 전체 세션(방금 회전으로 받은 새 세션 포함)이 폐기되어야 한다.
  const reused = await request.post("/api/auth/refresh", {
    headers: { cookie: `refresh_token=${oldRefreshCookie!.value}` },
  });
  expect(reused.status()).toBe(401);
  expect((await reused.json()).code).toBe("AUTH_FAILED");

  // 회전으로 받은 새 쿠키(컨텍스트가 자동으로 들고 있는 최신 쿠키)도 이제 죽어 있어야 한다.
  const newTokenAlsoDead = await request.post("/api/auth/refresh");
  expect(newTokenAlsoDead.status()).toBe(401);
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

test("a non-JSON login body gives a generic 401, not a 500 (and never reaches the server log as plaintext)", async ({
  request,
}) => {
  // 폼 인코딩처럼 보이는 문자열은 유효한 JSON이 아니다. req.json()이 방어적으로 파싱되지
  // 않으면 SyntaxError가 미처리 에러로 새어나가 500 + 서버 로그에 입력 조각(이메일 포함)이
  // 남는다(리뷰 수정 1).
  const res = await request.post("/api/auth/login", {
    headers: { "content-type": "application/json" },
    data: "email=a@b.com&password=x",
  });
  expect(res.status()).toBe(401);
  expect((await res.json()).code).toBe("AUTH_FAILED");
});

test("a non-JSON register body gives a 400 INVALID_INPUT, not a 500", async ({ request }) => {
  const res = await request.post("/api/auth/register", {
    headers: { "content-type": "application/json" },
    data: "email=a@b.com&password=x",
  });
  expect(res.status()).toBe(400);
  expect((await res.json()).code).toBe("INVALID_INPUT");
});

test("signup page renders in Korean and switches to English", async ({ page }) => {
  await page.goto("/signup");
  await expect(page.getByRole("heading", { name: "회원가입" })).toBeVisible();
  await expect(page.getByLabel("이메일")).toBeVisible();
  await expect(page.getByRole("checkbox")).toBeVisible(); // 동의 체크박스(문구에 약관 링크 포함)

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
