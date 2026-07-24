import { test, expect } from "@playwright/test";
import { execFileSync } from "node:child_process";

// 실 DB 필요: docker compose up -d db 후 실행.
const unique = () => `e2e${Date.now().toString(36)}${Math.floor(Math.random() * 1000)}`;
const PASSWORD = "hunter2hunter2";
const PHONE = "010-1234-5678"; // register가 전화번호 유일성을 강제하지 않는다(다른 스펙과 동일).

// Chromium 기본 Accept-Language(en-US)로 한국어 폴백이 깨지는 걸 막는다(다른 스펙과 동일).
test.use({ locale: "ko-KR" });

type Ctx = import("@playwright/test").APIRequestContext;

async function registerAndLogin(request: Ctx, id: string): Promise<{ email: string }> {
  const email = `${id}@example.com`;
  const reg = await request.post("/api/auth/register", {
    data: { email, phone: PHONE, nickname: id, password: PASSWORD, passwordConfirm: PASSWORD, consent: true },
  });
  expect(reg.status()).toBe(201);
  const login = await request.post("/api/auth/login", { data: { email, password: PASSWORD } });
  expect(login.ok()).toBeTruthy();
  return { email };
}

async function setLocation(request: Ctx, sido: string, sigungu: string, dong: string): Promise<void> {
  const res = await request.post("/api/auth/location", { data: { sido, sigungu, dong } });
  expect(res.ok()).toBeTruthy();
}

async function createProduct(request: Ctx, title: string, price: number): Promise<string> {
  const res = await request.post("/api/products", {
    data: { title, description: "설명", price, category: "ETC" },
  });
  expect(res.status()).toBe(201);
  return (await res.json()).id as string;
}

async function productStatus(request: Ctx, productId: string): Promise<string> {
  const res = await request.get(`/api/products/${productId}`);
  expect(res.ok()).toBeTruthy();
  return (await res.json()).status as string;
}

// 관리자 API로 role을 바꿀 방법은 아직 없다(#6). unique() 영숫자 닉네임에 한해 로컬 db에 직접 psql UPDATE.
function setAdmin(nickname: string): void {
  execFileSync(
    "docker",
    ["compose", "exec", "-T", "db", "psql", "-U", "app", "-d", "app", "-c", `UPDATE "User" SET role='ADMIN' WHERE nickname='${nickname}'`],
    { stdio: "pipe" },
  );
}

test("해피패스: 요청→조정(counter/accept)→보관(fund, 상품 RESERVED)→정산(confirm, 상품 SOLD)", async ({ browser }) => {
  const sellerCtx = await browser.newContext({ locale: "ko-KR" });
  const buyerCtx = await browser.newContext({ locale: "ko-KR" });
  const sellerId = unique();
  const buyerId = unique();
  await registerAndLogin(sellerCtx.request, sellerId);
  await setLocation(sellerCtx.request, "서울특별시", "강남구", "역삼동");
  const productId = await createProduct(sellerCtx.request, "정산 해피패스 상품", 10000);

  const { email: buyerEmail } = await registerAndLogin(buyerCtx.request, buyerId);

  // 요청(구매자, 제안 10000, lastProposer=buyer)
  const reqRes = await buyerCtx.request.post("/api/escrow", { data: { productId, amount: 10000 } });
  expect(reqRes.status()).toBe(201);
  const escrowId = (await reqRes.json()).id as string;

  // 조정: 판매자가 12000으로 재제안(lastProposer=seller)
  const counter = await sellerCtx.request.post(`/api/escrow/${escrowId}/counter`, { data: { amount: 12000 } });
  expect(counter.status()).toBe(200);

  // 자기 제안은 자기가 수락 못함: 판매자가 바로 수락 시도 → CANNOT_ACCEPT_OWN 400
  const selfAccept = await sellerCtx.request.post(`/api/escrow/${escrowId}/accept`);
  expect(selfAccept.status()).toBe(400);
  expect((await selfAccept.json()).code).toBe("CANNOT_ACCEPT_OWN");

  // 구매자가 12000 수락 → ACCEPTED
  const accept = await buyerCtx.request.post(`/api/escrow/${escrowId}/accept`);
  expect(accept.status()).toBe(200);

  // 판매자는 입금 못함(구매자만) → 403
  const sellerFund = await sellerCtx.request.post(`/api/escrow/${escrowId}/fund`);
  expect(sellerFund.status()).toBe(403);

  // 구매자 입금(보관) → 상품 RESERVED
  const fund = await buyerCtx.request.post(`/api/escrow/${escrowId}/fund`);
  expect(fund.status()).toBe(200);
  expect(await productStatus(sellerCtx.request, productId)).toBe("RESERVED");

  // 판매자는 수령확인 못함(구매자만) → 403
  const sellerConfirm = await sellerCtx.request.post(`/api/escrow/${escrowId}/confirm`);
  expect(sellerConfirm.status()).toBe(403);

  // 구매자 수령확인(정산) → 상품 SOLD, 에스크로 RELEASED
  const confirm = await buyerCtx.request.post(`/api/escrow/${escrowId}/confirm`);
  expect(confirm.status()).toBe(200);
  expect(await productStatus(sellerCtx.request, productId)).toBe("SOLD");

  const detail = await buyerCtx.request.get(`/api/escrow/${escrowId}`);
  const body = await detail.json();
  expect(body.status).toBe("RELEASED");
  expect(body.amount).toBe(12000);
  expect(body.counterparty).toEqual({ nickname: sellerId });
  // 종착 후 재정산 불가 → 409
  const again = await buyerCtx.request.post(`/api/escrow/${escrowId}/confirm`);
  expect(again.status()).toBe(409);

  // PII·상대 userId 원본 없음
  const json = JSON.stringify(body);
  expect(json).not.toContain(buyerEmail);
  expect(json).not.toContain(PHONE);
  expect(json).not.toContain("01012345678");

  await sellerCtx.close();
  await buyerCtx.close();
});

