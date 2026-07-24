/**
 * @vitest-environment node
 */
import { describe, it, expect } from "vitest";
import { SignJWT } from "jose";
import { signAccessToken, verifyAccessToken } from "../tokens";
import { signStepUp } from "./stepup";
import {
  CHALLENGE_COOKIE,
  signChallenge,
  verifyChallenge,
  challengeCookie,
  clearChallengeCookie,
  readChallengeCookie,
} from "./challenge";

describe("challenge token", () => {
  it("round-trips userId and method", async () => {
    const token = await signChallenge("u1", "TOTP");
    expect(await verifyChallenge(token)).toEqual({ userId: "u1", method: "TOTP" });
  });

  it("returns null for a tampered token", async () => {
    const token = await signChallenge("u1", "TOTP");
    expect(await verifyChallenge(token.slice(0, -2) + "xx")).toBeNull();
  });

  it("returns null for garbage", async () => {
    expect(await verifyChallenge("not-a-jwt")).toBeNull();
  });

  it("returns null for an expired token", async () => {
    const key = new TextEncoder().encode(process.env.JWT_ACCESS_SECRET!);
    const expired = await new SignJWT({ purpose: "2fa", method: "TOTP" })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject("u1")
      .setExpirationTime(Math.floor(Date.now() / 1000) - 60)
      .sign(key);
    expect(await verifyChallenge(expired)).toBeNull();
  });

  describe("purpose isolation (mutual)", () => {
    it("verifyAccessToken(challengeToken) -> null (challenge has no role claim)", async () => {
      const challenge = await signChallenge("u1", "TOTP");
      expect(await verifyAccessToken(challenge)).toBeNull();
    });

    it("verifyChallenge(accessToken) -> null (access has no purpose:'2fa')", async () => {
      const access = await signAccessToken({ userId: "u1", role: "USER" });
      expect(await verifyChallenge(access)).toBeNull();
    });

    it("verifyChallenge(stepUpToken) -> null (wrong purpose)", async () => {
      const stepUp = await signStepUp("u1");
      expect(await verifyChallenge(stepUp)).toBeNull();
    });
  });

  describe("2fa_challenge cookie", () => {
    it("is HttpOnly, SameSite=Lax, path-wide, 5 minutes", () => {
      const header = challengeCookie("tok123");
      expect(header).toContain(`${CHALLENGE_COOKIE}=tok123`);
      expect(header).toContain("HttpOnly");
      expect(header).toContain("SameSite=Lax");
      expect(header).toContain("Path=/");
      expect(header).toContain("Max-Age=300");
    });

    it("clears with an expired empty value", () => {
      const header = clearChallengeCookie();
      expect(header).toContain(`${CHALLENGE_COOKIE}=;`);
      expect(header).toContain("Max-Age=0");
    });

    it("round-trips through readChallengeCookie", () => {
      const req = new Request("http://localhost/api/auth/verify-login", {
        headers: { cookie: `other=1; ${CHALLENGE_COOKIE}=tok123; another=2` },
      });
      expect(readChallengeCookie(req)).toBe("tok123");
    });

    it("returns null when absent", () => {
      expect(readChallengeCookie(new Request("http://localhost/x"))).toBeNull();
    });
  });
});
