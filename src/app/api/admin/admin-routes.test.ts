// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import { AppError } from "@/features/_shared/error";
import { REFRESH_COOKIE } from "@/features/auth/cookies";

const currentUserFromRefresh = vi.fn();
const userFindUnique = vi.fn();
const suspendUser = vi.fn();
const liftSuspension = vi.fn();
const forceDeleteProduct = vi.fn();
const resolveReport = vi.fn();
const listReports = vi.fn();
const listDisputedEscrows = vi.fn();
const dashboardStats = vi.fn();

vi.mock("@/features/_shared/prisma", () => ({
  prisma: { user: { findUnique: (...a: unknown[]) => userFindUnique(...a) } },
}));
vi.mock("@/features/auth/session", () => ({
  currentUserFromRefresh: (...a: unknown[]) => currentUserFromRefresh(...a),
}));
vi.mock("@/features/chat/repo", () => ({ getChatRepo: () => ({ marker: "repo" }) }));
vi.mock("@/features/admin/service", async () => {
  const actual = await vi.importActual<typeof import("@/features/admin/service")>("@/features/admin/service");
  return {
    ...actual,
    suspendUser: (...a: unknown[]) => suspendUser(...a),
    liftSuspension: (...a: unknown[]) => liftSuspension(...a),
    forceDeleteProduct: (...a: unknown[]) => forceDeleteProduct(...a),
    resolveReport: (...a: unknown[]) => resolveReport(...a),
    listReports: (...a: unknown[]) => listReports(...a),
    listDisputedEscrows: (...a: unknown[]) => listDisputedEscrows(...a),
    dashboardStats: (...a: unknown[]) => dashboardStats(...a),
  };
});

const { GET: dashGet } = await import("./dashboard/route");
const { GET: reportsGet } = await import("./reports/route");
const { POST: resolvePost } = await import("./reports/[id]/resolve/route");
const { POST: suspendPost } = await import("./users/[id]/suspend/route");
const { POST: liftPost } = await import("./users/[id]/lift/route");
const { POST: forceDeletePost } = await import("./products/[id]/force-delete/route");
const { GET: disputesGet } = await import("./disputes/route");

const idCtx = { params: Promise.resolve({ id: "target-1" }) };
function get(cookie?: string): Request {
  return new Request("http://localhost/api/admin/x", { headers: cookie ? { cookie } : {} });
}
function post(body: unknown, cookie?: string): Request {
  return new Request("http://localhost/api/admin/x", {
    method: "POST",
    headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body),
  });
}
const COOKIE = `${REFRESH_COOKIE}=tok`;

beforeEach(() => {
  currentUserFromRefresh.mockReset();
  userFindUnique.mockReset().mockResolvedValue({ role: "ADMIN", deletedAt: null });
  [suspendUser, liftSuspension, forceDeleteProduct, resolveReport, listReports, listDisputedEscrows, dashboardStats].forEach((m) => m.mockReset());
});

describe("requireAdmin 게이팅(전 라우트)", () => {
  it("GUEST(세션 없음)는 dashboard 401", async () => {
    currentUserFromRefresh.mockResolvedValue(null);
    expect((await dashGet(get())).status).toBe(401);
    expect(dashboardStats).not.toHaveBeenCalled();
  });

  it("일반 USER는 dashboard 403", async () => {
    currentUserFromRefresh.mockResolvedValue({ userId: "u1" });
    userFindUnique.mockResolvedValue({ role: "USER", deletedAt: null });
    expect((await dashGet(get(COOKIE))).status).toBe(403);
    expect(dashboardStats).not.toHaveBeenCalled();
  });

  it("SUSPENDED도 403", async () => {
    currentUserFromRefresh.mockResolvedValue({ userId: "u1" });
    userFindUnique.mockResolvedValue({ role: "SUSPENDED", deletedAt: null });
    expect((await suspendPost(post({}, COOKIE), idCtx)).status).toBe(403);
    expect(suspendUser).not.toHaveBeenCalled();
  });
});

