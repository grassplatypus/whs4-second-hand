// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import { STEPUP_COOKIE, signStepUp } from "@/features/auth/twofactor/stepup";
import { REFRESH_COOKIE } from "@/features/auth/cookies";

const currentUserFromRefresh = vi.fn();
const changeNickname = vi.fn();

vi.mock("@/features/_shared/prisma", () => ({ prisma: {} }));
vi.mock("@/features/auth/session", () => ({ currentUserFromRefresh: (...args: unknown[]) => currentUserFromRefresh(...args) }));
vi.mock("@/features/profile/account", async () => {
  const actual = await vi.importActual<typeof import("@/features/profile/account")>("@/features/profile/account");
  return { ...actual, changeNickname: (...args: unknown[]) => changeNickname(...args) };
});

const { POST } = await import("./route");

function req(body: unknown, cookies: Record<string, string> = {}): Request {
  const cookie = Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join("; ");
  return new Request("http://localhost/api/profile/nickname", {
    method: "POST",
    headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body),
  });
}

describe("POST /api/profile/nickname — step-up gating", () => {
  beforeEach(() => {
    currentUserFromRefresh.mockReset();
    changeNickname.mockReset();
  });

  it("401 UNAUTHENTICATED when there's no refresh session (checked before step-up)", async () => {
    currentUserFromRefresh.mockResolvedValue(null);
    const res = await POST(req({ nickname: "새닉네임" }));
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ code: "UNAUTHENTICATED" });
    expect(changeNickname).not.toHaveBeenCalled();
  });

  it("401 STEP_UP_REQUIRED when refresh is valid but no step_up cookie present", async () => {
    currentUserFromRefresh.mockResolvedValue({ userId: "u1" });
    const res = await POST(req({ nickname: "새닉네임" }, { [REFRESH_COOKIE]: "tok" }));
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ code: "STEP_UP_REQUIRED" });
    expect(changeNickname).not.toHaveBeenCalled();
  });

  it("401 STEP_UP_REQUIRED when the step_up cookie belongs to a DIFFERENT user than the refresh session", async () => {
    currentUserFromRefresh.mockResolvedValue({ userId: "u1" });
    const otherUsersStepUp = await signStepUp("u2");
    const res = await POST(req({ nickname: "새닉네임" }, { [REFRESH_COOKIE]: "tok", [STEPUP_COOKIE]: otherUsersStepUp }));
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ code: "STEP_UP_REQUIRED" });
    expect(changeNickname).not.toHaveBeenCalled();
  });

  it("succeeds when refresh auth and step-up cookie agree on the same user", async () => {
    currentUserFromRefresh.mockResolvedValue({ userId: "u1" });
    changeNickname.mockResolvedValue(undefined);
    const sameUsersStepUp = await signStepUp("u1");
    const res = await POST(req({ nickname: "새닉네임" }, { [REFRESH_COOKIE]: "tok", [STEPUP_COOKIE]: sameUsersStepUp }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(changeNickname).toHaveBeenCalledWith(expect.anything(), "u1", "새닉네임", expect.anything());
  });
});
