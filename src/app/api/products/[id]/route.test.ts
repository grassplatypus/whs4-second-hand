// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import { AppError } from "@/features/_shared/error";
import { REFRESH_COOKIE } from "@/features/auth/cookies";

const currentUserFromRefresh = vi.fn();
const getProduct = vi.fn();
const updateProduct = vi.fn();
const deleteProduct = vi.fn();
const userFindUnique = vi.fn();

vi.mock("@/features/_shared/prisma", () => ({
  prisma: { user: { findUnique: (...args: unknown[]) => userFindUnique(...args) } },
}));
vi.mock("@/features/auth/session", () => ({ currentUserFromRefresh: (...args: unknown[]) => currentUserFromRefresh(...args) }));
vi.mock("@/features/products/service", async () => {
  const actual = await vi.importActual<typeof import("@/features/products/service")>("@/features/products/service");
  return {
    ...actual,
    getProduct: (...args: unknown[]) => getProduct(...args),
    updateProduct: (...args: unknown[]) => updateProduct(...args),
    deleteProduct: (...args: unknown[]) => deleteProduct(...args),
  };
});

const { GET, PATCH, DELETE } = await import("./route");

function ctx(id: string) {
  return { params: Promise.resolve({ id }) };
}

function req(method: string, body?: unknown, cookie?: string): Request {
  return new Request(`http://localhost/api/products/p1`, {
    method,
    headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

describe("GET /api/products/[id] — public, no auth", () => {
  beforeEach(() => getProduct.mockReset());

  it("200s without any auth cookie", async () => {
    getProduct.mockResolvedValue({ id: "p1", title: "t" });
    const res = await GET(req("GET"), ctx("p1"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: "p1", title: "t" });
  });

  it("404 NOT_FOUND when missing", async () => {
    getProduct.mockImplementationOnce(async () => {
      throw new AppError("NOT_FOUND", "상품을 찾을 수 없어요.", 404);
    });
    const res = await GET(req("GET"), ctx("ghost"));
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("PATCH /api/products/[id] — active USER; ownership enforced in the service", () => {
  beforeEach(() => {
    currentUserFromRefresh.mockReset();
    updateProduct.mockReset();
    userFindUnique.mockReset();
    userFindUnique.mockResolvedValue({ role: "USER", deletedAt: null });
  });

  it("401 UNAUTHENTICATED for a guest", async () => {
    currentUserFromRefresh.mockResolvedValue(null);
    const res = await PATCH(req("PATCH", { title: "new" }), ctx("p1"));
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ code: "UNAUTHENTICATED" });
    expect(updateProduct).not.toHaveBeenCalled();
  });

  it("403 FORBIDDEN when the service rejects a non-owner", async () => {
    currentUserFromRefresh.mockResolvedValue({ userId: "not-owner" });
    updateProduct.mockImplementationOnce(async () => {
      throw new AppError("FORBIDDEN", "권한이 없어요.", 403);
    });
    const res = await PATCH(req("PATCH", { title: "new" }, `${REFRESH_COOKIE}=tok`), ctx("p1"));
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: "FORBIDDEN" });
  });

  it("200s {ok:true} for the owner with valid input", async () => {
    currentUserFromRefresh.mockResolvedValue({ userId: "owner" });
    updateProduct.mockResolvedValue(undefined);
    const res = await PATCH(req("PATCH", { title: "new" }, `${REFRESH_COOKIE}=tok`), ctx("p1"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(updateProduct).toHaveBeenCalledWith(expect.anything(), "owner", "p1", { title: "new" });
  });
});

describe("DELETE /api/products/[id] — active USER; ownership enforced in the service", () => {
  beforeEach(() => {
    currentUserFromRefresh.mockReset();
    deleteProduct.mockReset();
    userFindUnique.mockReset();
    userFindUnique.mockResolvedValue({ role: "USER", deletedAt: null });
  });

  it("401 UNAUTHENTICATED for a guest", async () => {
    currentUserFromRefresh.mockResolvedValue(null);
    const res = await DELETE(req("DELETE"), ctx("p1"));
    expect(res.status).toBe(401);
    expect(deleteProduct).not.toHaveBeenCalled();
  });

  it("200s {ok:true} for the owner", async () => {
    currentUserFromRefresh.mockResolvedValue({ userId: "owner" });
    deleteProduct.mockResolvedValue(undefined);
    const res = await DELETE(req("DELETE", undefined, `${REFRESH_COOKIE}=tok`), ctx("p1"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(deleteProduct).toHaveBeenCalledWith(expect.anything(), "owner", "p1");
  });
});
