// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import { REFRESH_COOKIE } from "@/features/auth/cookies";
import { AppError } from "@/features/_shared/error";

const currentUserFromRefresh = vi.fn();
const startPhoneVerification = vi.fn();
const userFindUnique = vi.fn();

vi.mock("@/features/_shared/prisma", () => ({
  prisma: { user: { findUnique: (...args: unknown[]) => userFindUnique(...args) } },
}));
vi.mock("@/features/auth/session", () => ({ currentUserFromRefresh: (...args: unknown[]) => currentUserFromRefresh(...args) }));
vi.mock("@/features/location/phone/sms", () => ({ getSms: () => ({ send: vi.fn() }) }));
vi.mock("@/features/location/service", () => ({ startPhoneVerification: (...args: unknown[]) => startPhoneVerification(...args) }));

const { POST } = await import("./route");

function req(cookie?: string): Request {
  return new Request("http://localhost/api/auth/phone/send", {
    method: "POST",
    headers: cookie ? { cookie } : {},
  });
}

describe("POST /api/auth/phone/send", () => {
  beforeEach(() => {
    currentUserFromRefresh.mockReset();
    startPhoneVerification.mockReset();
    userFindUnique.mockReset();
    userFindUnique.mockResolvedValue({ role: "USER", deletedAt: null });
  });

  it("401 UNAUTHENTICATED without a valid refresh session", async () => {
    currentUserFromRefresh.mockResolvedValue(null);
    const res = await POST(req());
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ code: "UNAUTHENTICATED" });
    expect(startPhoneVerification).not.toHaveBeenCalled();
  });

  it("propagates NO_PHONE (400) from the service when authenticated but no phone is stored", async () => {
    currentUserFromRefresh.mockResolvedValue({ userId: "u1" });
    startPhoneVerification.mockRejectedValue(new AppError("NO_PHONE", "등록된 전화번호가 없어요.", 400));
    const res = await POST(req(`${REFRESH_COOKIE}=tok`));
    expect(res.status).toBe(400);
  });

  it("succeeds when authenticated and a phone is on file", async () => {
    currentUserFromRefresh.mockResolvedValue({ userId: "u1" });
    startPhoneVerification.mockResolvedValue(undefined);
    const res = await POST(req(`${REFRESH_COOKIE}=tok`));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(startPhoneVerification).toHaveBeenCalledWith(expect.anything(), "u1", expect.anything(), expect.anything());
  });
});