test("반환: 보관 후 판매자 반환 → 상품 SELLING 복귀, 에스크로 REFUNDED", async ({ browser }) => {
  const sellerCtx = await browser.newContext({ locale: "ko-KR" });
  const buyerCtx = await browser.newContext({ locale: "ko-KR" });
  const sellerId = unique();
  await registerAndLogin(sellerCtx.request, sellerId);
  await setLocation(sellerCtx.request, "부산광역시", "해운대구", "우동");
  const productId = await createProduct(sellerCtx.request, "반환 테스트 상품", 5000);
  await registerAndLogin(buyerCtx.request, unique());

  const escrowId = (await (await buyerCtx.request.post("/api/escrow", { data: { productId, amount: 5000 } })).json()).id;
  await sellerCtx.request.post(`/api/escrow/${escrowId}/accept`); // 판매자가 구매자 제안 수락
  await buyerCtx.request.post(`/api/escrow/${escrowId}/fund`);
  expect(await productStatus(sellerCtx.request, productId)).toBe("RESERVED");

  // 구매자는 반환 못함(판매자만) → 403
  const buyerRefund = await buyerCtx.request.post(`/api/escrow/${escrowId}/refund`);
  expect(buyerRefund.status()).toBe(403);

  const refund = await sellerCtx.request.post(`/api/escrow/${escrowId}/refund`);
  expect(refund.status()).toBe(200);
  expect(await productStatus(sellerCtx.request, productId)).toBe("SELLING");
  expect((await (await buyerCtx.request.get(`/api/escrow/${escrowId}`)).json()).status).toBe("REFUNDED");

  await sellerCtx.close();
  await buyerCtx.close();
});

test("자기거래 금지: 판매자가 자기 상품에 요청 → SELF_TRADE 400", async ({ context }) => {
  const sellerId = unique();
  await registerAndLogin(context.request, sellerId);
  await setLocation(context.request, "서울특별시", "마포구", "합정동");
  const productId = await createProduct(context.request, "자기거래 상품", 1000);

  const res = await context.request.post("/api/escrow", { data: { productId, amount: 1000 } });
  expect(res.status()).toBe(400);
  expect((await res.json()).code).toBe("SELF_TRADE");
});

test("참여자 격리: 제3자는 거래 상세를 볼 수 없다(403)", async ({ browser }) => {
  const sellerCtx = await browser.newContext({ locale: "ko-KR" });
  const buyerCtx = await browser.newContext({ locale: "ko-KR" });
  const thirdCtx = await browser.newContext({ locale: "ko-KR" });
  await registerAndLogin(sellerCtx.request, unique());
  await setLocation(sellerCtx.request, "인천광역시", "연수구", "송도동");
  const productId = await createProduct(sellerCtx.request, "격리 테스트 상품", 3000);
  await registerAndLogin(buyerCtx.request, unique());
  await registerAndLogin(thirdCtx.request, unique());

  const escrowId = (await (await buyerCtx.request.post("/api/escrow", { data: { productId, amount: 3000 } })).json()).id;

  const third = await thirdCtx.request.get(`/api/escrow/${escrowId}`);
  expect(third.status()).toBe(403);
  expect((await third.json()).code).toBe("FORBIDDEN");

  // 제3자의 행동(수락 등)도 403
  const thirdAccept = await thirdCtx.request.post(`/api/escrow/${escrowId}/accept`);
  expect(thirdAccept.status()).toBe(403);

  await sellerCtx.close();
  await buyerCtx.close();
  await thirdCtx.close();
});

