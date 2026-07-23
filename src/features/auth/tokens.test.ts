/**
 * @vitest-environment node
 */
import { describe, it, expect, vi, afterEach } from "vitest";
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

describe("access token secret validation (env fail-fast)", () => {
  // signAccessToken/verifyAccessToken must read the secret through getEnv(),
  // which zod-validates JWT_ACCESS_SECRET (min 16 chars). This proves that
  // validation path is actually live, and there is no "" fallback key.
  const originalSecret = process.env.JWT_ACCESS_SECRET;

  afterEach(() => {
    vi.unstubAllEnvs();
    if (originalSecret !== undefined) {
      process.env.JWT_ACCESS_SECRET = originalSecret;
    } else {
      delete process.env.JWT_ACCESS_SECRET;
    }
    vi.resetModules();
  });

  it("rejects signing when JWT_ACCESS_SECRET is missing (no empty-key fallback)", async () => {
    vi.resetModules();
    delete process.env.JWT_ACCESS_SECRET;
    const { signAccessToken: signWithoutSecret } = await import("./tokens");
    await expect(signWithoutSecret({ userId: "u1", role: "USER" })).rejects.toThrow();
  });

  it("rejects signing when JWT_ACCESS_SECRET is shorter than 16 chars", async () => {
    vi.resetModules();
    vi.stubEnv("JWT_ACCESS_SECRET", "too-short");
    const { signAccessToken: signWithShortSecret } = await import("./tokens");
    await expect(signWithShortSecret({ userId: "u1", role: "USER" })).rejects.toThrow();
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
