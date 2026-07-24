// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import { REFRESH_COOKIE } from "@/features/auth/cookies";

const currentUserFromRefresh = vi.fn();
const createProduct = vi.fn();
const searchProducts = vi.fn();
const userFindUnique = vi.fn();

vi.mock("@/features/_shared/prisma", () => ({
  prisma: { user: { findUnique: (...args: unknown[]) => userFindUnique(...args) } },
}));
vi.mock("@/features/auth/session", () => ({ currentUserFromRefresh: (...args: unknown[]) => currentUserFromRefresh(...args) }));
vi.mock("@/features/products/service", async () => {
  const actual = await vi.importActual<typeof import("@/features/products/service")>("@/features/products/service");
  return { ...actual, createProduct: (...args: unknown[]) => createProduct(...args) };
});
vi.mock("@/features/products/search", async () => {
  const actual = await vi.importActual<typeof import("@/features/products/search")>("@/features/products/search");
  return { ...actual, searchProducts: (...args: unknown[]) => searchProducts(...args) };
});

const { GET, POST } = await import("./route");

function postReq(body: unknown, cookie?: string): Request {
  return new Request("http://localhost/api/products", {
    method: "POST",
    headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body),
  });
}

describe("GET /api/products — public, no auth", () => {
  beforeEach(() => {
    searchProducts.mockReset();
  });

  it("200s without any auth cookie and forwards parsed query params", async () => {
    searchProducts.mockResolvedValue({ items: [], nextCursor: null });
    const res = await GET(new Request("http://localhost/api/products?category=DIGITAL&minPrice=1000&limit=10"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ items: [], nextCursor: null });
    expect(searchProducts).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ category: "DIGITAL", minPrice: 1000, limit: 10 }),
    );
  });

  it("coerces numeric query params (lat/lng/radiusKm) to numbers, not strings", async () => {
    searchProducts.mockResolvedValue({ items: [], nextCursor: null });
    await GET(new Request("http://localhost/api/products?lat=37.5&lng=127.0&radiusKm=3"));
    const passed = searchProducts.mock.calls[0][1] as Record<string, unknown>;
    expect(passed.lat).toBe(37.5);
    expect(passed.lng).toBe(127.0);
    expect(passed.radiusKm).toBe(3);
  });
});

describe("POST /api/products — active USER only", () => {
  beforeEach(() => {
    currentUserFromRefresh.mockReset();
    createProduct.mockReset();
    userFindUnique.mockReset();
    userFindUnique.mockResolvedValue({ role: "USER", deletedAt: null });
  });

  it("401 UNAUTHENTICATED for a guest (no session)", async () => {
    currentUserFromRefresh.mockResolvedValue(null);
    const res = await POST(postReq({ title: "t" }));
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ code: "UNAUTHENTICATED" });
    expect(createProduct).not.toHaveBeenCalled();
  });

  it("403 ACCOUNT_SUSPENDED for a suspended user", async () => {
    currentUserFromRefresh.mockResolvedValue({ userId: "u1" });
    userFindUnique.mockResolvedValue({ role: "SUSPENDED", deletedAt: null });
    const res = await POST(postReq({ title: "t" }, `${REFRESH_COOKIE}=tok`));
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: "ACCOUNT_SUSPENDED" });
    expect(createProduct).not.toHaveBeenCalled();
  });

  it("201s and returns {id} when authenticated with valid input", async () => {
    currentUserFromRefresh.mockResolvedValue({ userId: "u1" });
    createProduct.mockResolvedValue({ id: "p1" });
    const res = await POST(postReq({ title: "t" }, `${REFRESH_COOKIE}=tok`));
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ id: "p1" });
    expect(createProduct).toHaveBeenCalledWith(expect.anything(), "u1", { title: "t" });
  });
});
