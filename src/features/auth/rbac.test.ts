// @vitest-environment node
import { describe, it, expect, vi } from "vitest";
import { assertNotSuspended, assertRole, requireActiveUser, requireActiveBearer, requireAdmin } from "./rbac";
import { signAccessToken } from "./tokens";
import type { AuthDb } from "./db";

function req(cookie?: string, authorization?: string): Request {
  const headers: Record<string, string> = {};
  if (cookie) headers.cookie = cookie;
  if (authorization) headers.authorization = authorization;
  return new Request("http://localhost/api/whatever", { headers });
}

function refreshDb(session: unknown, userRow: unknown) {
  return {
    session: { findUnique: vi.fn().mockResolvedValue(session) },
    user: { findUnique: vi.fn().mockResolvedValue(userRow) },
  } as unknown as AuthDb;
}

const future = new Date(Date.now() + 86_400_000);

describe("assertNotSuspended", () => {
  it("passes an active USER", () => {
    expect(() => assertNotSuspended({ role: "USER", deletedAt: null })).not.toThrow();
  });

  it("blocks a SUSPENDED user with 403 ACCOUNT_SUSPENDED", () => {
    expect(() => assertNotSuspended({ role: "SUSPENDED", deletedAt: null })).toThrowError(
      expect.objectContaining({ code: "ACCOUNT_SUSPENDED", httpStatus: 403 }),
    );
  });

  it("blocks a soft-deleted user with 403 ACCOUNT_GONE", () => {
    expect(() => assertNotSuspended({ role: "USER", deletedAt: new Date() })).toThrowError(
      expect.objectContaining({ code: "ACCOUNT_GONE", httpStatus: 403 }),
    );
  });
});

describe("assertRole", () => {
  it("passes when the role is allowed", () => {
    expect(() => assertRole("ADMIN", ["ADMIN"])).not.toThrow();
  });

  it("throws FORBIDDEN 403 when the role is not allowed", () => {
    expect(() => assertRole("USER", ["ADMIN"])).toThrowError(
      expect.objectContaining({ code: "FORBIDDEN", httpStatus: 403 }),
    );
  });
});

describe("requireActiveUser", () => {
  it("returns {userId, role} for a live session and an active USER", async () => {
    const db = refreshDb(
      { userId: "u1", expiresAt: future, revokedAt: null, user: { deletedAt: null } },
      { role: "USER", deletedAt: null },
    );
    const result = await requireActiveUser(db, req("refresh_token=tok"));
    expect(result).toEqual({ userId: "u1", role: "USER" });
  });

  it("blocks a user whose DB row is SUSPENDED even though the refresh session lookup succeeded (token/session cannot carry a stale role)", async () => {
    const db = refreshDb(
      { userId: "u1", expiresAt: future, revokedAt: null, user: { deletedAt: null } },
      { role: "SUSPENDED", deletedAt: null },
    );
    await expect(requireActiveUser(db, req("refresh_token=tok"))).rejects.toMatchObject({
      code: "ACCOUNT_SUSPENDED",
      httpStatus: 403,
    });
  });

  it("blocks a soft-deleted user (DB fresh)", async () => {
    const db = refreshDb(
      { userId: "u1", expiresAt: future, revokedAt: null, user: { deletedAt: null } },
      { role: "USER", deletedAt: new Date() },
    );
    await expect(requireActiveUser(db, req("refresh_token=tok"))).rejects.toMatchObject({
      code: "ACCOUNT_GONE",
      httpStatus: 403,
    });
  });

  it("throws 401 UNAUTHENTICATED without a refresh cookie", async () => {
    const db = refreshDb(null, null);
    await expect(requireActiveUser(db, req())).rejects.toMatchObject({
      code: "UNAUTHENTICATED",
      httpStatus: 401,
    });
  });

  it("throws 401 UNAUTHENTICATED for an invalid/unknown session", async () => {
    const db = refreshDb(null, null);
    await expect(requireActiveUser(db, req("refresh_token=nope"))).rejects.toMatchObject({
      code: "UNAUTHENTICATED",
      httpStatus: 401,
    });
  });
});

describe("requireActiveBearer", () => {
  it("returns {userId, role} for a valid bearer token and an active USER (DB fresh)", async () => {
    const token = await signAccessToken({ userId: "u1", role: "USER" });
    const db = refreshDb(null, { role: "USER", deletedAt: null });
    const result = await requireActiveBearer(db, req(undefined, `Bearer ${token}`));
    expect(result).toEqual({ userId: "u1", role: "USER" });
  });

  it("blocks a bearer token whose stale role claims USER but the DB row is SUSPENDED", async () => {
    const token = await signAccessToken({ userId: "u1", role: "USER" });
    const db = refreshDb(null, { role: "SUSPENDED", deletedAt: null });
    await expect(requireActiveBearer(db, req(undefined, `Bearer ${token}`))).rejects.toMatchObject({
      code: "ACCOUNT_SUSPENDED",
      httpStatus: 403,
    });
  });

  it("throws 401 UNAUTHENTICATED without an Authorization header", async () => {
    const db = refreshDb(null, null);
    await expect(requireActiveBearer(db, req())).rejects.toMatchObject({
      code: "UNAUTHENTICATED",
      httpStatus: 401,
    });
  });
});

describe("requireAdmin", () => {
  it("resolves {userId} for an ADMIN", async () => {
    const db = refreshDb(
      { userId: "u1", expiresAt: future, revokedAt: null, user: { deletedAt: null } },
      { role: "ADMIN", deletedAt: null },
    );
    const result = await requireAdmin(db, req("refresh_token=tok"));
    expect(result).toEqual({ userId: "u1" });
  });

  it("throws 403 FORBIDDEN for a non-ADMIN USER", async () => {
    const db = refreshDb(
      { userId: "u1", expiresAt: future, revokedAt: null, user: { deletedAt: null } },
      { role: "USER", deletedAt: null },
    );
    await expect(requireAdmin(db, req("refresh_token=tok"))).rejects.toMatchObject({
      code: "FORBIDDEN",
      httpStatus: 403,
    });
  });
});
