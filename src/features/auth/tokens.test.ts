/**
 * @vitest-environment node
 */
import { describe, it, expect } from "vitest";
import { SignJWT } from "jose";
import {
  ACCESS_TTL_SECONDS,
  REFRESH_TTL_DAYS,
  signAccessToken,
  verifyAccessToken,
  generateRefreshToken,
  hashRefreshToken,
  refreshExpiry,
} from "./tokens";

describe("access token", () => {
  it("round-trips claims", async () => {
    const token = await signAccessToken({ userId: "u1", role: "USER" });
    expect(await verifyAccessToken(token)).toEqual({ userId: "u1", role: "USER" });
  });

  it("returns null for a tampered token", async () => {
    const token = await signAccessToken({ userId: "u1", role: "USER" });
    expect(await verifyAccessToken(token.slice(0, -2) + "xx")).toBeNull();
  });

  it("returns null for garbage", async () => {
    expect(await verifyAccessToken("not-a-jwt")).toBeNull();
  });

  it("returns null for an expired token", async () => {
    const key = new TextEncoder().encode(process.env.JWT_ACCESS_SECRET!);
    const expired = await new SignJWT({ role: "USER" })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject("u1")
      .setExpirationTime(Math.floor(Date.now() / 1000) - 60)
      .sign(key);
    expect(await verifyAccessToken(expired)).toBeNull();
  });

  it("expires in 15 minutes", () => {
    expect(ACCESS_TTL_SECONDS).toBe(900);
  });
});

describe("refresh token", () => {
  it("generates unique tokens", () => {
    expect(generateRefreshToken()).not.toBe(generateRefreshToken());
  });

  it("hashes deterministically and does not contain the token", () => {
    const token = generateRefreshToken();
    expect(hashRefreshToken(token)).toBe(hashRefreshToken(token));
    expect(hashRefreshToken(token)).not.toContain(token);
  });

  it("expires 14 days out", () => {
    const now = new Date("2026-01-01T00:00:00.000Z");
    expect(refreshExpiry(now).toISOString()).toBe("2026-01-15T00:00:00.000Z");
    expect(REFRESH_TTL_DAYS).toBe(14);
  });
});
