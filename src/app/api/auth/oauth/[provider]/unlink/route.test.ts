/**
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { STEPUP_COOKIE, signStepUp } from "@/features/auth/twofactor/stepup";
import { REFRESH_COOKIE } from "@/features/auth/cookies";

const currentUserFromRefresh = vi.fn();
const unlinkIdentity = vi.fn();

vi.mock("@/features/_shared/prisma", () => ({ prisma: {} }));
vi.mock("@/features/auth/session", () => ({ currentUserFromRefresh: (...args: unknown[]) => currentUserFromRefresh(...args) }));
vi.mock("@/features/auth/oauth/link", () => ({ unlinkIdentity: (...args: unknown[]) => unlinkIdentity(...args) }));

const { POST } = await import("./route");

function req(cookies: Record<string, string>): Request {
  const cookie = Object.entries(cookies)
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");
  return new Request("http://localhost/api/auth/oauth/google/unlink", {
    method: "POST",
    headers: cookie ? { cookie } : {},
  });
}

function ctx() {
  return { params: Promise.resolve({ provider: "google" }) };
}

describe("POST /api/auth/oauth/[provider]/unlink — step-up gating", () => {
  beforeEach(() => {
    currentUserFromRefresh.mockReset();
    unlinkIdentity.mockReset();
  });

  it("401 UNAUTHENTICATED when there's no refresh session (checked before step-up)", async () => {
    currentUserFromRefresh.mockResolvedValue(null);
    const res = await POST(req({}), ctx());
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ code: "UNAUTHENTICATED" });
    expect(unlinkIdentity).not.toHaveBeenCalled();
  });

  it("401 STEP_UP_REQUIRED when refresh is valid but no step_up cookie present", async () => {
    currentUserFromRefresh.mockResolvedValue({ userId: "u1" });
    const res = await POST(req({ [REFRESH_COOKIE]: "sometoken" }), ctx());
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ code: "STEP_UP_REQUIRED" });
    expect(unlinkIdentity).not.toHaveBeenCalled();
  });

  it("401 STEP_UP_REQUIRED when the step_up cookie belongs to a DIFFERENT user than the refresh session (no cross-user reuse)", async () => {
    currentUserFromRefresh.mockResolvedValue({ userId: "u1" });
    const otherUsersStepUp = await signStepUp("u2");
    const res = await POST(
      req({ [REFRESH_COOKIE]: "sometoken", [STEPUP_COOKIE]: otherUsersStepUp }),
      ctx(),
    );
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ code: "STEP_UP_REQUIRED" });
    expect(unlinkIdentity).not.toHaveBeenCalled();
  });

  it("succeeds when refresh auth and step-up cookie agree on the same user", async () => {
    currentUserFromRefresh.mockResolvedValue({ userId: "u1" });
    unlinkIdentity.mockResolvedValue(undefined);
    const sameUsersStepUp = await signStepUp("u1");
    const res = await POST(
      req({ [REFRESH_COOKIE]: "sometoken", [STEPUP_COOKIE]: sameUsersStepUp }),
      ctx(),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(unlinkIdentity).toHaveBeenCalledWith(expect.anything(), "u1", "GOOGLE", expect.anything());
  });
});
