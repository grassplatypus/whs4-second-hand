// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import { REFRESH_COOKIE } from "@/features/auth/cookies";

const currentUserFromRefresh = vi.fn();
const getMyProfile = vi.fn();
const userFindUnique = vi.fn();

vi.mock("@/features/_shared/prisma", () => ({
  prisma: { user: { findUnique: (...args: unknown[]) => userFindUnique(...args) } },
}));
vi.mock("@/features/auth/session", () => ({ currentUserFromRefresh: (...args: unknown[]) => currentUserFromRefresh(...args) }));
vi.mock("@/features/profile/service", async () => {
  const actual = await vi.importActual<typeof import("@/features/profile/service")>("@/features/profile/service");
  return { ...actual, getMyProfile: (...args: unknown[]) => getMyProfile(...args) };
});

const { GET } = await import("./route");

function req(cookie?: string): Request {
  return new Request("http://localhost/api/profile/me", { headers: cookie ? { cookie } : {} });
}

describe("GET /api/profile/me", () => {
  beforeEach(() => {
    currentUserFromRefresh.mockReset();
    getMyProfile.mockReset();
    userFindUnique.mockReset();
    userFindUnique.mockResolvedValue({ role: "USER", deletedAt: null });
  });

  it("401 UNAUTHENTICATED without a valid refresh session", async () => {
    currentUserFromRefresh.mockResolvedValue(null);
    const res = await GET(req());
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ code: "UNAUTHENTICATED" });
    expect(getMyProfile).not.toHaveBeenCalled();
  });

  it("returns the caller's own profile when authenticated", async () => {
    currentUserFromRefresh.mockResolvedValue({ userId: "u1" });
    getMyProfile.mockResolvedValue({ nickname: "n1", bio: null, region: null, phoneVerified: false, twoFactorMethod: "NONE", identities: [], hasPassword: true, createdAt: new Date(0) });
    const res = await GET(req(`${REFRESH_COOKIE}=tok`));
    expect(res.status).toBe(200);
    expect(getMyProfile).toHaveBeenCalledWith(expect.anything(), "u1");
  });
});
