// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import { REFRESH_COOKIE } from "@/features/auth/cookies";
import { AppError } from "@/features/_shared/error";

const currentUserFromRefresh = vi.fn();
const confirmPhoneVerification = vi.fn();

vi.mock("@/features/_shared/prisma", () => ({ prisma: {} }));
vi.mock("@/features/auth/session", () => ({ currentUserFromRefresh: (...args: unknown[]) => currentUserFromRefresh(...args) }));
vi.mock("@/features/location/service", () => ({ confirmPhoneVerification: (...args: unknown[]) => confirmPhoneVerification(...args) }));

const { POST } = await import("./route");

function req(body: unknown, cookie?: string): Request {
  return new Request("http://localhost/api/auth/phone/verify", {
    method: "POST",
    headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body),
  });
}

describe("POST /api/auth/phone/verify", () => {
  beforeEach(() => {
    currentUserFromRefresh.mockReset();
    confirmPhoneVerification.mockReset();
  });

  it("401 UNAUTHENTICATED without a valid refresh session", async () => {
    currentUserFromRefresh.mockResolvedValue(null);
    const res = await POST(req({ code: "123456" }));
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ code: "UNAUTHENTICATED" });
    expect(confirmPhoneVerification).not.toHaveBeenCalled();
  });

  it("400 INVALID_INPUT when code is missing", async () => {
    currentUserFromRefresh.mockResolvedValue({ userId: "u1" });
    const res = await POST(req({}, `${REFRESH_COOKIE}=tok`));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: "INVALID_INPUT" });
    expect(confirmPhoneVerification).not.toHaveBeenCalled();
  });

  it("propagates a generic 401 from the service on a wrong code (no enumeration)", async () => {
    currentUserFromRefresh.mockResolvedValue({ userId: "u1" });
    confirmPhoneVerification.mockRejectedValue(new AppError("PHONE_VERIFY_FAILED", "코드를 다시 확인해 주세요.", 401));
    const res = await POST(req({ code: "000000" }, `${REFRESH_COOKIE}=tok`));
    expect(res.status).toBe(401);
  });

  it("succeeds when authenticated with a correct code", async () => {
    currentUserFromRefresh.mockResolvedValue({ userId: "u1" });
    confirmPhoneVerification.mockResolvedValue(undefined);
    const res = await POST(req({ code: "123456" }, `${REFRESH_COOKIE}=tok`));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(confirmPhoneVerification).toHaveBeenCalledWith(expect.anything(), "u1", "123456", expect.anything());
  });
});
