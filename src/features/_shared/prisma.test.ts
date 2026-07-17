import { describe, it, expect } from "vitest";
import { prisma } from "./prisma";

describe("prisma singleton", () => {
  it("exposes a client with User model", () => {
    expect(prisma).toBeDefined();
    expect(prisma.user).toBeDefined();
  });
});
