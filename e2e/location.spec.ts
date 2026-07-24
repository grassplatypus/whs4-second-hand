import { test, expect } from "@playwright/test";
import { createHash } from "node:crypto";

// 실 DB 필요: docker compose up -d db 후 실행.
const unique = () => `e2e${Date.now().toString(36)}${Math.floor(Math.random() * 1000)}`;
const PASSWORD = "hunter2hunter2";

// e2e/auth.spec.ts·twofactor.spec.ts와 동일 사유: Chromium 기본 Accept-Language가
// en-US라 쿠키 없는 첫 방문에서 한국어 폴백이 깨진다 — locale을 ko-KR로 고정.
test.use({ locale: "ko-KR" });

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
  return { email };
}

// src/features/location/geocoder/mock.ts의 결정적 알고리즘을 그대로 미러링해, 저장될
// (반올림 전) 좌표를 우리도 미리 계산해 둔다 — 페이지가 "이 정확한 좌표 문자열"을 어디에도
// 노출하지 않는지 직접 겨눈 단언을 위해서다(막연한 정규식보다 실제 유출 값을 아는 편이 강하다).
function coarsenedMockCoords(region: string): { lat: string; lng: string } {
  const h = createHash("sha256").update(region).digest();
  const lat = 33 + (h.readUInt32BE(0) % 6000) / 1000;
  const lng = 124 + (h.readUInt32BE(4) % 8000) / 1000;
  return { lat: (Math.round(lat * 100) / 100).toFixed(2), lng: (Math.round(lng * 100) / 100).toFixed(2) };
}

test("register → login → set neighborhood on /settings/location page → saved, shown, no coordinates in page or response", async ({
  page,
  context,
}) => {
  const id = unique();
  await registerAndLogin(context.request, id);

  // 페이지 레벨: 실제로 폼을 채워 저장하고, 저장된 동네가 화면에 뜨는지 확인한다.
  await page.goto("/settings/location");
  await expect(page.getByRole("heading", { name: "위치 설정" })).toBeVisible();
  await expect(page.getByText("아직 설정하지 않았어요")).toBeVisible();

  await page.getByLabel("시/도").fill("서울특별시");
  await page.getByLabel("시/군/구").fill("마포구");
  await page.getByLabel("동").fill("합정동");
  await page.getByRole("button", { name: "저장" }).click();

  await expect(page.getByText("저장했어요")).toBeVisible();
  await expect(page.getByText("현재 동네: 서울특별시 마포구 합정동")).toBeVisible();

  // 방금 저장으로 실제 DB에 들어갔을 (반올림된) 좌표 값을 우리도 계산해, 페이지 HTML
  // 어디에도 그 숫자가 노출되지 않는지 직접 확인한다 — 막연한 정규식이 아니라 실제
  // 유출 후보 값을 겨눈 단언(coarsen이 핵심 프라이버시 장치라는 리뷰 중점과 직결).
  const { lat, lng } = coarsenedMockCoords("서울특별시 마포구 합정동");
  const html = await page.content();
  expect(html).not.toContain(lat);
  expect(html).not.toContain(lng);
  expect(html).not.toMatch(/"lat"\s*:/);
  expect(html).not.toMatch(/"lng"\s*:/);

  // API 레벨: 응답 바디에 region만 있고 좌표 필드는 아예 없어야 한다(브라우저가 쿠키를
  // 공유하는 context.request로 같은 세션을 이어받아 호출).
  const res = await context.request.post("/api/auth/location", {
    data: { sido: "부산광역시", sigungu: "해운대구", dong: "우동" },
  });
  expect(res.ok()).toBeTruthy();
  const body = await res.json();
  expect(body).toEqual({ region: "부산광역시 해운대구 우동" });
  expect(body.lat).toBeUndefined();
  expect(body.lng).toBeUndefined();
  expect(Object.keys(body)).toEqual(["region"]);
});

test("location route requires a session: 401 without a refresh cookie", async ({ request }) => {
  const res = await request.post("/api/auth/location", {
    data: { sido: "서울특별시", sigungu: "마포구", dong: "합정동" },
  });
  expect(res.status()).toBe(401);
});

test("phone/send returns 200 when logged in; phone/verify with a wrong code returns 401", async ({ context }) => {
  const id = unique();
  await registerAndLogin(context.request, id);

  // 전화 인증 해피패스(정확한 코드 검증)는 콘솔 목 SMS라 E2E가 코드를 읽을 수 없다 —
  // 발송 200과 오코드 401만 여기서 확인하고, 정확한 코드 성공 경로는 단위테스트로 커버된다
  // (src/features/location/phone/phoneOtp.test.ts, src/app/api/auth/phone/*/route.test.ts).
  const send = await context.request.post("/api/auth/phone/send");
  expect(send.status()).toBe(200);
  expect(await send.json()).toEqual({ ok: true });

  const verify = await context.request.post("/api/auth/phone/verify", { data: { code: "000000" } });
  expect(verify.status()).toBe(401);
  expect((await verify.json()).code).toBe("PHONE_VERIFY_FAILED");
});
