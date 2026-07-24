// @vitest-environment node
import { describe, it, expect, vi } from "vitest";
import {
  setPassword,
  changePassword,
  changeNickname,
  withdraw,
  passwordSchema,
  nicknameSchema,
} from "./account";
import { hashPassword } from "@/features/auth/password";
import { AppError } from "@/features/_shared/error";
import type { WithdrawGuard } from "./withdrawable";
import type { AuthDb } from "@/features/auth/db";

const USER_ID = "u1";
const SESSION_ID = "s1";
const META = { ip: null, ua: null };

function fakeDb(overrides: {
  userFindUnique?: ReturnType<typeof vi.fn>;
  userUpdate?: ReturnType<typeof vi.fn>;
  sessionUpdateMany?: ReturnType<typeof vi.fn>;
  authAuditLogCreate?: ReturnType<typeof vi.fn>;
} = {}) {
  return {
    user: {
      findUnique: overrides.userFindUnique ?? vi.fn().mockResolvedValue({ passwordHash: null }),
      update: overrides.userUpdate ?? vi.fn().mockResolvedValue({}),
    },
    session: {
      updateMany: overrides.sessionUpdateMany ?? vi.fn().mockResolvedValue({ count: 0 }),
    },
    authAuditLog: { create: overrides.authAuditLogCreate ?? vi.fn().mockResolvedValue({}) },
  } as unknown as AuthDb;
}

describe("passwordSchema", () => {
  it("accepts 8-72 chars", () => {
    expect(passwordSchema.parse("a".repeat(8))).toHaveLength(8);
    expect(passwordSchema.parse("a".repeat(72))).toHaveLength(72);
  });
  it("rejects under 8 or over 72", () => {
    expect(() => passwordSchema.parse("a".repeat(7))).toThrow();
    expect(() => passwordSchema.parse("a".repeat(73))).toThrow();
  });
});

describe("nicknameSchema", () => {
  it("trims and accepts 2-20 chars", () => {
    expect(nicknameSchema.parse("  풀숲  ")).toBe("풀숲");
  });
  it("rejects under 2 or over 20", () => {
    expect(() => nicknameSchema.parse("a")).toThrow();
    expect(() => nicknameSchema.parse("a".repeat(21))).toThrow();
  });
});

describe("setPassword", () => {
  it("sets a bcrypt hash for a password-less (OAuth-only) user and logs PASSWORD_SET", async () => {
    const update = vi.fn().mockResolvedValue({});
    const auditCreate = vi.fn().mockResolvedValue({});
    const db = fakeDb({
      userFindUnique: vi.fn().mockResolvedValue({ passwordHash: null }),
      userUpdate: update,
      authAuditLogCreate: auditCreate,
    });

    await setPassword(db, USER_ID, "hunter2hunter2", META);

    const data = update.mock.calls[0][0].data;
    expect(update.mock.calls[0][0].where).toEqual({ id: USER_ID });
    expect(data.passwordHash.startsWith("$2")).toBe(true);
    expect(JSON.stringify(data)).not.toContain("hunter2hunter2");
    expect(auditCreate.mock.calls[0][0].data.event).toBe("PASSWORD_SET");
    expect(auditCreate.mock.calls[0][0].data.userId).toBe(USER_ID);
  });

  it("refuses to overwrite an existing password with a 409, and does not touch the db", async () => {
    const update = vi.fn();
    const auditCreate = vi.fn();
    const db = fakeDb({
      userFindUnique: vi.fn().mockResolvedValue({ passwordHash: await hashPassword("existing-pass") }),
      userUpdate: update,
      authAuditLogCreate: auditCreate,
    });

    await expect(setPassword(db, USER_ID, "brandNewPass1", META)).rejects.toMatchObject({
      code: "PASSWORD_EXISTS",
      httpStatus: 409,
    });
    expect(update).not.toHaveBeenCalled();
    expect(auditCreate).not.toHaveBeenCalled();
  });

  it("rejects an invalid new password (too short) before touching the db", async () => {
    const update = vi.fn();
    const db = fakeDb({ userUpdate: update });
    await expect(setPassword(db, USER_ID, "short", META)).rejects.toMatchObject({ httpStatus: 400 });
    expect(update).not.toHaveBeenCalled();
  });
});