describe("ADMIN 정상 동작 + 인증 adminId 전달", () => {
  it("dashboard: 집계 반환", async () => {
    currentUserFromRefresh.mockResolvedValue({ userId: "admin-1" });
    dashboardStats.mockResolvedValue({ users: 3 });
    const res = await dashGet(get(COOKIE));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ users: 3 });
  });

  it("reports: status 쿼리 파싱, 목록 반환", async () => {
    currentUserFromRefresh.mockResolvedValue({ userId: "admin-1" });
    listReports.mockResolvedValue([{ id: "r1" }]);
    const req = new Request("http://localhost/api/admin/reports?status=open", { headers: { cookie: COOKIE } });
    const res = await reportsGet(req);
    expect(await res.json()).toEqual({ reports: [{ id: "r1" }] });
    expect(listReports).toHaveBeenCalledWith(expect.anything(), expect.anything(), { status: "open" });
  });

  it("suspend: 인증 adminId를 행위자로(바디 위조 무시)", async () => {
    currentUserFromRefresh.mockResolvedValue({ userId: "real-admin" });
    suspendUser.mockResolvedValue(undefined);
    const res = await suspendPost(post({ adminId: "fake" }, COOKIE), idCtx);
    expect(res.status).toBe(200);
    expect(suspendUser).toHaveBeenCalledWith(expect.anything(), "real-admin", "target-1");
  });

  it("lift: 인증 adminId", async () => {
    currentUserFromRefresh.mockResolvedValue({ userId: "admin-1" });
    liftSuspension.mockResolvedValue(undefined);
    expect((await liftPost(post({}, COOKIE), idCtx)).status).toBe(200);
    expect(liftSuspension).toHaveBeenCalledWith(expect.anything(), "admin-1", "target-1");
  });

  it("force-delete: 인증 adminId", async () => {
    currentUserFromRefresh.mockResolvedValue({ userId: "admin-1" });
    forceDeleteProduct.mockResolvedValue(undefined);
    expect((await forceDeletePost(post({}, COOKIE), idCtx)).status).toBe(200);
    expect(forceDeleteProduct).toHaveBeenCalledWith(expect.anything(), "admin-1", "target-1");
  });

  it("resolve: 잘못된 action은 400, 서비스 미호출", async () => {
    currentUserFromRefresh.mockResolvedValue({ userId: "admin-1" });
    expect((await resolvePost(post({ action: "delete" }, COOKIE), idCtx)).status).toBe(400);
    expect(resolveReport).not.toHaveBeenCalled();
  });

  it("resolve: 유효 action이면 인증 adminId로 처리", async () => {
    currentUserFromRefresh.mockResolvedValue({ userId: "admin-1" });
    resolveReport.mockResolvedValue(undefined);
    const res = await resolvePost(post({ action: "resolve" }, COOKIE), idCtx);
    expect(res.status).toBe(200);
    expect(resolveReport).toHaveBeenCalledWith(expect.anything(), expect.anything(), "admin-1", "target-1", "resolve");
  });

  it("disputes: 목록 반환", async () => {
    currentUserFromRefresh.mockResolvedValue({ userId: "admin-1" });
    listDisputedEscrows.mockResolvedValue([{ id: "e1" }]);
    const res = await disputesGet(get(COOKIE));
    expect(await res.json()).toEqual({ disputes: [{ id: "e1" }] });
  });

  it("서비스 AppError를 상태코드로 매핑(CANNOT_SANCTION_SELF 400)", async () => {
    currentUserFromRefresh.mockResolvedValue({ userId: "admin-1" });
    suspendUser.mockRejectedValue(new AppError("CANNOT_SANCTION_SELF", "자신을 정지할 수 없어요.", 400));
    const res = await suspendPost(post({}, COOKIE), idCtx);
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: "CANNOT_SANCTION_SELF" });
  });
});
