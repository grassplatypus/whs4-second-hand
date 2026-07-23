import { describe, it, expect } from "vitest";
import { encryptPII, decryptPII, emailIndex, phoneIndex } from "./crypto";

describe("encryptPII / decryptPII", () => {
  it("round-trips a value", () => {
    expect(decryptPII(encryptPII("user@example.com"))).toBe("user@example.com");
  });

  it("uses a fresh IV per call", () => {
    expect(encryptPII("same")).not.toBe(encryptPII("same"));
  });

  it("never leaks the plaintext into the payload", () => {
    expect(encryptPII("user@example.com")).not.toContain("user@example.com");
  });

  it("rejects a tampered ciphertext (authTag check)", () => {
    const [iv, tag, ct] = encryptPII("user@example.com").split(".");
    const flipped = Buffer.from(ct, "base64");
    flipped[0] ^= 0xff;
    expect(() => decryptPII([iv, tag, flipped.toString("base64")].join("."))).toThrow();
  });

  it("rejects a malformed payload", () => {
    expect(() => decryptPII("nope")).toThrow();
  });
});

describe("blind index", () => {
  it("is deterministic", () => {
    expect(emailIndex("user@example.com")).toBe(emailIndex("user@example.com"));
  });

  it("normalizes email case and surrounding whitespace", () => {
    expect(emailIndex("  USER@Example.com ")).toBe(emailIndex("user@example.com"));
  });

  it("normalizes phone formatting", () => {
    expect(phoneIndex("010-1234-5678")).toBe(phoneIndex("01012345678"));
  });

  it("differs for different inputs", () => {
    expect(emailIndex("a@example.com")).not.toBe(emailIndex("b@example.com"));
  });

  it("does not contain the plaintext", () => {
    expect(emailIndex("user@example.com")).not.toContain("user@example.com");
  });
});
