// @vitest-environment node
import { describe, it, expect, vi } from "vitest";
import { loginOrRegisterWithOAuth, linkIdentity, unlinkIdentity, generateNickname } from "./link";
import { emailIndex } from "@/features/_shared/crypto";
import type { AuthDb } from "../db";

const meta = { ip: null, ua: null };
const info = { providerUserId: "google-u1", email: "google.u1@example.com" };

function baseDb(over: Record<string, unknown> = {}) {
  return {
    authIdentity: {
      findUnique: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ id: "i1" }),
      delete: vi.fn().mockResolvedValue({}),
    },
    user: {
      findFirst: vi.fn().mockResolvedValue(null),
      findUnique: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ id: "u-new" }),
    },
    session: { create: vi.fn().mockResolvedValue({ id: "s1" }) },
    authAuditLog: { create: vi.fn().mockResolvedValue({}) },
    ...over,
  } as unknown as AuthDb;
}

describe("loginOrRegisterWithOAuth", () => {
  it("logs into the existing user when the identity is known", async () => {
    const db = baseDb({
      authIdentity: { findUnique: vi.fn().mockResolvedValue({ userId: "u1", user: { id: "u1", deletedAt: null } }) },
      session: { create: vi.fn().mockResolvedValue({ id: "s1" }) },
      authAuditLog: { create: vi.fn().mockResolvedValue({}) },
    });
    const r = await loginOrRegisterWithOAuth(db, "GOOGLE", info, meta);
    expect(r.userId).toBe("u1");
    expect(r.refreshToken.length).toBeGreaterThan(20);
    expect((db.authAuditLog.create as any).mock.calls[0][0].data.event).toBe("OAUTH_LOGIN");
  });

  it("creates a passwordless user + identity when nothing matches", async () => {
    const create = vi.fn().mockResolvedValue({ id: "u-new" });
    const db = baseDb({
      user: { findFirst: vi.fn().mockResolvedValue(null), findUnique: vi.fn().mockResolvedValue(null), create },
    });
    const r = await loginOrRegisterWithOAuth(db, "GOOGLE", info, meta);
    expect(r.userId).toBe("u-new");
    const data = create.mock.calls[0][0].data;
    expect(data.passwordHash).toBeUndefined();
    expect(JSON.stringify(data)).not.toContain("google.u1@example.com"); // 평문 이메일 없음
    expect(data.emailBlindIndex).toBe(emailIndex(info.email));
    expect(data.identities.create.providerUserId).toBe("google-u1");
    expect((db.authAuditLog.create as any).mock.calls[0][0].data.event).toBe("OAUTH_REGISTER");
  });

  it("refuses to auto-link when the email already exists", async () => {
    const db = baseDb({ user: { findFirst: vi.fn().mockResolvedValue({ id: "other" }), findUnique: vi.fn(), create: vi.fn() } });
    await expect(loginOrRegisterWithOAuth(db, "GOOGLE", info, meta)).rejects.toMatchObject({ code: "OAUTH_EMAIL_EXISTS", httpStatus: 409 });
  });

  it("rejects a soft-deleted user", async () => {
    const db = baseDb({ authIdentity: { findUnique: vi.fn().mockResolvedValue({ userId: "u1", user: { id: "u1", deletedAt: new Date() } }) } });
    await expect(loginOrRegisterWithOAuth(db, "GOOGLE", info, meta)).rejects.toMatchObject({ code: "AUTH_FAILED" });
  });
});

describe("linkIdentity", () => {
  it("links a new identity to the current user", async () => {
    const create = vi.fn().mockResolvedValue({ id: "i1" });
    const db = baseDb({ authIdentity: { findUnique: vi.fn().mockResolvedValue(null), create } });
    await linkIdentity(db, "u1", "KAKAO", { providerUserId: "kakao-x", email: "k@example.com" }, meta);
    expect(create.mock.calls[0][0].data).toMatchObject({ userId: "u1", provider: "KAKAO", providerUserId: "kakao-x" });
  });

  it("is idempotent when the identity is already linked to this user", async () => {
    const create = vi.fn();
    const db = baseDb({ authIdentity: { findUnique: vi.fn().mockResolvedValue({ userId: "u1" }), create } });
    await linkIdentity(db, "u1", "KAKAO", { providerUserId: "kakao-x", email: "k@example.com" }, meta);
    expect(create).not.toHaveBeenCalled();
  });

  it("rejects an identity owned by another user", async () => {
    const db = baseDb({ authIdentity: { findUnique: vi.fn().mockResolvedValue({ userId: "other" }), create: vi.fn() } });
    await expect(linkIdentity(db, "u1", "KAKAO", { providerUserId: "kakao-x", email: "k@example.com" }, meta)).rejects.toMatchObject({ code: "IDENTITY_TAKEN" });
  });
});

describe("unlinkIdentity", () => {
  it("unlinks when other credentials remain", async () => {
    const del = vi.fn().mockResolvedValue({});
    const db = baseDb({
      user: { findUnique: vi.fn().mockResolvedValue({ passwordHash: "$2b$x", identities: [{ id: "i1", provider: "KAKAO" }] }), findFirst: vi.fn(), create: vi.fn() },
      authIdentity: { findUnique: vi.fn(), create: vi.fn(), delete: del },
    });
    await unlinkIdentity(db, "u1", "KAKAO", meta);
    expect(del).toHaveBeenCalledWith({ where: { id: "i1" } });
  });

  it("refuses to unlink the last credential", async () => {
    const db = baseDb({
      user: { findUnique: vi.fn().mockResolvedValue({ passwordHash: null, identities: [{ id: "i1", provider: "KAKAO" }] }), findFirst: vi.fn(), create: vi.fn() },
    });
    await expect(unlinkIdentity(db, "u1", "KAKAO", meta)).rejects.toMatchObject({ code: "LAST_CREDENTIAL", httpStatus: 409 });
  });

  it("404s when the provider is not linked", async () => {
    const db = baseDb({
      user: { findUnique: vi.fn().mockResolvedValue({ passwordHash: "$2b$x", identities: [{ id: "i1", provider: "KAKAO" }] }), findFirst: vi.fn(), create: vi.fn() },
    });
    await expect(unlinkIdentity(db, "u1", "NAVER", meta)).rejects.toMatchObject({ code: "IDENTITY_NOT_FOUND", httpStatus: 404 });
  });
});

describe("generateNickname", () => {
  it("retries until it finds a free nickname", async () => {
    const findUnique = vi.fn().mockResolvedValueOnce({ id: "x" }).mockResolvedValueOnce(null);
    const db = baseDb({ user: { findUnique, findFirst: vi.fn(), create: vi.fn() } });
    const n = await generateNickname(db);
    expect(n).toMatch(/^이웃-\d{4}$/);
    expect(findUnique).toHaveBeenCalledTimes(2);
  });
});
