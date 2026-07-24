// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import { STEPUP_COOKIE, signStepUp } from "@/features/auth/twofactor/stepup";
import { REFRESH_COOKIE } from "@/features/auth/cookies";

const currentUserFromRefresh = vi.fn();
const withdraw = vi.fn();

vi.mock("@/features/_shared/prisma", () => ({ prisma: {} }));
vi.mock("@/features/auth/session", () => ({ currentUserFromRefresh: (...args: unknown[]) => currentUserFromRefresh(...args) }));
vi.mock("@/features/profile/account", async () => {
  const actual = await vi.importActual<typeof import("@/features/profile/account")>("@/features/profile/account");
  return { ...actual, withdraw: (...args: unknown[]) => withdraw(...args) };
});

const { POST } = await import("./route");

function req(cookies: Record<string, string> = {}): Request {
  const cookie = Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join("; ");
  return new Request("http://localhost/api/auth/withdraw", {
    method: "POST",
    headers: cookie ? { cookie } : {},
  });
}

describe("POST /api/auth/withdraw — step-up gating", () => {
  beforeEach(() => {
    currentUserFromRefresh.mockReset();
    withdraw.mockReset();
  });

  it("401 UNAUTHENTICATED when there's no refresh session (checked before step-up)", async () => {
    currentUserFromRefresh.mockResolvedValue(null);
    const res = await POST(req());
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ code: "UNAUTHENTICATED" });
    expect(withdraw).not.toHaveBeenCalled();
  });

  it("401 STEP_UP_REQUIRED when refresh is valid but no step_up cookie present", async () => {
    currentUserFromRefresh.mockResolvedValue({ userId: "u1" });
    const res = await POST(req({ [REFRESH_COOKIE]: "tok" }));
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ code: "STEP_UP_REQUIRED" });
    expect(withdraw).not.toHaveBeenCalled();
  });

  it("401 STEP_UP_REQUIRED when the step_up cookie belongs to a DIFFERENT user than the refresh session", async () => {
    currentUserFromRefresh.mockResolvedValue({ userId: "u1" });
    const otherUsersStepUp = await signStepUp("u2");
    const res = await POST(req({ [REFRESH_COOKIE]: "tok", [STEPUP_COOKIE]: otherUsersStepUp }));
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ code: "STEP_UP_REQUIRED" });
    expect(withdraw).not.toHaveBeenCalled();
  });

  it("succeeds and clears the refresh cookie when refresh auth and step-up agree", async () => {
    currentUserFromRefresh.mockResolvedValue({ userId: "u1" });
    withdraw.mockResolvedValue(undefined);
    const sameUsersStepUp = await signStepUp("u1");
    const res = await POST(req({ [REFRESH_COOKIE]: "tok", [STEPUP_COOKIE]: sameUsersStepUp }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(withdraw).toHaveBeenCalledWith(expect.anything(), "u1", expect.anything());
    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toMatch(/refresh_token=;/);
    expect(setCookie).toMatch(/Max-Age=0/);
  });
});
