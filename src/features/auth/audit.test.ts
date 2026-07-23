import { describe, it, expect, vi } from "vitest";
import { AUTH_EVENTS, logAuthEvent, requestMeta } from "./audit";
import type { AuthDb } from "./db";

function fakeDb(create = vi.fn().mockResolvedValue({})) {
  return { authAuditLog: { create } } as unknown as AuthDb;
}

describe("requestMeta", () => {
  it("takes the first x-forwarded-for hop and the user agent", () => {
    const req = new Request("http://localhost/api/auth/login", {
      headers: { "x-forwarded-for": "203.0.113.7, 10.0.0.1", "user-agent": "vitest" },
    });
    expect(requestMeta(req)).toEqual({ ip: "203.0.113.7", ua: "vitest" });
  });

  it("returns nulls when headers are absent", () => {
    expect(requestMeta(new Request("http://localhost/x"))).toEqual({ ip: null, ua: null });
  });

  it("treats whitespace-only x-forwarded-for as null", () => {
    const req = new Request("http://localhost/api/auth/login", {
      headers: { "x-forwarded-for": "   ", "user-agent": "vitest" },
    });
    expect(requestMeta(req)).toEqual({ ip: null, ua: "vitest" });
  });
});

describe("logAuthEvent", () => {
  it("writes the event with userId only (no PII)", async () => {
    const create = vi.fn().mockResolvedValue({});
    await logAuthEvent(fakeDb(create), AUTH_EVENTS.LOGIN, "u1", { ip: "203.0.113.7", ua: "vitest" });
    expect(create).toHaveBeenCalledWith({
      data: { event: "LOGIN", userId: "u1", ip: "203.0.113.7", ua: "vitest" },
    });
  });

  it("allows a null userId (failed login before identification)", async () => {
    const create = vi.fn().mockResolvedValue({});
    await logAuthEvent(fakeDb(create), AUTH_EVENTS.LOGIN_FAIL, null, { ip: null, ua: null });
    expect(create).toHaveBeenCalledWith({ data: { event: "LOGIN_FAIL", userId: null, ip: null, ua: null } });
  });

  it("never breaks the auth flow when the audit write fails", async () => {
    const create = vi.fn().mockRejectedValue(new Error("db down"));
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(logAuthEvent(fakeDb(create), AUTH_EVENTS.LOGIN, "u1", { ip: null, ua: null })).resolves.toBeUndefined();
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      "[AUDIT] 기록 실패",
      expect.objectContaining({
        event: "LOGIN",
        userId: "u1",
        err: expect.any(Error),
      }),
    );
    expect(consoleErrorSpy.mock.calls[0][1]).not.toHaveProperty("email");
    expect(consoleErrorSpy.mock.calls[0][1]).not.toHaveProperty("phone");
    expect(consoleErrorSpy.mock.calls[0][1]).not.toHaveProperty("password");
    consoleErrorSpy.mockRestore();
  });
});
