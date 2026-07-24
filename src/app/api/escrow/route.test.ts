// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import { AppError } from "@/features/_shared/error";
import { REFRESH_COOKIE } from "@/features/auth/cookies";

const currentUserFromRefresh = vi.fn();
const userFindUnique = vi.fn();
const requestEscrow = vi.fn();
const listEscrows = vi.fn();

vi.mock("@/features/_shared/prisma", () => ({
  prisma: { user: { findUnique: (...a: unknown[]) => userFindUnique(...a) } },
}));
vi.mock("@/features/auth/session", () => ({
  currentUserFromRefresh: (...a: unknown[]) => currentUserFromRefresh(...a),
}));
vi.mock("@/features/escrow/service", async () => {
  const actual = await vi.importActual<typeof import("@/features/escrow/service")>("@/features/escrow/service");
  return {
    ...actual,
    requestEscrow: (...a: unknown[]) => requestEscrow(...a),
    listEscrows: (...a: unknown[]) => listEscrows(...a),
  };
});

const { POST, GET } = await import("./route");

function req(body: unknown, cookie?: string): Request {
  return new Request("http://localhost/api/escrow", {
    method: "POST",
    headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body),
  });
}
function getReq(cookie?: string): Request {
  return new Request("http://localhost/api/escrow", { headers: cookie ? { cookie } : {} });
}

beforeEach(() => {
  currentUserFromRefresh.mockReset();
  userFindUnique.mockReset().mockResolvedValue({ role: "USER", deletedAt: null });
  requestEscrow.mockReset();
  listEscrows.mockReset();
});

describe("POST /api/escrow (요청)", () => {
  it("GUEST는 401이고 서비스를 부르지 않는다", async () => {
    currentUserFromRefresh.mockResolvedValue(null);
    const res = await POST(req({ productId: "p1", amount: 10000 }));
    expect(res.status).toBe(401);
    expect(requestEscrow).not.toHaveBeenCalled();
  });

  it("SUSPENDED는 403", async () => {
    currentUserFromRefresh.mockResolvedValue({ userId: "u1" });
    userFindUnique.mockResolvedValue({ role: "SUSPENDED", deletedAt: null });
    const res = await POST(req({ productId: "p1", amount: 10000 }, `${REFRESH_COOKIE}=t`));
    expect(res.status).toBe(403);
    expect(requestEscrow).not.toHaveBeenCalled();
  });

  it("금액이 숫자가 아니면 400", async () => {
    currentUserFromRefresh.mockResolvedValue({ userId: "u1" });
    const res = await POST(req({ productId: "p1", amount: "1만원" }, `${REFRESH_COOKIE}=t`));
    expect(res.status).toBe(400);
    expect(requestEscrow).not.toHaveBeenCalled();
  });

  it("인증된 userId를 구매자로 넘긴다(body buyerId 위조 무시), 201", async () => {
    currentUserFromRefresh.mockResolvedValue({ userId: "real-buyer" });
    requestEscrow.mockResolvedValue({ id: "e1" });
    const res = await POST(req({ productId: "p1", amount: 10000, buyerId: "impersonated" }, `${REFRESH_COOKIE}=t`));
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ id: "e1" });
    expect(requestEscrow).toHaveBeenCalledWith(expect.anything(), "real-buyer", "p1", 10000);
  });

  it("서비스 AppError를 상태코드로 매핑(SELF_TRADE 400)", async () => {
    currentUserFromRefresh.mockResolvedValue({ userId: "u1" });
    requestEscrow.mockRejectedValue(new AppError("SELF_TRADE", "내 상품은 거래 요청할 수 없어요.", 400));
    const res = await POST(req({ productId: "p1", amount: 10000 }, `${REFRESH_COOKIE}=t`));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: "SELF_TRADE" });
  });
});

describe("GET /api/escrow (목록)", () => {
  it("GUEST는 401", async () => {
    currentUserFromRefresh.mockResolvedValue(null);
    const res = await GET(getReq());
    expect(res.status).toBe(401);
  });

  it("인증된 본인 userId로 목록 조회", async () => {
    currentUserFromRefresh.mockResolvedValue({ userId: "me" });
    listEscrows.mockResolvedValue([{ id: "e1" }]);
    const res = await GET(getReq(`${REFRESH_COOKIE}=t`));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ escrows: [{ id: "e1" }] });
    expect(listEscrows).toHaveBeenCalledWith(expect.anything(), "me");
  });
});
