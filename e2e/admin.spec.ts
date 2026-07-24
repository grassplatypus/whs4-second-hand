import { test, expect } from "@playwright/test";
import { execFileSync } from "node:child_process";

// 실 DB(Postgres) + Mongo 필요. Mongo는 컨테이너가 호스트에 미발행이라, 도커 밖 next dev는
// 별도 포트포워딩(socat 사이드카 또는 compose ports)이 필요하다 — e2e/chat.spec.ts와 동일.
const unique = () => `e2e${Date.now().toString(36)}${Math.floor(Math.random() * 1000)}`;
const PASSWORD = "hunter2hunter2";
const PHONE = "010-1234-5678";

test.use({ locale: "ko-KR" });

type Ctx = import("@playwright/test").APIRequestContext;

async function registerAndLogin(request: Ctx, id: string): Promise<void> {
  const email = `${id}@example.com`;
  const reg = await request.post("/api/auth/register", {
    data: { email, phone: PHONE, nickname: id, password: PASSWORD, passwordConfirm: PASSWORD, consent: true },
  });
  expect(reg.status()).toBe(201);
  const login = await request.post("/api/auth/login", { data: { email, password: PASSWORD } });
  expect(login.ok()).toBeTruthy();
}

function psql(sql: string): string {
  return execFileSync(
    "docker",
    ["compose", "exec", "-T", "db", "psql", "-U", "app", "-d", "app", "-t", "-A", "-c", sql],
    { stdio: "pipe" },
  )
    .toString()
    .trim();
}
function setAdmin(nickname: string): void {
  psql(`UPDATE "User" SET role='ADMIN' WHERE nickname='${nickname}'`);
}
function userId(nickname: string): string {
  return psql(`SELECT id FROM "User" WHERE nickname='${nickname}'`);
}

async function setLocation(request: Ctx, sido: string, sigungu: string, dong: string): Promise<void> {
  const res = await request.post("/api/auth/location", { data: { sido, sigungu, dong } });
  expect(res.ok()).toBeTruthy();
}
async function createProduct(request: Ctx, title: string): Promise<string> {
  const res = await request.post("/api/products", { data: { title, description: "설명", price: 10000, category: "ETC" } });
  expect(res.status()).toBe(201);
  return (await res.json()).id as string;
}

test("인가: 대시보드는 GUEST 401 / 일반 USER 403 / ADMIN 200(집계)", async ({ browser }) => {
  const adminCtx = await browser.newContext({ locale: "ko-KR" });
  const userCtx = await browser.newContext({ locale: "ko-KR" });
  const guestCtx = await browser.newContext({ locale: "ko-KR" });

  const adminNick = unique();
  await registerAndLogin(adminCtx.request, adminNick);
  setAdmin(adminNick);
  await registerAndLogin(userCtx.request, unique());

  expect((await guestCtx.request.get("/api/admin/dashboard")).status()).toBe(401);
  expect((await userCtx.request.get("/api/admin/dashboard")).status()).toBe(403);

  const dash = await adminCtx.request.get("/api/admin/dashboard");
  expect(dash.status()).toBe(200);
  const stats = await dash.json();
  expect(typeof stats.users).toBe("number");
  expect(stats.products).toHaveProperty("selling");
  expect(stats).toHaveProperty("openReports");
  expect(stats).toHaveProperty("disputedEscrows");

  await adminCtx.close();
  await userCtx.close();
  await guestCtx.close();
});

