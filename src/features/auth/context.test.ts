// @vitest-environment node
import { describe, it, expect } from "vitest";
import { getCurrentUser, requireUser } from "./context";
import { signAccessToken } from "./tokens";

async function authed(token: string) {
  return new Request("http://localhost/api/auth/me", { headers: { authorization: `Bearer ${token}` } });
}

describe("getCurrentUser", () => {
  it("resolves claims from a valid bearer token", async () => {
    const token = await signAccessToken({ userId: "u1", role: "USER" });
    expect(await getCurrentUser(await authed(token))).toEqual({ userId: "u1", role: "USER" });
  });

  it("returns null without an Authorization header", async () => {
    expect(await getCurrentUser(new Request("http://localhost/api/auth/me"))).toBeNull();
  });

  it("returns null for a non-Bearer scheme", async () => {
    const req = new Request("http://localhost/api/auth/me", { headers: { authorization: "Basic abc" } });
    expect(await getCurrentUser(req)).toBeNull();
  });

  it("returns null for a tampered token", async () => {
    const token = await signAccessToken({ userId: "u1", role: "USER" });
    expect(await getCurrentUser(await authed(token.slice(0, -2) + "xx"))).toBeNull();
  });
});

describe("requireUser", () => {
  it("returns claims when authenticated", async () => {
    const token = await signAccessToken({ userId: "u1", role: "ADMIN" });
    expect(await requireUser(await authed(token))).toEqual({ userId: "u1", role: "ADMIN" });
  });

  it("throws 401 when not authenticated", async () => {
    await expect(requireUser(new Request("http://localhost/api/auth/me"))).rejects.toMatchObject({
      code: "UNAUTHENTICATED",
      httpStatus: 401,
    });
  });
});
