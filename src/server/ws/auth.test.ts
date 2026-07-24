// @vitest-environment node
import { describe, it, expect } from "vitest";
import { signAccessToken } from "@/features/auth/tokens";
import { authenticateSocket } from "./auth";

describe("authenticateSocket", () => {
  it("returns the userId for a valid token", async () => {
    const token = await signAccessToken({ userId: "user-1", role: "USER" });
    expect(await authenticateSocket(token)).toEqual({ userId: "user-1" });
  });

  it("rejects (null) when no token is provided", async () => {
    expect(await authenticateSocket(undefined)).toBeNull();
  });

  it("rejects (null) a garbage token", async () => {
    expect(await authenticateSocket("not-a-jwt")).toBeNull();
  });

  it("rejects (null) a tampered token", async () => {
    const token = await signAccessToken({ userId: "user-1", role: "USER" });
    expect(await authenticateSocket(token.slice(0, -2) + "xx")).toBeNull();
  });
});