test("제재: 정지된 유저는 보호 라우트 403, 해제하면 복구. 자기·타관리자 정지 금지", async ({ browser }) => {
  const adminCtx = await browser.newContext({ locale: "ko-KR" });
  const userCtx = await browser.newContext({ locale: "ko-KR" });
  const adminNick = unique();
  const userNick = unique();
  await registerAndLogin(adminCtx.request, adminNick);
  setAdmin(adminNick);
  await registerAndLogin(userCtx.request, userNick);
  const targetId = userId(userNick);
  const adminId = userId(adminNick);

  // 정지 전: 유저의 보호 라우트(bio)는 정상
  expect((await userCtx.request.patch("/api/profile/bio", { data: { bio: "안녕" } })).status()).toBe(200);

  // 자기 정지 금지
  expect((await adminCtx.request.post(`/api/admin/users/${adminId}/suspend`)).status()).toBe(400);

  // 유저 정지 → 그 유저는 세션 그대로여도 DB-fresh로 즉시 403
  expect((await adminCtx.request.post(`/api/admin/users/${targetId}/suspend`)).status()).toBe(200);
  expect((await userCtx.request.patch("/api/profile/bio", { data: { bio: "또 안녕" } })).status()).toBe(403);

  // 이미 정지면 409
  expect((await adminCtx.request.post(`/api/admin/users/${targetId}/suspend`)).status()).toBe(409);

  // 해제 → 복구
  expect((await adminCtx.request.post(`/api/admin/users/${targetId}/lift`)).status()).toBe(200);
  expect((await userCtx.request.patch("/api/profile/bio", { data: { bio: "복구" } })).status()).toBe(200);

  // 타관리자 정지 금지
  const admin2Nick = unique();
  const admin2Ctx = await browser.newContext({ locale: "ko-KR" });
  await registerAndLogin(admin2Ctx.request, admin2Nick);
  setAdmin(admin2Nick);
  const suspendAdmin = await adminCtx.request.post(`/api/admin/users/${userId(admin2Nick)}/suspend`);
  expect(suspendAdmin.status()).toBe(403);
  expect((await suspendAdmin.json()).code).toBe("CANNOT_SANCTION_ADMIN");

  await adminCtx.close();
  await userCtx.close();
  await admin2Ctx.close();
});

test("강제 삭제: 관리자가 남의 상품을 soft-delete하면 공개 조회에서 사라진다", async ({ browser }) => {
  const adminCtx = await browser.newContext({ locale: "ko-KR" });
  const sellerCtx = await browser.newContext({ locale: "ko-KR" });
  const adminNick = unique();
  await registerAndLogin(adminCtx.request, adminNick);
  setAdmin(adminNick);
  await registerAndLogin(sellerCtx.request, unique());
  await setLocation(sellerCtx.request, "서울특별시", "강남구", "역삼동");
  const productId = await createProduct(sellerCtx.request, "부적절 게시물");

  expect((await sellerCtx.request.get(`/api/products/${productId}`)).status()).toBe(200);

  const del = await adminCtx.request.post(`/api/admin/products/${productId}/force-delete`);
  expect(del.status()).toBe(200);

  expect((await sellerCtx.request.get(`/api/products/${productId}`)).status()).toBe(404);
  // 이미 삭제된 상품 재삭제 → 404
  expect((await adminCtx.request.post(`/api/admin/products/${productId}/force-delete`)).status()).toBe(404);

  await adminCtx.close();
  await sellerCtx.close();
});

