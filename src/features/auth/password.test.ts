/**
 * @vitest-environment node
 */
import { describe, it, expect } from "vitest";
import { hashPassword, verifyPassword } from "./password";

describe("password", () => {
  it("never stores the plaintext", async () => {
    const hash = await hashPassword("hunter2hunter2");
    expect(hash).not.toContain("hunter2hunter2");
    expect(hash.startsWith("$2")).toBe(true);
  });

  it("verifies the correct password", async () => {
    const hash = await hashPassword("hunter2hunter2");
    expect(await verifyPassword("hunter2hunter2", hash)).toBe(true);
  });

  it("rejects a wrong password", async () => {
    const hash = await hashPassword("hunter2hunter2");
    expect(await verifyPassword("wrong-password", hash)).toBe(false);
  });

  it("salts: same password hashes differently", async () => {
    expect(await hashPassword("hunter2hunter2")).not.toBe(await hashPassword("hunter2hunter2"));
  });

  it("dummyVerify always returns false (timing equalizer)", async () => {
    const { dummyVerify } = await import("./password");
    expect(await dummyVerify("anything")).toBe(false);
  });
});
