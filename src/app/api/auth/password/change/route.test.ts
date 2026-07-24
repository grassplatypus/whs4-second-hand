// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import { REFRESH_COOKIE } from "@/features/auth/cookies";
import { AppError } from "@/features/_shared/error";

const currentUserFromRefresh = vi.fn();
const changePassword = vi.fn();
const sessionFindUnique = vi.fn();
const userFindUnique = vi.fn();

vi.mock("@/features/_shared/prisma", () => ({
  prisma: {
    session: { findUnique: (...args: unknown[]) => sessionFindUnique(...args) },
    user: { findUnique: (...args: unknown[]) => userFindUnique(...args) },
  },
}));
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

// 사용자 요청에 따라 step-up(재인증 쿠키)을 없애고, 현재 비밀번호를 그 자리에서
// 검증하는 표준 재인증 방식으로 바꿨다 — 이 라우트는 로그인 여부만 확인하고
// 실제 검증(틀린 현재 비밀번호 거부)은 changePassword(profile/account.ts)에 위임한다.
describe("POST /api/auth/password/change — inline current-password reauth (no step-up)", () => {
  beforeEach(() => {
    currentUserFromRefresh.mockReset();
    changePassword.mockReset();
    sessionFindUnique.mockReset();
    userFindUnique.mockReset();
    userFindUnique.mockResolvedValue({ role: "USER", deletedAt: null });
  });

  it("401 UNAUTHENTICATED when there's no refresh session", async () => {
    currentUserFromRefresh.mockResolvedValue(null);
    const res = await POST(req({ currentPassword: "oldpassword1", newPassword: "newpassword1" }));
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ code: "UNAUTHENTICATED" });
    expect(changePassword).not.toHaveBeenCalled();
  });

  it("400 INVALID_INPUT when currentPassword or newPassword is missing, without calling changePassword", async () => {
    currentUserFromRefresh.mockResolvedValue({ userId: "u1" });
    sessionFindUnique.mockResolvedValue({ id: "sess-current" });
    const res = await POST(req({ newPassword: "newpassword1" }, { [REFRESH_COOKIE]: "tok" }));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: "INVALID_INPUT" });
    expect(changePassword).not.toHaveBeenCalled();
  });

  it("passes currentPassword/newPassword and the current session id (resolved from the refresh cookie) so it's spared — no step-up cookie required", async () => {
    currentUserFromRefresh.mockResolvedValue({ userId: "u1" });
    sessionFindUnique.mockResolvedValue({ id: "sess-current" });
    changePassword.mockResolvedValue(undefined);
    const res = await POST(
      req({ currentPassword: "oldpassword1", newPassword: "newpassword1" }, { [REFRESH_COOKIE]: "tok" }),
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

  it("propagates a 401 AUTH_FAILED from changePassword when the current password is wrong", async () => {
    currentUserFromRefresh.mockResolvedValue({ userId: "u1" });
    sessionFindUnique.mockResolvedValue({ id: "sess-current" });
    changePassword.mockRejectedValue(new AppError("AUTH_FAILED", "다시 로그인해 주세요.", 401));
    const res = await POST(
      req({ currentPassword: "totally-wrong", newPassword: "newpassword1" }, { [REFRESH_COOKIE]: "tok" }),
    );
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ code: "AUTH_FAILED" });
  });

  it("401 AUTH_FAILED if the session row can't be found for the refresh token (edge case, shouldn't normally happen)", async () => {
    currentUserFromRefresh.mockResolvedValue({ userId: "u1" });
    sessionFindUnique.mockResolvedValue(null);
    const res = await POST(
      req({ currentPassword: "oldpassword1", newPassword: "newpassword1" }, { [REFRESH_COOKIE]: "tok" }),
    );
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ code: "AUTH_FAILED" });
    expect(changePassword).not.toHaveBeenCalled();
  });
});
