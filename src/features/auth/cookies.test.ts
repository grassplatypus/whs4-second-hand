/**
 * @vitest-environment node
 */
import { describe, it, expect } from "vitest";
import { REFRESH_COOKIE, refreshCookie, clearRefreshCookie, readRefreshCookie } from "./cookies";

describe("refreshCookie", () => {
  it("is HttpOnly, SameSite=Lax and path-wide", () => {
    const header = refreshCookie("tok123", new Date("2026-08-01T00:00:00.000Z"));
    expect(header).toContain(`${REFRESH_COOKIE}=tok123`);
    expect(header).toContain("HttpOnly");
    expect(header).toContain("SameSite=Lax");
    expect(header).toContain("Path=/");
    expect(header).toContain("Expires=");
  });

  it("clears with an expired empty value", () => {
    const header = clearRefreshCookie();
    expect(header).toContain(`${REFRESH_COOKIE}=;`);
    expect(header).toContain("Max-Age=0");
  });
});

describe("readRefreshCookie", () => {
  it("extracts the token from a Cookie header", () => {
    const req = new Request("http://localhost/api/auth/refresh", {
      headers: { cookie: `other=1; ${REFRESH_COOKIE}=tok123; another=2` },
    });
    expect(readRefreshCookie(req)).toBe("tok123");
  });

  it("returns null when absent", () => {
    expect(readRefreshCookie(new Request("http://localhost/x"))).toBeNull();
  });
});
