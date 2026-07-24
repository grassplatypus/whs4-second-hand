import { test, expect } from "@playwright/test";
import { createHash } from "node:crypto";

// 실 DB 필요: docker compose up -d db 후 실행.
const unique = () => `e2e${Date.now().toString(36)}${Math.floor(Math.random() * 1000)}`;
const PASSWORD = "hunter2hunter2";
const PHONE = "010-1234-5678"; // e2e/auth.spec.ts류와 동일 — register가 전화번호 유일성을 강제하지 않는다.

// e2e/auth.spec.ts·twofactor.spec.ts·rbac.spec.ts와 동일 사유: Chromium 기본 Accept-Language가
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

// src/features/location/geocoder/mock.ts(결정적 mock geocoder) + geocoder.ts의 coarsen()을
// 그대로 미러링한다(e2e/location.spec.ts와 동일 사유) — 판매자가 저장할 (반올림된) 좌표를
// 우리도 미리 계산해서, 반경검색이 실제로 이 값을 가지고 haversine 필터링을 하는지 겨눈
// 단언과, 상세응답 좌표가 정확히 이 소수 2자리 값인지 겨눈 단언 둘 다에 쓴다.
function coarsenedMockCoords(region: string): { lat: number; lng: number } {
  const h = createHash("sha256").update(region).digest();
  const lat = 33 + (h.readUInt32BE(0) % 6000) / 1000;
  const lng = 124 + (h.readUInt32BE(4) % 8000) / 1000;
  return { lat: Math.round(lat * 100) / 100, lng: Math.round(lng * 100) / 100 };
}

async function setLocation(
  request: import("@playwright/test").APIRequestContext,
  sido: string,
  sigungu: string,
  dong: string,
): Promise<{ lat: number; lng: number }> {
  const res = await request.post("/api/auth/location", { data: { sido, sigungu, dong } });
  expect(res.ok()).toBeTruthy();
  return coarsenedMockCoords(`${sido} ${sigungu} ${dong}`.trim());
}

/** 좌표가 소수 2자리(≈1.1km 격자)로 반올림돼 있는지 — 정확좌표가 아니라 거친 스냅샷인지 확인. */
function assertCoarse(n: number) {
  expect(Math.abs(n * 100 - Math.round(n * 100))).toBeLessThan(1e-6);
}

// 1x1 투명 PNG(유효한 이미지) — 업로드 파이프라인(sharp 재처리)이 실제로 처리할 수 있는
// 최소 실물 이미지가 필요해, 흔히 쓰이는 최소 PNG 리터럴을 그대로 쓴다.
const TINY_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

test("register → set location → create product → list/detail 공개조회 → 반경검색(haversine 실쿼리) → 좌표·PII 없음", async ({
  context,
}) => {
  const id = unique();
  const { email } = await registerAndLogin(context.request, id);
  const coords = await setLocation(context.request, "서울특별시", "강남구", "역삼동");

  const create = await context.request.post("/api/products", {
    data: {
      title: "아이폰 14 팝니다",
      description: "상태 좋아요, 직거래 선호",
      price: 500000,
      category: "DIGITAL",
      directPlace: "역삼역 3번 출구",
    },
  });
  expect(create.status()).toBe(201);
  const { id: productId } = await create.json();
  expect(typeof productId).toBe("string");

  // 목록(카테고리 필터) — 방금 만든 상품이 나타나야 한다.
  const list = await context.request.get("/api/products?category=DIGITAL&limit=50");
  expect(list.ok()).toBeTruthy();
  const listBody = await list.json();
  const listedItem = listBody.items.find((it: { id: string }) => it.id === productId);
  expect(listedItem).toBeDefined();
  expect(listedItem.title).toBe("아이폰 14 팝니다");
  // ProductCard는 seller 필드 자체가 없다 — 목록 응답 전체에 PII가 새지 않는지도 확인.
  expect(JSON.stringify(listBody)).not.toContain(email);
  expect(JSON.stringify(listBody)).not.toContain(PHONE);

  // 상세 — 공개 엔드포인트, 인증 없이도 조회 가능해야 한다.
  const detail = await context.request.get(`/api/products/${productId}`);
  expect(detail.ok()).toBeTruthy();
  const detailBody = await detail.json();
  expect(detailBody.title).toBe("아이폰 14 팝니다");
  expect(detailBody.price).toBe(500000);
  expect(detailBody.status).toBe("SELLING");
  expect(detailBody.seller).toEqual({ nickname: id });
  expect(Object.keys(detailBody.seller)).toEqual(["nickname"]);

  // 좌표: 노출은 되지만(동네 수준 표시용) 판매자의 이미 거칠어진 스냅샷과 정확히 같아야
  // 하고, 소수 2자리 격자를 벗어나면 안 된다(정확 주소가 새는 통로가 없어야 함).
  assertCoarse(detailBody.lat);
  assertCoarse(detailBody.lng);
  expect(detailBody.lat).toBeCloseTo(coords.lat, 6);
  expect(detailBody.lng).toBeCloseTo(coords.lng, 6);

  const detailJson = JSON.stringify(detailBody);
  expect(detailJson).not.toContain(email);
  expect(detailJson).not.toContain(PHONE);
  expect(detailJson).not.toContain("01012345678");

  // 페이지 레벨: ProductDetailView는 애초에 lat/lng를 타입에서 뺀다(구조적 방지) — 실제
  // 렌더된 HTML에도 이메일/전화/좌표 흔적이 없는지 확인한다.
  const detailPageRes = await context.request.get(`/products/${productId}`);
  expect(detailPageRes.ok()).toBeTruthy();
  const html = await detailPageRes.text();
  expect(html).not.toContain(email);
  expect(html).not.toContain(PHONE);
  expect(html).not.toMatch(/"lat"\s*:/);
  expect(html).not.toMatch(/"lng"\s*:/);
  expect(html).toContain("아이폰 14 팝니다");

  // 반경검색 — 실 haversine SQL. 판매자 좌표 근방(반경 5km)이면 포함되고,
  // 지구 반대편에 가까운 먼 좌표·좁은 반경이면 제외돼야 한다(둘 다 실제로 필터링 동작을 증명).
  const nearbySearch = await context.request.get(
    `/api/products?lat=${coords.lat}&lng=${coords.lng}&radiusKm=5&limit=50`,
  );
  expect(nearbySearch.ok()).toBeTruthy();
  const nearbyBody = await nearbySearch.json();
  expect(nearbyBody.items.some((it: { id: string }) => it.id === productId)).toBe(true);

  const farSearch = await context.request.get(`/api/products?lat=1&lng=104&radiusKm=1&limit=50`);
  expect(farSearch.ok()).toBeTruthy();
  const farBody = await farSearch.json();
  expect(farBody.items.some((it: { id: string }) => it.id === productId)).toBe(false);
});