describe("changePassword", () => {
  it("verifies the current password, stores the new hash, revokes OTHER sessions, and logs PASSWORD_CHANGED", async () => {
    const oldHash = await hashPassword("current-pass-1");
    const update = vi.fn().mockResolvedValue({});
    const sessionUpdateMany = vi.fn().mockResolvedValue({ count: 2 });
    const auditCreate = vi.fn().mockResolvedValue({});
    const db = fakeDb({
      userFindUnique: vi.fn().mockResolvedValue({ passwordHash: oldHash }),
      userUpdate: update,
      sessionUpdateMany,
      authAuditLogCreate: auditCreate,
    });

    await changePassword(db, USER_ID, "current-pass-1", "brand-new-pass-1", SESSION_ID, META);

    const data = update.mock.calls[0][0].data;
    expect(data.passwordHash.startsWith("$2")).toBe(true);
    expect(JSON.stringify(data)).not.toContain("brand-new-pass-1");

    const call = sessionUpdateMany.mock.calls[0][0];
    expect(call.where).toEqual({ userId: USER_ID, id: { not: SESSION_ID }, revokedAt: null });
    expect(call.data.revokedAt).toBeInstanceOf(Date);

    expect(auditCreate.mock.calls[0][0].data.event).toBe("PASSWORD_CHANGED");
  });

  it("fails generically (401 AUTH_FAILED) on wrong current password, without changing the hash or revoking sessions", async () => {
    const oldHash = await hashPassword("current-pass-1");
    const update = vi.fn();
    const sessionUpdateMany = vi.fn();
    const db = fakeDb({
      userFindUnique: vi.fn().mockResolvedValue({ passwordHash: oldHash }),
      userUpdate: update,
      sessionUpdateMany,
    });

    await expect(
      changePassword(db, USER_ID, "totally-wrong-pass", "brand-new-pass-1", SESSION_ID, META),
    ).rejects.toMatchObject({ code: "AUTH_FAILED", httpStatus: 401 });
    expect(update).not.toHaveBeenCalled();
    expect(sessionUpdateMany).not.toHaveBeenCalled();
  });

  it("fails generically for a user with no password set (OAuth-only) — same error as wrong password, no distinguishing oracle", async () => {
    const db = fakeDb({ userFindUnique: vi.fn().mockResolvedValue({ passwordHash: null }) });

    await expect(
      changePassword(db, USER_ID, "anything-at-all", "brand-new-pass-1", SESSION_ID, META),
    ).rejects.toMatchObject({ code: "AUTH_FAILED", httpStatus: 401 });
  });

  it("rejects an invalid new password before verifying/touching the db", async () => {
    const findUnique = vi.fn();
    const db = fakeDb({ userFindUnique: findUnique });
    await expect(
      changePassword(db, USER_ID, "current-pass-1", "short", SESSION_ID, META),
    ).rejects.toMatchObject({ httpStatus: 400 });
  });
});

describe("changeNickname", () => {
  it("validates, updates, and logs NICKNAME_CHANGED", async () => {
    const update = vi.fn().mockResolvedValue({});
    const auditCreate = vi.fn().mockResolvedValue({});
    const db = fakeDb({ userUpdate: update, authAuditLogCreate: auditCreate });

    await changeNickname(db, USER_ID, "  새닉네임  ", META);

    expect(update).toHaveBeenCalledWith({ where: { id: USER_ID }, data: { nickname: "새닉네임" } });
    expect(auditCreate.mock.calls[0][0].data.event).toBe("NICKNAME_CHANGED");
  });

  it("maps a P2002 nickname collision to 409 NICKNAME_TAKEN", async () => {
    const update = vi.fn().mockRejectedValue({ code: "P2002", meta: { target: ["nickname"] } });
    const auditCreate = vi.fn();
    const db = fakeDb({ userUpdate: update, authAuditLogCreate: auditCreate });

    await expect(changeNickname(db, USER_ID, "이미있음", META)).rejects.toMatchObject({
      code: "NICKNAME_TAKEN",
      httpStatus: 409,
    });
    expect(auditCreate).not.toHaveBeenCalled();
  });

  it("does not convert an unrelated update error into a 409", async () => {
    const update = vi.fn().mockRejectedValue(new Error("connection reset"));
    const db = fakeDb({ userUpdate: update });
    await expect(changeNickname(db, USER_ID, "닉네임", META)).rejects.toThrow("connection reset");
  });

  it("rejects an invalid nickname (too short) before touching the db", async () => {
    const update = vi.fn();
    const db = fakeDb({ userUpdate: update });
    await expect(changeNickname(db, USER_ID, "a", META)).rejects.toMatchObject({ httpStatus: 400 });
    expect(update).not.toHaveBeenCalled();
  });
});

describe("withdraw", () => {
  it("soft-deletes, revokes ALL sessions, and logs ACCOUNT_WITHDRAWN when the guard passes", async () => {
    const update = vi.fn().mockResolvedValue({});
    const sessionUpdateMany = vi.fn().mockResolvedValue({ count: 3 });
    const auditCreate = vi.fn().mockResolvedValue({});
    const db = fakeDb({ userUpdate: update, sessionUpdateMany, authAuditLogCreate: auditCreate });

    await withdraw(db, USER_ID, META);

    const updateCall = update.mock.calls[0][0];
    expect(updateCall.where).toEqual({ id: USER_ID });
    expect(updateCall.data.deletedAt).toBeInstanceOf(Date);

    const sessionCall = sessionUpdateMany.mock.calls[0][0];
    expect(sessionCall.where).toEqual({ userId: USER_ID, revokedAt: null });
    expect(sessionCall.data.revokedAt).toBeInstanceOf(Date);

    expect(auditCreate.mock.calls[0][0].data.event).toBe("ACCOUNT_WITHDRAWN");
  });

  it("propagates a custom guard's rejection (409) and does NOT set deletedAt or revoke sessions", async () => {
    const update = vi.fn();
    const sessionUpdateMany = vi.fn();
    const db = fakeDb({ userUpdate: update, sessionUpdateMany });
    const blockingGuard: WithdrawGuard = {
      async assert() {
        throw new AppError("WITHDRAW_BLOCKED", "진행 중인 거래가 있어 탈퇴할 수 없어요.", 409);
      },
    };

    await expect(withdraw(db, USER_ID, META, blockingGuard)).rejects.toMatchObject({
      code: "WITHDRAW_BLOCKED",
      httpStatus: 409,
    });
    expect(update).not.toHaveBeenCalled();
    expect(sessionUpdateMany).not.toHaveBeenCalled();
  });

  it("uses the default (no-op) guard when none is passed", async () => {
    const update = vi.fn().mockResolvedValue({});
    const db = fakeDb({ userUpdate: update });
    await expect(withdraw(db, USER_ID, META)).resolves.toBeUndefined();
    expect(update).toHaveBeenCalled();
  });
});
