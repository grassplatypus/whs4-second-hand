/**
 * @vitest-environment node
 */
import { describe, it, expect, vi } from "vitest";
import { loginUser } from "./login";
import { hashPassword } from "./password";
import { verifyAccessToken } from "./tokens";
import { emailIndex } from "@/features/_shared/crypto";
import type { AuthDb } from "./db";

const noMeta = { ip: null, ua: null };
const credentials = { email: "user@example.com", password: "hunter2hunter2" };

async function fakeDb(user: unknown) {
  return {
    user: { findFirst: vi.fn().mockResolvedValue(user) },
    session: { create: vi.fn().mockResolvedValue({ id: "s1" }) },
    authAuditLog: { create: vi.fn().mockResolvedValue({}) },
  } as unknown as AuthDb;
}

async function activeUser() {
  return { id: "u1", role: "USER", passwordHash: await hashPassword("hunter2hunter2"), deletedAt: null };
}

describe("loginUser", () => {
  it("issues an access token carrying userId and role", async () => {
    const db = await fakeDb(await activeUser());
    const result = await loginUser(db, credentials, noMeta);
    expect(await verifyAccessToken(result.accessToken)).toEqual({ userId: "u1", role: "USER" });
    expect(result.expiresIn).toBe(900);
    expect(result.refreshToken.length).toBeGreaterThan(20);
  });

  it("looks the account up by blind index", async () => {
    const db = await fakeDb(await activeUser());
    await loginUser(db, credentials, noMeta);
    const where = (db.user.findFirst as ReturnType<typeof vi.fn>).mock.calls[0][0].where;
    expect(where.emailBlindIndex).toBe(emailIndex("user@example.com"));
    expect(JSON.stringify(where)).not.toContain("user@example.com");
  });

  it("fails identically for a wrong password and an unknown account", async () => {
    // Each loginUser() call is awaited immediately (rather than stored unawaited
    // and asserted on afterward) so the rejection handler attaches before the
    // real bcrypt compare settles — storing both promises first raced Node's
    // unhandled-rejection detection against bcryptjs's ~60ms compare and made
    // the suite intermittently report a false-positive unhandled rejection.
    await expect(
      loginUser(await fakeDb(await activeUser()), { ...credentials, password: "nope-nope-nope" }, noMeta),
    ).rejects.toMatchObject({ code: "AUTH_FAILED", httpStatus: 401 });
    await expect(loginUser(await fakeDb(null), credentials, noMeta)).rejects.toMatchObject({
      code: "AUTH_FAILED",
      httpStatus: 401,
    });
  });

  it("rejects a soft-deleted account", async () => {
    const db = await fakeDb({ ...(await activeUser()), deletedAt: new Date() });
    await expect(loginUser(db, credentials, noMeta)).rejects.toMatchObject({ code: "AUTH_FAILED" });
  });

  it("rejects an OAuth-only account (no local password)", async () => {
    const db = await fakeDb({ id: "u1", role: "USER", passwordHash: null, deletedAt: null });
    await expect(loginUser(db, credentials, noMeta)).rejects.toMatchObject({ code: "AUTH_FAILED" });
  });

  it("audits success as LOGIN and failure as LOGIN_FAIL", async () => {
    const okDb = await fakeDb(await activeUser());
    await loginUser(okDb, credentials, noMeta);
    expect((okDb.authAuditLog.create as ReturnType<typeof vi.fn>).mock.calls[0][0].data.event).toBe("LOGIN");

    const failDb = await fakeDb(null);
    await loginUser(failDb, credentials, noMeta).catch(() => {});
    const failData = (failDb.authAuditLog.create as ReturnType<typeof vi.fn>).mock.calls[0][0].data;
    expect(failData.event).toBe("LOGIN_FAIL");
    expect(JSON.stringify(failData)).not.toContain("user@example.com");
  });
});