test("상태머신: SELLING→RESERVED→SOLD 성공, SOLD→SELLING(무효전이) 409", async ({ context }) => {
  const id = unique();
  await registerAndLogin(context.request, id);
  await setLocation(context.request, "부산광역시", "해운대구", "우동");

  const create = await context.request.post("/api/products", {
    data: { title: "상태전이 테스트 상품", description: "설명", price: 10000, category: "ETC" },
  });
  const { id: productId } = await create.json();

  const toReserved = await context.request.post(`/api/products/${productId}/status`, {
    data: { status: "RESERVED" },
  });
  expect(toReserved.status()).toBe(200);

  const toSold = await context.request.post(`/api/products/${productId}/status`, { data: { status: "SOLD" } });
  expect(toSold.status()).toBe(200);

  const afterSold = await context.request.get(`/api/products/${productId}`);
  expect((await afterSold.json()).status).toBe("SOLD");

  const invalid = await context.request.post(`/api/products/${productId}/status`, {
    data: { status: "SELLING" },
  });
  expect(invalid.status()).toBe(409);
  expect((await invalid.json()).code).toBe("INVALID_TRANSITION");
});

test("소유권: 다른 유저의 PATCH는 403 FORBIDDEN", async ({ browser }) => {
  const ctxA = await browser.newContext({ locale: "ko-KR" });
  const ctxB = await browser.newContext({ locale: "ko-KR" });

  const idA = unique();
  await registerAndLogin(ctxA.request, idA);
  await setLocation(ctxA.request, "서울특별시", "마포구", "합정동");
  const create = await ctxA.request.post("/api/products", {
    data: { title: "A의 물건", description: "설명", price: 1000, category: "ETC" },
  });
  const { id: productId } = await create.json();

  const idB = unique();
  await registerAndLogin(ctxB.request, idB);

  const patch = await ctxB.request.patch(`/api/products/${productId}`, { data: { title: "해킹시도" } });
  expect(patch.status()).toBe(403);
  expect((await patch.json()).code).toBe("FORBIDDEN");

  // 실제로 안 바뀌었는지 원 소유자 시점에서 재확인.
  const detail = await ctxA.request.get(`/api/products/${productId}`);
  expect((await detail.json()).title).toBe("A의 물건");

  await ctxA.close();
  await ctxB.close();
});

test("GUEST(세션 없음): 상품 등록은 401 UNAUTHENTICATED", async ({ request }) => {
  const res = await request.post("/api/products", {
    data: { title: "게스트 시도", description: "설명", price: 0, category: "ETC" },
  });
  expect(res.status()).toBe(401);
  expect((await res.json()).code).toBe("UNAUTHENTICATED");
});

