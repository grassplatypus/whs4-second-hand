// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import { AppError } from "@/features/_shared/error";
import { REFRESH_COOKIE } from "@/features/auth/cookies";

const currentUserFromRefresh = vi.fn();
const restoreProduct = vi.fn();
const userFindUnique = vi.fn();

vi.mock("@/features/_shared/prisma", () => ({
  prisma: { user: { findUnique: (...args: unknown[]) => userFindUnique(...args) } },
}));
vi.mock("@/features/auth/session", () => ({ currentUserFromRefresh: (...args: unknown[]) => currentUserFromRefresh(...args) }));
vi.mock("@/features/products/service", async () => {
  const actual = await vi.importActual<typeof import("@/features/products/service")>("@/features/products/service");
  return { ...actual, restoreProduct: (...args: unknown[]) => restoreProduct(...args) };
});

const { POST } = await import("./route");

function ctx(id: string) {
  return { params: Promise.resolve({ id }) };
}

function req(cookie?: string): Request {
  return new Request("http://localhost/api/products/p1/restore", {
    method: "POST",
    headers: cookie ? { cookie } : {},
  });
}

describe("POST /api/products/[id]/restore — active USER; ownership enforced in the service", () => {
  beforeEach(() => {
    currentUserFromRefresh.mockReset();
    restoreProduct.mockReset();
    userFindUnique.mockReset();
    userFindUnique.mockResolvedValue({ role: "USER", deletedAt: null });
  });

  it("401 UNAUTHENTICATED for a guest", async () => {
    currentUserFromRefresh.mockResolvedValue(null);
    const res = await POST(req(), ctx("p1"));
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ code: "UNAUTHENTICATED" });
    expect(restoreProduct).not.toHaveBeenCalled();
  });

  it("403 FORBIDDEN when the service rejects a non-owner", async () => {
    currentUserFromRefresh.mockResolvedValue({ userId: "not-owner" });
    restoreProduct.mockImplementationOnce(async () => {
      throw new AppError("FORBIDDEN", "권한이 없어요.", 403);
    });
    const res = await POST(req(`${REFRESH_COOKIE}=tok`), ctx("p1"));
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: "FORBIDDEN" });
  });

  it("404 NOT_FOUND when the service can't find the product", async () => {
    currentUserFromRefresh.mockResolvedValue({ userId: "owner" });
    restoreProduct.mockImplementationOnce(async () => {
      throw new AppError("NOT_FOUND", "상품을 찾을 수 없어요.", 404);
    });
    const res = await POST(req(`${REFRESH_COOKIE}=tok`), ctx("p1"));
    expect(res.status).toBe(404);
  });

  it("200s {ok:true} for the owner", async () => {
    currentUserFromRefresh.mockResolvedValue({ userId: "owner" });
    restoreProduct.mockResolvedValue(undefined);
    const res = await POST(req(`${REFRESH_COOKIE}=tok`), ctx("p1"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(restoreProduct).toHaveBeenCalledWith(expect.anything(), "owner", "p1");
  });
});
