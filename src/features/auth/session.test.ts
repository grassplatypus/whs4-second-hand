/**
 * @vitest-environment node
 */
import { describe, it, expect, vi } from "vitest";
import { createSession, rotateSession, revokeSession } from "./session";
import { hashRefreshToken, verifyAccessToken } from "./tokens";
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

const noMeta = { ip: null, ua: null };
const future = new Date(Date.now() + 86_400_000);

function rotationDb(session: unknown) {
  return {
    session: {
      findUnique: vi.fn().mockResolvedValue(session),
      create: vi.fn().mockResolvedValue({ id: "s2" }),
      update: vi.fn().mockResolvedValue({}),
      updateMany: vi.fn().mockResolvedValue({ count: 2 }),
    },
    user: { findFirst: vi.fn().mockResolvedValue({ id: "u1", role: "USER", deletedAt: null }) },
    authAuditLog: { create: vi.fn().mockResolvedValue({}) },
  } as unknown as AuthDb;
}

const liveSession = {
  id: "s1",
  userId: "u1",
  familyId: "f1",
  expiresAt: future,
  revokedAt: null,
  user: { id: "u1", role: "USER", deletedAt: null },
};

describe("rotateSession", () => {
  it("issues a new pair and revokes the old session", async () => {
    const db = rotationDb(liveSession);
    const result = await rotateSession(db, "old-token", noMeta);

    expect(await verifyAccessToken(result.accessToken)).toEqual({ userId: "u1", role: "USER" });
    expect(result.refreshToken).not.toBe("old-token");

    const update = (db.session.update as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(update.where).toEqual({ id: "s1" });
    expect(update.data.revokedAt).toBeInstanceOf(Date);
    expect(typeof update.data.replacedById).toBe("string");
  });

  it("keeps the rotation family across rotations", async () => {
    const db = rotationDb(liveSession);
    await rotateSession(db, "old-token", noMeta);
    expect((db.session.create as ReturnType<typeof vi.fn>).mock.calls[0][0].data.familyId).toBe("f1");
  });

  it("looks the session up by hash, not by raw token", async () => {
    const db = rotationDb(liveSession);
    await rotateSession(db, "old-token", noMeta);
    expect((db.session.findUnique as ReturnType<typeof vi.fn>).mock.calls[0][0].where).toEqual({
      tokenHash: hashRefreshToken("old-token"),
    });
  });

  it("kills the whole family when an already-rotated token is replayed", async () => {
    const db = rotationDb({ ...liveSession, revokedAt: new Date() });

    await expect(rotateSession(db, "old-token", noMeta)).rejects.toMatchObject({ code: "AUTH_FAILED", httpStatus: 401 });

    const updateMany = (db.session.updateMany as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(updateMany.where.familyId).toBe("f1");
    expect(updateMany.data.revokedAt).toBeInstanceOf(Date);
    expect((db.authAuditLog.create as ReturnType<typeof vi.fn>).mock.calls[0][0].data.event).toBe("REUSE_DETECTED");
  });

  it("rejects an expired session", async () => {
    const db = rotationDb({ ...liveSession, expiresAt: new Date(Date.now() - 1000) });
    await expect(rotateSession(db, "old-token", noMeta)).rejects.toMatchObject({ code: "AUTH_FAILED" });
  });

  it("rejects an unknown token and a missing cookie", async () => {
    await expect(rotateSession(rotationDb(null), "nope", noMeta)).rejects.toMatchObject({ code: "AUTH_FAILED" });
    await expect(rotateSession(rotationDb(null), null, noMeta)).rejects.toMatchObject({ code: "AUTH_FAILED" });
  });

  it("rejects a soft-deleted user", async () => {
    const db = rotationDb({ ...liveSession, user: { id: "u1", role: "USER", deletedAt: new Date() } });
    await expect(rotateSession(db, "old-token", noMeta)).rejects.toMatchObject({ code: "AUTH_FAILED" });
  });

  it("audits a successful rotation as REFRESH", async () => {
    const db = rotationDb(liveSession);
    await rotateSession(db, "old-token", noMeta);
    expect((db.authAuditLog.create as ReturnType<typeof vi.fn>).mock.calls[0][0].data.event).toBe("REFRESH");
  });
});

describe("revokeSession", () => {
  it("revokes the current session and audits LOGOUT", async () => {
    const db = rotationDb(liveSession);
    await revokeSession(db, "old-token", noMeta);
    expect((db.session.update as ReturnType<typeof vi.fn>).mock.calls[0][0].data.revokedAt).toBeInstanceOf(Date);
    expect((db.authAuditLog.create as ReturnType<typeof vi.fn>).mock.calls[0][0].data.event).toBe("LOGOUT");
  });

  it("is a no-op without a cookie", async () => {
    const db = rotationDb(null);
    await expect(revokeSession(db, null, noMeta)).resolves.toBeUndefined();
    expect(db.session.update as ReturnType<typeof vi.fn>).not.toHaveBeenCalled();
  });
});
