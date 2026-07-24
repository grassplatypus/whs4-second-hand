import { test, expect, request as pwRequest } from "@playwright/test";

// 실 DB 필요: docker compose up -d db 후 실행.
const unique = () => `e2e${Date.now().toString(36)}${Math.floor(Math.random() * 1000)}`;
const PASSWORD = "hunter2hunter2";
const PHONE = "010-1234-5678"; // e2e/auth.spec.ts류와 동일 — register가 전화번호 유일성을 강제하지 않는다.

// e2e/auth.spec.ts·twofactor.spec.ts와 동일 사유: Chromium 기본 Accept-Language가 en-US라
// 쿠키 없는 첫 방문에서 한국어 폴백이 깨진다 — locale을 ko-KR로 고정.
test.use({ locale: "ko-KR" });

async function registerAndLogin(
  request: import("@playwright/test").APIRequestContext,
  id: string,
): Promise<{ email: string }> {
  const email = `${id}@example.com`;
  const reg = await request.post("/api/auth/register", {
    data: {
      email,
      phone: PHONE,
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

test("register → login → /mypage 소개글 편집·저장, 공개 프로필에 반영(이메일·전화 미노출)", async ({
  page,
  context,
}) => {
  const id = unique();
  const { email } = await registerAndLogin(context.request, id);

  // 페이지 레벨: /mypage에서 소개글을 실제로 편집·저장하고 화면에 반영되는지 확인한다.
  await page.goto("/mypage");
  await expect(page.getByRole("heading", { name: "마이페이지" })).toBeVisible();
  await expect(page.getByText(id).first()).toBeVisible();
  await expect(page.getByText("아직 소개글이 없어요")).toBeVisible();

  const bio = "안녕하세요, 중고 거래 좋아합니다.";
  await page.getByRole("button", { name: "수정하기" }).click();
  await page.getByLabel("소개글").fill(bio);
  await page.getByRole("button", { name: "저장" }).click();

  await expect(page.getByText("저장했어요")).toBeVisible();
  await expect(page.getByText(bio)).toBeVisible();

  // 공개 프로필에 표시할 동네를 하나 심어 둔다(같은 세션 — #1b 위치 라우트).
  const loc = await context.request.post("/api/auth/location", {
    data: { sido: "서울특별시", sigungu: "마포구", dong: "합정동" },
  });
  expect(loc.ok()).toBeTruthy();

  // 공개 프로필: 소개글·동네는 보이고, 이메일·전화번호는 페이지 HTML 어디에도 없어야 한다.
  await page.goto(`/u/${id}`);
  await expect(page.getByRole("heading", { name: id, level: 1 })).toBeVisible();
  await expect(page.getByText(bio)).toBeVisible();
  await expect(page.getByText("서울특별시 마포구 합정동")).toBeVisible();

  const html = await page.content();
  expect(html).not.toContain(email);
  expect(html).not.toContain(PHONE);

  // API 레벨로도 같은 부등식을 확인 — 공개 응답 키 자체에 이메일/전화 필드가 없다.
  const publicRes = await context.request.get(`/api/profile/${id}`);
  expect(publicRes.ok()).toBeTruthy();
  const publicBody = await publicRes.json();
  expect(Object.keys(publicBody).sort()).toEqual(["avatarPath", "bio", "createdAt", "nickname", "phoneVerified", "region"].sort());
  expect(JSON.stringify(publicBody)).not.toContain(email);
  expect(JSON.stringify(publicBody)).not.toContain(PHONE);
});

test("비밀번호 변경: 현재 비밀번호를 그 자리에서 확인한다(step-up 불필요) — 틀리면 401, 맞으면 새 비번으로만 재로그인된다", async ({ context }) => {
  const id = unique();
  const { email } = await registerAndLogin(context.request, id);
  const NEW_PASSWORD = "newhunter2hunter2";

  // 틀린 현재 비밀번호 → 401 AUTH_FAILED (step-up 쿠키는 아예 필요 없다)
  const wrongCurrent = await context.request.post("/api/auth/password/change", {
    data: { currentPassword: "definitely-wrong-pass", newPassword: NEW_PASSWORD },
  });
  expect(wrongCurrent.status()).toBe(401);
  expect((await wrongCurrent.json()).code).toBe("AUTH_FAILED");

  // 맞는 현재 비밀번호 → 바로 성공 (step-up 라운드트립 없음)
  const changed = await context.request.post("/api/auth/password/change", {
    data: { currentPassword: PASSWORD, newPassword: NEW_PASSWORD },
  });
  expect(changed.ok()).toBeTruthy();

  // 실제로 바뀌었는지: 로그아웃 후 옛 비번은 실패, 새 비번으로만 재로그인된다.
  await context.request.post("/api/auth/logout");
  const reloginOld = await context.request.post("/api/auth/login", { data: { email, password: PASSWORD } });
  expect(reloginOld.status()).toBe(401);
  const reloginNew = await context.request.post("/api/auth/login", { data: { email, password: NEW_PASSWORD } });
  expect(reloginNew.ok()).toBeTruthy();
});

test("닉네임 변경은 step-up 없이 바로 되고, 성공 시 반영된다", async ({ context }) => {
  const idA = unique();
  await registerAndLogin(context.request, idA);

  const newNickname = `${idA}-new`.slice(0, 20);
  const ok = await context.request.post("/api/profile/nickname", { data: { nickname: newNickname } });
  expect(ok.ok()).toBeTruthy();

  const me = await context.request.get("/api/profile/me");
  expect(me.ok()).toBeTruthy();
  expect((await me.json()).nickname).toBe(newNickname);
});

test("중복 닉네임으로 변경 시도 → 409 NICKNAME_TAKEN", async ({ context }) => {
  // 과거 실 버그(수정 완료): account.ts의 P2002 감지 헬퍼가 `err.meta?.target`을
  // 컬럼명 배열이라고 가정했다(register.ts의 동명 헬퍼와 동일 패턴). 그런데 이 저장소가
  // 쓰는 @prisma/adapter-pg(드라이버 어댑터) 경로에서 실제 P2002 에러는 `meta.target`
  // 배열이 없고 `meta.driverAdapterError.cause.constraint`(예: `User_nickname_key`)에
  // 제약명이 실린다(직접 psql+Prisma로 재현 확인). 지금은 src/features/_shared/prisma-error.ts의
  // uniqueViolationOn이 두 형태를 모두 인식하고, changeNickname도 update 전 read-check로
  // 대부분의 중복을 먼저 409로 걸러낸다(P2002 매핑은 경합 상황의 백스톱). 이 테스트는 그
  // 수정이 실제로 동작함을 확인한다.
  const idB = unique();
  const regB = await context.request.post("/api/auth/register", {
    data: {
      email: `${idB}@example.com`,
      phone: PHONE,
      nickname: idB,
      password: PASSWORD,
      passwordConfirm: PASSWORD,
      consent: true,
    },
  });
  expect(regB.status()).toBe(201); // B는 닉네임만 선점하고 로그인은 하지 않는다(A 세션을 건드리지 않도록).

  const idA = unique();
  await registerAndLogin(context.request, idA);

  const dup = await context.request.post("/api/profile/nickname", { data: { nickname: idB } });
  expect(dup.status()).toBe(409);
  expect((await dup.json()).code).toBe("NICKNAME_TAKEN");
});

test("회원 탈퇴: step-up→withdraw→세션 폐기, 이후 로그인은 실패한다(소프트 삭제)", async ({ context }) => {
  const id = unique();
  const { email } = await registerAndLogin(context.request, id);

  const withoutStepUp = await context.request.post("/api/auth/withdraw");
  expect(withoutStepUp.status()).toBe(401);
  expect((await withoutStepUp.json()).code).toBe("STEP_UP_REQUIRED");

  const stepUp = await context.request.post("/api/auth/step-up", {
    data: { method: "password", password: PASSWORD },
  });
  expect(stepUp.ok()).toBeTruthy();

  const withdrawn = await context.request.post("/api/auth/withdraw");
  expect(withdrawn.ok()).toBeTruthy();

  // 탈퇴가 실제로 모든 세션을 폐기했는지: 방금 쓴 refresh 쿠키도 이제 죽어 있어야 한다.
  const afterWithdrawRefresh = await context.request.post("/api/auth/refresh");
  expect(afterWithdrawRefresh.status()).toBe(401);

  // 재로그인 시도는 실패한다 — soft delete와 "계정 없음"을 구분하지 않는 일반 401.
  const relogin = await context.request.post("/api/auth/login", { data: { email, password: PASSWORD } });
  expect(relogin.status()).toBe(401);
  expect((await relogin.json()).code).toBe("AUTH_FAILED");
});

test("cross-user step-up 거부: A의 step_up 쿠키로는 B의 민감 작업을 통과할 수 없다", async () => {
  // 독립된 쿠키 저장소가 필요해 top-level request/context.request가 아니라 별도
  // APIRequestContext 두 개를 쓴다(oauth.spec.ts 주석에 적힌 쿠키-저장소 분리 사실과 같은 이유로,
  // 여기서는 반대로 "섞이지 않아야 함"을 확인하려고 일부러 쿠키를 수동으로 조합한다).
  const ctxA = await pwRequest.newContext({ baseURL: "http://localhost:3000" });
  const ctxB = await pwRequest.newContext({ baseURL: "http://localhost:3000" });
  try {
    await registerAndLogin(ctxA, unique());
    await registerAndLogin(ctxB, unique());

    const stepUpA = await ctxA.post("/api/auth/step-up", { data: { method: "password", password: PASSWORD } });
    expect(stepUpA.ok()).toBeTruthy();

    const stateA = await ctxA.storageState();
    const stepUpCookieA = stateA.cookies.find((c) => c.name === "step_up");
    expect(stepUpCookieA).toBeTruthy();

    const stateB = await ctxB.storageState();
    const refreshCookieB = stateB.cookies.find((c) => c.name === "refresh_token");
    expect(refreshCookieB).toBeTruthy();

    // B의 refresh 세션(그래서 currentUserFromRefresh는 B) + A의 step_up 쿠키를 한 요청에
    // 실어 보낸다. 라우트는 step_up의 sub(A)와 refresh의 userId(B)가 다르면 여전히
    // STEP_UP_REQUIRED를 던져야 한다 — 다른 유저의 재인증을 빌려 쓸 수 없다는 핵심 게이트.
    // (비밀번호 변경은 더 이상 step-up을 안 쓰므로, 여전히 step-up 게이팅인 회원 탈퇴를
    // 대신 이 크로스유저 검증의 vehicle로 쓴다.)
    const res = await ctxB.post("/api/auth/withdraw", {
      headers: { cookie: `refresh_token=${refreshCookieB!.value}; step_up=${stepUpCookieA!.value}` },
    });
    expect(res.status()).toBe(401);
    expect((await res.json()).code).toBe("STEP_UP_REQUIRED");
  } finally {
    await ctxA.dispose();
    await ctxB.dispose();
  }
});

test("탈퇴 가드(#7): 판매중 상품이 있으면 WITHDRAW_BLOCKED 409, 상품 삭제 후엔 탈퇴 성공", async ({ context }) => {
  const id = unique();
  await registerAndLogin(context.request, id);
  // 판매자 좌표 설정 후 상품 등록 → 판매중(SELLING) 상태의 진행 거래가 생긴다.
  const loc = await context.request.post("/api/auth/location", {
    data: { sido: "서울특별시", sigungu: "강남구", dong: "역삼동" },
  });
  expect(loc.ok()).toBeTruthy();
  const create = await context.request.post("/api/products", {
    data: { title: "탈퇴가드 테스트 상품", description: "설명", price: 10000, category: "ETC" },
  });
  expect(create.status()).toBe(201);
  const { id: productId } = await create.json();

  // step-up 재인증
  const stepUp = await context.request.post("/api/auth/step-up", {
    data: { method: "password", password: PASSWORD },
  });
  expect(stepUp.ok()).toBeTruthy();

  // 판매중 상품이 있어 탈퇴가 막힌다(409 WITHDRAW_BLOCKED)
  const blocked = await context.request.post("/api/auth/withdraw");
  expect(blocked.status()).toBe(409);
  expect((await blocked.json()).code).toBe("WITHDRAW_BLOCKED");

  // 상품 삭제(soft) 후엔 진행 거래가 없어 탈퇴 성공
  expect((await context.request.delete(`/api/products/${productId}`)).ok()).toBeTruthy();
  const ok = await context.request.post("/api/auth/withdraw");
  expect(ok.ok()).toBeTruthy();
});
