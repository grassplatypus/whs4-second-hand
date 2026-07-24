// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import { REFRESH_COOKIE } from "@/features/auth/cookies";

const currentUserFromRefresh = vi.fn();
const userFindUnique = vi.fn();

vi.mock("@/features/_shared/prisma", () => ({
  prisma: { user: { findUnique: (...args: unknown[]) => userFindUnique(...args) } },
}));
vi.mock("@/features/auth/session", () => ({
  currentUserFromRefresh: (...args: unknown[]) => currentUserFromRefresh(...args),
}));

const { GET } = await import("./route");

function req(cookie?: string): Request {
  return new Request("http://localhost/api/admin/ping", { headers: cookie ? { cookie } : {} });
}

describe("GET /api/admin/ping — admin gate", () => {
  beforeEach(() => {
    currentUserFromRefresh.mockReset();
    userFindUnique.mockReset();
  });

  it("200 for an ADMIN", async () => {
    currentUserFromRefresh.mockResolvedValue({ userId: "u1" });
    userFindUnique.mockResolvedValue({ role: "ADMIN", deletedAt: null });
    const res = await GET(req(`${REFRESH_COOKIE}=tok`));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, role: "ADMIN" });
  });

  it("403 FORBIDDEN for a regular USER", async () => {
    currentUserFromRefresh.mockResolvedValue({ userId: "u1" });
    userFindUnique.mockResolvedValue({ role: "USER", deletedAt: null });
    const res = await GET(req(`${REFRESH_COOKIE}=tok`));
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: "FORBIDDEN" });
  });

  it("403 ACCOUNT_SUSPENDED for a SUSPENDED user (blocked before the role check)", async () => {
    currentUserFromRefresh.mockResolvedValue({ userId: "u1" });
    userFindUnique.mockResolvedValue({ role: "SUSPENDED", deletedAt: null });
    const res = await GET(req(`${REFRESH_COOKIE}=tok`));
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: "ACCOUNT_SUSPENDED" });
  });

  it("401 UNAUTHENTICATED without a session (GUEST)", async () => {
    currentUserFromRefresh.mockResolvedValue(null);
    const res = await GET(req());
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ code: "UNAUTHENTICATED" });
    expect(userFindUnique).not.toHaveBeenCalled();
  });
});
