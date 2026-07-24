// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

const revokeSession = vi.fn();

vi.mock("@/features/_shared/prisma", () => ({ prisma: {} }));
vi.mock("@/features/auth/session", () => ({ revokeSession: (...args: unknown[]) => revokeSession(...args) }));

const { POST } = await import("./route");

function req(): Request {
  return new Request("http://localhost/api/auth/logout", { method: "POST" });
}

describe("POST /api/auth/logout — cookie cleanup", () => {
  beforeEach(() => {
    revokeSession.mockReset();
    revokeSession.mockResolvedValue(undefined);
  });

  it("clears the refresh, step_up, and 2fa_challenge cookies", async () => {
    const res = await POST(req());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    const setCookies = res.headers.getSetCookie
      ? res.headers.getSetCookie()
      : [res.headers.get("set-cookie") ?? ""];
    const joined = setCookies.join("\n");
    expect(joined).toMatch(/refresh_token=;/);
    expect(joined).toMatch(/step_up=;/);
    expect(joined).toMatch(/2fa_challenge=;/);
    expect((joined.match(/Max-Age=0/g) ?? []).length).toBeGreaterThanOrEqual(3);
  });
});
