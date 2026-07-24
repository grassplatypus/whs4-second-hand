// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import { signAccessToken } from "@/features/auth/tokens";

const userFindUnique = vi.fn();

vi.mock("@/features/_shared/prisma", () => ({
  prisma: { user: { findUnique: (...args: unknown[]) => userFindUnique(...args) } },
}));

const { GET } = await import("./route");

function req(authorization?: string): Request {
  return new Request("http://localhost/api/auth/me", {
    headers: authorization ? { authorization } : {},
  });
}

describe("GET /api/auth/me", () => {
  beforeEach(() => {
    userFindUnique.mockReset();
  });

  it("returns {userId, role} for a valid bearer token and an active USER (DB fresh)", async () => {
    const token = await signAccessToken({ userId: "u1", role: "USER" });
    userFindUnique.mockResolvedValue({ role: "USER", deletedAt: null });

    const res = await GET(req(`Bearer ${token}`));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ userId: "u1", role: "USER" });
  });

  it("403 ACCOUNT_SUSPENDED when the DB row is SUSPENDED even though the token's role claims USER (stale token)", async () => {
    const token = await signAccessToken({ userId: "u1", role: "USER" });
    userFindUnique.mockResolvedValue({ role: "SUSPENDED", deletedAt: null });

    const res = await GET(req(`Bearer ${token}`));

    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: "ACCOUNT_SUSPENDED" });
  });

  it("401 UNAUTHENTICATED without an Authorization header", async () => {
    const res = await GET(req());

    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ code: "UNAUTHENTICATED" });
    expect(userFindUnique).not.toHaveBeenCalled();
  });
});
