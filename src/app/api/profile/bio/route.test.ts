// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import { REFRESH_COOKIE } from "@/features/auth/cookies";

const currentUserFromRefresh = vi.fn();
const updateBio = vi.fn();
const userFindUnique = vi.fn();

vi.mock("@/features/_shared/prisma", () => ({
  prisma: { user: { findUnique: (...args: unknown[]) => userFindUnique(...args) } },
}));
vi.mock("@/features/auth/session", () => ({ currentUserFromRefresh: (...args: unknown[]) => currentUserFromRefresh(...args) }));
vi.mock("@/features/profile/service", async () => {
  const actual = await vi.importActual<typeof import("@/features/profile/service")>("@/features/profile/service");
  return { ...actual, updateBio: (...args: unknown[]) => updateBio(...args) };
});

const { PATCH } = await import("./route");

function req(body: unknown, cookie?: string): Request {
  return new Request("http://localhost/api/profile/bio", {
    method: "PATCH",
    headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body),
  });
}

describe("PATCH /api/profile/bio", () => {
  beforeEach(() => {
    currentUserFromRefresh.mockReset();
    updateBio.mockReset();
    userFindUnique.mockReset();
    userFindUnique.mockResolvedValue({ role: "USER", deletedAt: null });
  });

  it("401 UNAUTHENTICATED without a valid refresh session", async () => {
    currentUserFromRefresh.mockResolvedValue(null);
    const res = await PATCH(req({ bio: "hi" }));
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ code: "UNAUTHENTICATED" });
    expect(updateBio).not.toHaveBeenCalled();
  });

  it("400 INVALID_INPUT when bio is missing/not a string", async () => {
    currentUserFromRefresh.mockResolvedValue({ userId: "u1" });
    const res = await PATCH(req({}, `${REFRESH_COOKIE}=tok`));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: "INVALID_INPUT" });
    expect(updateBio).not.toHaveBeenCalled();
  });

  it("updates bio when authenticated with a valid body", async () => {
    currentUserFromRefresh.mockResolvedValue({ userId: "u1" });
    updateBio.mockResolvedValue(undefined);
    const res = await PATCH(req({ bio: "hello" }, `${REFRESH_COOKIE}=tok`));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(updateBio).toHaveBeenCalledWith(expect.anything(), "u1", "hello", expect.anything());
  });

  it("403 ACCOUNT_SUSPENDED for a SUSPENDED user, even with a live session (real-time block)", async () => {
    currentUserFromRefresh.mockResolvedValue({ userId: "u1" });
    userFindUnique.mockResolvedValue({ role: "SUSPENDED", deletedAt: null });
    const res = await PATCH(req({ bio: "hello" }, `${REFRESH_COOKIE}=tok`));
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: "ACCOUNT_SUSPENDED" });
    expect(updateBio).not.toHaveBeenCalled();
  });
});