test("이중보관 방지: 같은 상품에 두 구매자가 입금하면 두 번째는 409", async ({ browser }) => {
  const sellerCtx = await browser.newContext({ locale: "ko-KR" });
  const buyer1Ctx = await browser.newContext({ locale: "ko-KR" });
  const buyer2Ctx = await browser.newContext({ locale: "ko-KR" });
  await registerAndLogin(sellerCtx.request, unique());
  await setLocation(sellerCtx.request, "대구광역시", "수성구", "범어동");
  const productId = await createProduct(sellerCtx.request, "이중보관 상품", 7000);
  await registerAndLogin(buyer1Ctx.request, unique());
  await registerAndLogin(buyer2Ctx.request, unique());

  // 두 구매자 모두 SELLING 동안 요청·수락(판매자 수락) — ACCEPTED 두 건
  const e1 = (await (await buyer1Ctx.request.post("/api/escrow", { data: { productId, amount: 7000 } })).json()).id;
  const e2 = (await (await buyer2Ctx.request.post("/api/escrow", { data: { productId, amount: 7000 } })).json()).id;
  expect((await sellerCtx.request.post(`/api/escrow/${e1}/accept`)).status()).toBe(200);
  expect((await sellerCtx.request.post(`/api/escrow/${e2}/accept`)).status()).toBe(200);

  // 첫 구매자 입금 → 상품 RESERVED
  expect((await buyer1Ctx.request.post(`/api/escrow/${e1}/fund`)).status()).toBe(200);
  expect(await productStatus(sellerCtx.request, productId)).toBe("RESERVED");

  // 둘째 구매자 입금 → PRODUCT_UNAVAILABLE 409(이중보관 차단)
  const secondFund = await buyer2Ctx.request.post(`/api/escrow/${e2}/fund`);
  expect(secondFund.status()).toBe(409);
  expect((await secondFund.json()).code).toBe("PRODUCT_UNAVAILABLE");

  await sellerCtx.close();
  await buyer1Ctx.close();
  await buyer2Ctx.close();
});

test("분쟁: 구매자 분쟁 접수 → 참여자는 정산 불가(409) → 관리자 조정(release) → 상품 SOLD", async ({ browser }) => {
  const sellerCtx = await browser.newContext({ locale: "ko-KR" });
  const buyerCtx = await browser.newContext({ locale: "ko-KR" });
  const adminCtx = await browser.newContext({ locale: "ko-KR" });
  await registerAndLogin(sellerCtx.request, unique());
  await setLocation(sellerCtx.request, "광주광역시", "서구", "치평동");
  const productId = await createProduct(sellerCtx.request, "분쟁 테스트 상품", 9000);
  await registerAndLogin(buyerCtx.request, unique());
  const adminId = unique();
  await registerAndLogin(adminCtx.request, adminId);
  setAdmin(adminId);

  const escrowId = (await (await buyerCtx.request.post("/api/escrow", { data: { productId, amount: 9000 } })).json()).id;
  await sellerCtx.request.post(`/api/escrow/${escrowId}/accept`);
  await buyerCtx.request.post(`/api/escrow/${escrowId}/fund`);

  // 구매자 분쟁 접수 → DISPUTED
  const dispute = await buyerCtx.request.post(`/api/escrow/${escrowId}/dispute`, { data: { note: "물건이 설명과 달라요" } });
  expect(dispute.status()).toBe(200);

  // 분쟁 중에는 참여자가 정산·반환 못함(관리자 조정 대기) → 409
  const buyerConfirm = await buyerCtx.request.post(`/api/escrow/${escrowId}/confirm`);
  expect(buyerConfirm.status()).toBe(409);
  const sellerRefund = await sellerCtx.request.post(`/api/escrow/${escrowId}/refund`);
  expect(sellerRefund.status()).toBe(409);

  // 일반 유저(구매자)는 조정 못함 → 403(requireAdmin)
  const buyerResolve = await buyerCtx.request.post(`/api/escrow/${escrowId}/resolve`, { data: { resolution: "release" } });
  expect(buyerResolve.status()).toBe(403);

  // 관리자 조정(release) → 상품 SOLD, 에스크로 RELEASED
  const resolve = await adminCtx.request.post(`/api/escrow/${escrowId}/resolve`, { data: { resolution: "release" } });
  expect(resolve.status()).toBe(200);
  expect(await productStatus(sellerCtx.request, productId)).toBe("SOLD");
  const detail = await buyerCtx.request.get(`/api/escrow/${escrowId}`);
  const body = await detail.json();
  expect(body.status).toBe("RELEASED");
  // 관리자 조정 이벤트는 참여자에게 actor=admin으로 보인다(관리자 id 원본은 노출 안 함)
  expect(body.events.some((ev: { actor: string }) => ev.actor === "admin")).toBe(true);

  await sellerCtx.close();
  await buyerCtx.close();
  await adminCtx.close();
});

test("GUEST(세션 없음): 에스크로 요청·목록·상세는 401", async ({ request }) => {
  const reqRes = await request.post("/api/escrow", { data: { productId: "x", amount: 1000 } });
  expect(reqRes.status()).toBe(401);
  expect((await reqRes.json()).code).toBe("UNAUTHENTICATED");

  const list = await request.get("/api/escrow");
  expect(list.status()).toBe(401);
});
