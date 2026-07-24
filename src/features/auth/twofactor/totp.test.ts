// @vitest-environment node
import { describe, it, expect } from "vitest";
// otplib v13 rewrote its API as functional exports (no `authenticator` singleton,
// which the original brief assumed from v12). `generateSync` produces a live code
// against the same default TOTP params (sha1/6-digit/30s) that totp.ts verifies.
import { generateSync } from "otplib";
import { generateTotpSecret, totpUri, verifyTotp } from "./totp";

describe("totp", () => {
  it("generates a base32 secret", () => {
    const s = generateTotpSecret();
    expect(s).toMatch(/^[A-Z2-7]+$/);
    expect(s.length).toBeGreaterThanOrEqual(16);
  });

  it("builds an otpauth uri with issuer and account", () => {
    const uri = totpUri("JBSWY3DPEHPK3PXP", "user@example.com");
    expect(uri).toMatch(/^otpauth:\/\/totp\//);
    // otplib percent-encodes the label (RFC 3986), so "@" becomes "%40" —
    // assert on the encoded form rather than the raw email.
    expect(uri).toContain(encodeURIComponent("user@example.com"));
    expect(uri).toContain("GrassSecondhand"); // default TWO_FACTOR_ISSUER
  });

  it("verifies a live code and rejects a wrong or malformed one", () => {
    const s = generateTotpSecret();
    expect(verifyTotp(s, generateSync({ secret: s }))).toBe(true);
    expect(verifyTotp(s, "000000")).toBe(false);
    expect(verifyTotp(s, "not-a-code")).toBe(false);
  });
});
