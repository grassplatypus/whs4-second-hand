/**
 * @vitest-environment node
 */
import { describe, it, expect, vi } from "vitest";
import { createSession } from "./session";
import { hashRefreshToken } from "./tokens";
import type { AuthDb } from "./db";

function fakeDb(create = vi.fn().mockResolvedValue({ id: "s1" })) {
  return { session: { create } } as unknown as AuthDb;
}

describe("createSession", () => {
  it("stores only the token hash, never the token itself", async () => {
    const create = vi.fn().mockResolvedValue({ id: "s1" });
    const { refreshToken } = await createSession(fakeDb(create), "u1");

    const data = create.mock.calls[0][0].data;
    expect(data.tokenHash).toBe(hashRefreshToken(refreshToken));
    expect(JSON.stringify(data)).not.toContain(refreshToken);
    expect(data.userId).toBe("u1");
  });

  it("starts a new rotation family and sets a future expiry", async () => {
    const create = vi.fn().mockResolvedValue({ id: "s1" });
    const { expiresAt } = await createSession(fakeDb(create), "u1");
    const data = create.mock.calls[0][0].data;

    expect(typeof data.familyId).toBe("string");
    expect(data.familyId.length).toBeGreaterThan(10);
    expect(expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it("issues a different token per session", async () => {
    const a = await createSession(fakeDb(), "u1");
    const b = await createSession(fakeDb(), "u1");
    expect(a.refreshToken).not.toBe(b.refreshToken);
  });
});