test("검색어 SQL 인젝션 페이로드는 에러 없이 무해하게 처리된다(파라미터 바인딩)", async ({ request }) => {
  const res = await request.get(`/api/products?${new URLSearchParams({ q: "' OR 1=1;--" }).toString()}`);
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(Array.isArray(body.items)).toBe(true);
  expect(body).toHaveProperty("nextCursor");
  // 테이블 자체가 살아있는지(DROP TABLE이 절대 실행되지 않았는지)도 뒤이은 일반 검색으로 확인.
  const followUp = await request.get("/api/products?limit=1");
  expect(followUp.ok()).toBeTruthy();
});

test("숨기기(DELETE)→공개 검색/상세에서 사라짐, 복원(POST restore)→다시 나타남, 남의 상품 복원은 403", async ({
  browser,
}) => {
  const ctxA = await browser.newContext({ locale: "ko-KR" });
  const idA = unique();
  await registerAndLogin(ctxA.request, idA);
  await setLocation(ctxA.request, "서울특별시", "종로구", "종로1가");

  const create = await ctxA.request.post("/api/products", {
    data: { title: "숨기기 테스트 상품", description: "설명", price: 1000, category: "ETC" },
  });
  const { id: productId } = await create.json();

  // 숨기기 전: 공개 상세·검색에서 보인다.
  expect((await ctxA.request.get(`/api/products/${productId}`)).ok()).toBeTruthy();
  const before = await (await ctxA.request.get(`/api/products?limit=50`)).json();
  expect(before.items.some((it: { id: string }) => it.id === productId)).toBe(true);

  // 숨기기(soft delete) — owner만 가능, 공개 조회/검색에서 사라진다.
  const hide = await ctxA.request.delete(`/api/products/${productId}`);
  expect(hide.status()).toBe(200);
  expect((await ctxA.request.get(`/api/products/${productId}`)).status()).toBe(404);
  const afterHide = await (await ctxA.request.get(`/api/products?limit=50`)).json();
  expect(afterHide.items.some((it: { id: string }) => it.id === productId)).toBe(false);

  // 다른 유저는 복원할 수 없다 — 403.
  const ctxB = await browser.newContext({ locale: "ko-KR" });
  const idB = unique();
  await registerAndLogin(ctxB.request, idB);
  const restoreByOther = await ctxB.request.post(`/api/products/${productId}/restore`);
  expect(restoreByOther.status()).toBe(403);
  expect((await restoreByOther.json()).code).toBe("FORBIDDEN");

  // 소유자가 복원하면 공개 조회/검색에 다시 나타난다.
  const restore = await ctxA.request.post(`/api/products/${productId}/restore`);
  expect(restore.status()).toBe(200);
  expect((await ctxA.request.get(`/api/products/${productId}`)).ok()).toBeTruthy();
  const afterRestore = await (await ctxA.request.get(`/api/products?limit=50`)).json();
  expect(afterRestore.items.some((it: { id: string }) => it.id === productId)).toBe(true);

  await ctxA.close();
  await ctxB.close();
});

test("PATCH으로 이미지 배열을 교체할 수 있다(수정 시 이미지 관리) — 잘못된 경로 형식은 400", async ({ context }) => {
  const id = unique();
  await registerAndLogin(context.request, id);
  await setLocation(context.request, "인천광역시", "연수구", "송도동");

  const create = await context.request.post("/api/products", {
    data: { title: "이미지 수정 테스트", description: "설명", price: 1000, category: "ETC" },
  });
  const { id: productId } = await create.json();

  const upload = await context.request.post("/api/products/images", {
    multipart: {
      file: { name: "photo.png", mimeType: "image/png", buffer: Buffer.from(TINY_PNG_BASE64, "base64") },
    },
  });
  const { path } = await upload.json();

  const patch = await context.request.patch(`/api/products/${productId}`, { data: { images: [path] } });
  expect(patch.status()).toBe(200);

  const detail = await (await context.request.get(`/api/products/${productId}`)).json();
  expect(detail.images).toEqual([{ path, order: 0 }]);

  const badPatch = await context.request.patch(`/api/products/${productId}`, {
    data: { images: ["not/a/valid/path.png"] },
  });
  expect(badPatch.status()).toBe(400);
  expect((await badPatch.json()).code).toBe("INVALID_INPUT");
});

test("이미지 업로드(멀티파트) → 201 {path}, GET /api/media/{path}가 실제로 서빙한다", async ({ context }) => {
  const id = unique();
  await registerAndLogin(context.request, id);

  const upload = await context.request.post("/api/products/images", {
    multipart: {
      file: {
        name: "photo.png",
        mimeType: "image/png",
        buffer: Buffer.from(TINY_PNG_BASE64, "base64"),
      },
    },
  });
  expect(upload.status()).toBe(201);
  const { path } = await upload.json();
  expect(typeof path).toBe("string");
  expect(path.startsWith("products/")).toBe(true);

  const media = await context.request.get(`/api/media/${path}`);
  expect(media.ok()).toBeTruthy();
  expect(media.headers()["content-type"]).toBe("image/webp");
  const bytes = await media.body();
  expect(bytes.length).toBeGreaterThan(0);
});
