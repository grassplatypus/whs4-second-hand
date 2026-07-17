import { describe, it, expect } from "vitest";
import { verifyTokenStub } from "./auth-stub";

describe("verifyTokenStub", () => {
  it("returns a userId for any non-empty token (stub)", () => {
    expect(verifyTokenStub("anything").userId).not.toBeNull();
  });
  it("returns null userId when token absent", () => {
    expect(verifyTokenStub(undefined).userId).toBeNull();
  });
});
