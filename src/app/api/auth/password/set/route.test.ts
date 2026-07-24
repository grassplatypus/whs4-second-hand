// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import { STEPUP_COOKIE, signStepUp } from "@/features/auth/twofactor/stepup";
import { REFRESH_COOKIE } from "@/features/auth/cookies";

const currentUserFromRefresh = vi.fn();
const setPassword = vi.fn();
const userFindUnique = vi.fn();

vi.mock("@/features/_shared/prisma", () => ({
  prisma: { user: { findUnique: (...args: unknown[]) => userFindUnique(...args) } },
}));
vi.mock("@/features/auth/session", () => ({ currentUserFromRefresh: (...args: unknown[]) => currentUserFromRefresh(...args) }));
vi.mock("@/features/profile/account", async () => {
  const actual = await vi.importActual<typeof import("@/features/profile/account")>("@/features/profile/account");
  return { ...actual, setPassword: (...args: unknown[]) => setPassword(...args) };
});

const { POST } = await import("./route");

function req(body: unknown, cookies: Record<string, string> = {}): Request {
  const cookie = Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join("; ");
  return new Request("http://localhost/api/auth/password/set", {
    method: "POST",
    headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body),
  });
}

describe("POST /api/auth/password/set — step-up gating", () => {
  beforeEach(() => {
    currentUserFromRefresh.mockReset();
    setPassword.mockReset();
    userFindUnique.mockReset();
    userFindUnique.mockResolvedValue({ role: "USER", deletedAt: null });
  });

  it("401 UNAUTHENTICATED when there's no refresh session (checked before step-up)", async () => {
    currentUserFromRefresh.mockResolvedValue(null);
    const res = await POST(req({ password: "goodpassword1" }));
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ code: "UNAUTHENTICATED" });
    expect(setPassword).not.toHaveBeenCalled();
  });

  it("401 STEP_UP_REQUIRED when refresh is valid but no step_up cookie present", async () => {
    currentUserFromRefresh.mockResolvedValue({ userId: "u1" });
    const res = await POST(req({ password: "goodpassword1" }, { [REFRESH_COOKIE]: "tok" }));
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ code: "STEP_UP_REQUIRED" });
    expect(setPassword).not.toHaveBeenCalled();
  });

  it("401 STEP_UP_REQUIRED when the step_up cookie belongs to a DIFFERENT user than the refresh session", async () => {
    currentUserFromRefresh.mockResolvedValue({ userId: "u1" });
    const otherUsersStepUp = await signStepUp("u2");
    const res = await POST(req({ password: "goodpassword1" }, { [REFRESH_COOKIE]: "tok", [STEPUP_COOKIE]: otherUsersStepUp }));
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ code: "STEP_UP_REQUIRED" });
    expect(setPassword).not.toHaveBeenCalled();
  });

  it("succeeds when refresh auth and step-up cookie agree on the same user", async () => {
    currentUserFromRefresh.mockResolvedValue({ userId: "u1" });
    setPassword.mockResolvedValue(undefined);
    const sameUsersStepUp = await signStepUp("u1");
    const res = await POST(req({ password: "goodpassword1" }, { [REFRESH_COOKIE]: "tok", [STEPUP_COOKIE]: sameUsersStepUp }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(setPassword).toHaveBeenCalledWith(expect.anything(), "u1", "goodpassword1", expect.anything());
  });
});
