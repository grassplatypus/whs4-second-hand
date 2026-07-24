// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import { REFRESH_COOKIE } from "@/features/auth/cookies";

const currentUserFromRefresh = vi.fn();
const changeNickname = vi.fn();
const userFindUnique = vi.fn();

vi.mock("@/features/_shared/prisma", () => ({
  prisma: { user: { findUnique: (...args: unknown[]) => userFindUnique(...args) } },
}));
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

// 닉네임 변경은 민감도가 낮다는 판단 아래 step-up 재인증을 요구하지 않는다(사용자 요청) —
// 로그인 여부만 확인하고 바로 changeNickname을 호출한다. 고유성(409)은 서비스가 강제한다.
describe("POST /api/profile/nickname — no step-up required", () => {
  beforeEach(() => {
    currentUserFromRefresh.mockReset();
    changeNickname.mockReset();
    userFindUnique.mockReset();
    userFindUnique.mockResolvedValue({ role: "USER", deletedAt: null });
  });

  it("401 UNAUTHENTICATED when there's no refresh session", async () => {
    currentUserFromRefresh.mockResolvedValue(null);
    const res = await POST(req({ nickname: "새닉네임" }));
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ code: "UNAUTHENTICATED" });
    expect(changeNickname).not.toHaveBeenCalled();
  });

  it("succeeds with just a valid refresh session — no step_up cookie needed", async () => {
    currentUserFromRefresh.mockResolvedValue({ userId: "u1" });
    changeNickname.mockResolvedValue(undefined);
    const res = await POST(req({ nickname: "새닉네임" }, { [REFRESH_COOKIE]: "tok" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(changeNickname).toHaveBeenCalledWith(expect.anything(), "u1", "새닉네임", expect.anything());
  });

  it("400 INVALID_INPUT when nickname isn't a string", async () => {
    currentUserFromRefresh.mockResolvedValue({ userId: "u1" });
    const res = await POST(req({ nickname: 123 }, { [REFRESH_COOKIE]: "tok" }));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: "INVALID_INPUT" });
    expect(changeNickname).not.toHaveBeenCalled();
  });

  it("propagates a 409 NICKNAME_TAKEN from the service", async () => {
    currentUserFromRefresh.mockResolvedValue({ userId: "u1" });
    const { AppError } = await import("@/features/_shared/error");
    changeNickname.mockRejectedValue(new AppError("NICKNAME_TAKEN", "이미 쓰고 있는 닉네임이에요.", 409));
    const res = await POST(req({ nickname: "이미있음" }, { [REFRESH_COOKIE]: "tok" }));
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: "NICKNAME_TAKEN" });
  });
});