test("신고 관리: 유저 신고 접수 → 관리자 목록(원문 snapshot·targetUserId) → 정지 → 처리(resolve)", async ({ browser }) => {
  const adminCtx = await browser.newContext({ locale: "ko-KR" });
  const buyerCtx = await browser.newContext({ locale: "ko-KR" });
  const sellerCtx = await browser.newContext({ locale: "ko-KR" });
  const adminNick = unique();
  await registerAndLogin(adminCtx.request, adminNick);
  setAdmin(adminNick);
  await registerAndLogin(buyerCtx.request, unique());
  const sellerNick = unique();
  await registerAndLogin(sellerCtx.request, sellerNick);
  const sellerId = userId(sellerNick);

  // 구매자가 판매자(유저)를 신고
  const report = await buyerCtx.request.post("/api/chat/report", {
    data: { targetType: "user", targetId: sellerId, reason: "사기 의심이에요" },
  });
  expect(report.ok()).toBeTruthy();

  // 관리자 목록에 open 신고가 나타나고, 대상 userId·사유가 보인다
  const list = await adminCtx.request.get("/api/admin/reports?status=open");
  expect(list.status()).toBe(200);
  const { reports } = await list.json();
  const mine = reports.find((r: { targetUserId: string | null }) => r.targetUserId === sellerId);
  expect(mine).toBeTruthy();
  expect(mine.reason).toBe("사기 의심이에요");

  // 신고 목록의 targetUserId로 그 유저를 정지
  expect((await adminCtx.request.post(`/api/admin/users/${sellerId}/suspend`)).status()).toBe(200);
  expect((await sellerCtx.request.patch("/api/profile/bio", { data: { bio: "x" } })).status()).toBe(403);

  // 신고 처리(resolve) → open 목록에서 사라지고 resolved에 나타난다
  expect((await adminCtx.request.post(`/api/admin/reports/${mine.id}/resolve`, { data: { action: "resolve" } })).status()).toBe(200);
  const openAfter = await (await adminCtx.request.get("/api/admin/reports?status=open")).json();
  expect(openAfter.reports.find((r: { id: string }) => r.id === mine.id)).toBeFalsy();
  const resolved = await (await adminCtx.request.get("/api/admin/reports?status=resolved")).json();
  expect(resolved.reports.find((r: { id: string }) => r.id === mine.id)).toBeTruthy();

  // 없는 신고 처리 → 404
  expect((await adminCtx.request.post(`/api/admin/reports/ghost-id/resolve`, { data: { action: "resolve" } })).status()).toBe(404);

  await adminCtx.close();
  await buyerCtx.close();
  await sellerCtx.close();
});

test("분쟁 목록: 관리자가 분쟁 에스크로를 보고 조정(release)한다", async ({ browser }) => {
  const adminCtx = await browser.newContext({ locale: "ko-KR" });
  const sellerCtx = await browser.newContext({ locale: "ko-KR" });
  const buyerCtx = await browser.newContext({ locale: "ko-KR" });
  const adminNick = unique();
  await registerAndLogin(adminCtx.request, adminNick);
  setAdmin(adminNick);
  await registerAndLogin(sellerCtx.request, unique());
  await setLocation(sellerCtx.request, "부산광역시", "해운대구", "우동");
  const productId = await createProduct(sellerCtx.request, "분쟁용 상품");
  await registerAndLogin(buyerCtx.request, unique());

  const escrowId = (await (await buyerCtx.request.post("/api/escrow", { data: { productId, amount: 10000 } })).json()).id;
  await sellerCtx.request.post(`/api/escrow/${escrowId}/accept`);
  await buyerCtx.request.post(`/api/escrow/${escrowId}/fund`);
  await buyerCtx.request.post(`/api/escrow/${escrowId}/dispute`, { data: { note: "물건 안 왔어요" } });

  // 관리자 분쟁 목록에 나타난다(양측 닉네임·상품·금액)
  const disputes = await adminCtx.request.get("/api/admin/disputes");
  expect(disputes.status()).toBe(200);
  const found = (await disputes.json()).disputes.find((d: { id: string }) => d.id === escrowId);
  expect(found).toBeTruthy();
  expect(found.amount).toBe(10000);
  expect(found.product.title).toBe("분쟁용 상품");

  // 관리자 조정(release, #5 라우트 재사용) → 상품 SOLD
  expect((await adminCtx.request.post(`/api/escrow/${escrowId}/resolve`, { data: { resolution: "release" } })).status()).toBe(200);
  expect((await (await sellerCtx.request.get(`/api/products/${productId}`)).json()).status).toBe("SOLD");
  // 조정 후 분쟁 목록에서 사라진다
  const after = await (await adminCtx.request.get("/api/admin/disputes")).json();
  expect(after.disputes.find((d: { id: string }) => d.id === escrowId)).toBeFalsy();

  await adminCtx.close();
  await sellerCtx.close();
  await buyerCtx.close();
});
