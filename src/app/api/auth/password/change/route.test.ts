// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import { STEPUP_COOKIE, signStepUp } from "@/features/auth/twofactor/stepup";
import { REFRESH_COOKIE } from "@/features/auth/cookies";

const currentUserFromRefresh = vi.fn();
const changePassword = vi.fn();
const sessionFindUnique = vi.fn();

vi.mock("@/features/_shared/prisma", () => ({ prisma: { session: { findUnique: (...args: unknown[]) => sessionFindUnique(...args) } } }));
vi.mock("@/features/auth/session", () => ({ currentUserFromRefresh: (...args: unknown[]) => currentUserFromRefresh(...args) }));
vi.mock("@/features/profile/account", async () => {
  const actual = await vi.importActual<typeof import("@/features/profile/account")>("@/features/profile/account");
  return { ...actual, changePassword: (...args: unknown[]) => changePassword(...args) };
});

const { POST } = await import("./route");

function req(body: unknown, cookies: Record<string, string> = {}): Request {
  const cookie = Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join("; ");
  return new Request("http://localhost/api/auth/password/change", {
    method: "POST",
    headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body),
  });
}

describe("POST /api/auth/password/change — step-up gating + session sparing", () => {
  beforeEach(() => {
    currentUserFromRefresh.mockReset();
    changePassword.mockReset();
    sessionFindUnique.mockReset();
  });

  it("401 UNAUTHENTICATED when there's no refresh session (checked before step-up)", async () => {
    currentUserFromRefresh.mockResolvedValue(null);
    const res = await POST(req({ currentPassword: "oldpassword1", newPassword: "newpassword1" }));
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ code: "UNAUTHENTICATED" });
    expect(changePassword).not.toHaveBeenCalled();
  });

  it("401 STEP_UP_REQUIRED when refresh is valid but no step_up cookie present", async () => {
    currentUserFromRefresh.mockResolvedValue({ userId: "u1" });
    const res = await POST(req({ currentPassword: "oldpassword1", newPassword: "newpassword1" }, { [REFRESH_COOKIE]: "tok" }));
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ code: "STEP_UP_REQUIRED" });
    expect(changePassword).not.toHaveBeenCalled();
  });

  it("401 STEP_UP_REQUIRED when the step_up cookie belongs to a DIFFERENT user than the refresh session", async () => {
    currentUserFromRefresh.mockResolvedValue({ userId: "u1" });
    const otherUsersStepUp = await signStepUp("u2");
    const res = await POST(
      req({ currentPassword: "oldpassword1", newPassword: "newpassword1" }, { [REFRESH_COOKIE]: "tok", [STEPUP_COOKIE]: otherUsersStepUp }),
    );
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ code: "STEP_UP_REQUIRED" });
    expect(changePassword).not.toHaveBeenCalled();
  });

  it("passes the current session id (resolved from the refresh cookie) so it's spared", async () => {
    currentUserFromRefresh.mockResolvedValue({ userId: "u1" });
    sessionFindUnique.mockResolvedValue({ id: "sess-current" });
    changePassword.mockResolvedValue(undefined);
    const sameUsersStepUp = await signStepUp("u1");
    const res = await POST(
      req({ currentPassword: "oldpassword1", newPassword: "newpassword1" }, { [REFRESH_COOKIE]: "tok", [STEPUP_COOKIE]: sameUsersStepUp }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(changePassword).toHaveBeenCalledWith(
      expect.anything(),
      "u1",
      "oldpassword1",
      "newpassword1",
      "sess-current",
      expect.anything(),
    );
  });

  it("401 AUTH_FAILED if the session row can't be found for the refresh token (edge case, shouldn't normally happen)", async () => {
    currentUserFromRefresh.mockResolvedValue({ userId: "u1" });
    sessionFindUnique.mockResolvedValue(null);
    const sameUsersStepUp = await signStepUp("u1");
    const res = await POST(
      req({ currentPassword: "oldpassword1", newPassword: "newpassword1" }, { [REFRESH_COOKIE]: "tok", [STEPUP_COOKIE]: sameUsersStepUp }),
    );
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ code: "AUTH_FAILED" });
    expect(changePassword).not.toHaveBeenCalled();
  });
});
