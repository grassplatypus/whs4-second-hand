/**
 * @vitest-environment node
 */
import { describe, it, expect } from "vitest";
import { SignJWT } from "jose";
import { AppError } from "@/features/_shared/error";
import { signAccessToken, verifyAccessToken } from "../tokens";
import { signChallenge } from "./challenge";
import {
  STEPUP_COOKIE,
  signStepUp,
  verifyStepUp,
  stepUpCookie,
  clearStepUpCookie,
  readStepUpCookie,
  requireRecentAuth,
} from "./stepup";

describe("step-up token", () => {
  it("round-trips userId", async () => {
    const token = await signStepUp("u1");
    expect(await verifyStepUp(token)).toEqual({ userId: "u1" });
  });

  it("returns null for a tampered token", async () => {
    const token = await signStepUp("u1");
    expect(await verifyStepUp(token.slice(0, -2) + "xx")).toBeNull();
  });

  it("returns null for garbage", async () => {
    expect(await verifyStepUp("not-a-jwt")).toBeNull();
  });

  it("returns null for an expired token", async () => {
    const key = new TextEncoder().encode(process.env.JWT_ACCESS_SECRET!);
    const expired = await new SignJWT({ purpose: "step_up" })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject("u1")
      .setExpirationTime(Math.floor(Date.now() / 1000) - 60)
      .sign(key);
    expect(await verifyStepUp(expired)).toBeNull();
  });

  describe("purpose isolation (mutual)", () => {
    it("verifyAccessToken(stepUpToken) -> null (step-up has no role claim)", async () => {
      const stepUp = await signStepUp("u1");
      expect(await verifyAccessToken(stepUp)).toBeNull();
    });

    it("verifyStepUp(accessToken) -> null (access has no purpose:'step_up')", async () => {
      const access = await signAccessToken({ userId: "u1", role: "USER" });
      expect(await verifyStepUp(access)).toBeNull();
    });

    it("verifyStepUp(challengeToken) -> null (wrong purpose)", async () => {
      const challenge = await signChallenge("u1", "TOTP");
      expect(await verifyStepUp(challenge)).toBeNull();
    });
  });

  describe("step_up cookie", () => {
    it("is HttpOnly, SameSite=Lax, path-wide, 10 minutes", () => {
      const header = stepUpCookie("tok123");
      expect(header).toContain(`${STEPUP_COOKIE}=tok123`);
      expect(header).toContain("HttpOnly");
      expect(header).toContain("SameSite=Lax");
      expect(header).toContain("Path=/");
      expect(header).toContain("Max-Age=600");
    });

    it("clears with an expired empty value", () => {
      const header = clearStepUpCookie();
      expect(header).toContain(`${STEPUP_COOKIE}=;`);
      expect(header).toContain("Max-Age=0");
    });

    it("round-trips through readStepUpCookie", () => {
      const req = new Request("http://localhost/api/settings/2fa/disable", {
        headers: { cookie: `other=1; ${STEPUP_COOKIE}=tok123; another=2` },
      });
      expect(readStepUpCookie(req)).toBe("tok123");
    });

    it("returns null when absent", () => {
      expect(readStepUpCookie(new Request("http://localhost/x"))).toBeNull();
    });
  });

  describe("requireRecentAuth", () => {
    it("returns {userId} for a request with a valid step-up cookie", async () => {
      const token = await signStepUp("u1");
      const req = new Request("http://localhost/api/settings/2fa/disable", {
        headers: { cookie: `${STEPUP_COOKIE}=${token}` },
      });
      expect(await requireRecentAuth(req)).toEqual({ userId: "u1" });
    });

    it("throws AppError STEP_UP_REQUIRED (401) when the cookie is absent", async () => {
      const req = new Request("http://localhost/api/settings/2fa/disable");
      await expect(requireRecentAuth(req)).rejects.toMatchObject({
        code: "STEP_UP_REQUIRED",
        httpStatus: 401,
      });
      await expect(requireRecentAuth(req)).rejects.toBeInstanceOf(AppError);
    });

    it("throws AppError STEP_UP_REQUIRED (401) when the cookie is invalid", async () => {
      const req = new Request("http://localhost/api/settings/2fa/disable", {
        headers: { cookie: `${STEPUP_COOKIE}=garbage` },
      });
      await expect(requireRecentAuth(req)).rejects.toMatchObject({
        code: "STEP_UP_REQUIRED",
        httpStatus: 401,
      });
    });

    it("throws AppError STEP_UP_REQUIRED (401) when an access token is used instead of a step-up token", async () => {
      const access = await signAccessToken({ userId: "u1", role: "USER" });
      const req = new Request("http://localhost/api/settings/2fa/disable", {
        headers: { cookie: `${STEPUP_COOKIE}=${access}` },
      });
      await expect(requireRecentAuth(req)).rejects.toMatchObject({
        code: "STEP_UP_REQUIRED",
        httpStatus: 401,
      });
    });
  });
});
