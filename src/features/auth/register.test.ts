/**
 * @vitest-environment node
 */
import { describe, it, expect, vi } from "vitest";
import { registerUser, checkAvailability } from "./register";
import { emailIndex } from "@/features/_shared/crypto";
import { AppError } from "@/features/_shared/error";
import type { AuthDb } from "./db";

const input = {
  email: "user@example.com",
  phone: "010-1234-5678",
  nickname: "풀숲",
  password: "hunter2hunter2",
  passwordConfirm: "hunter2hunter2",
  consent: true,
};

const noMeta = { ip: null, ua: null };

function fakeDb(overrides: { findFirst?: unknown; create?: unknown } = {}) {
  return {
    user: {
      findFirst: overrides.findFirst ?? vi.fn().mockResolvedValue(null),
      create: overrides.create ?? vi.fn().mockResolvedValue({ id: "u1" }),
    },
    authAuditLog: { create: vi.fn().mockResolvedValue({}) },
  } as unknown as AuthDb;
}

describe("registerUser", () => {
  it("stores ciphertext + blind index, never the plaintext", async () => {
    const create = vi.fn().mockResolvedValue({ id: "u1" });
    const db = fakeDb({ create });

    const result = await registerUser(db, input, noMeta);

    expect(result).toEqual({ userId: "u1" });
    const data = create.mock.calls[0][0].data;
    expect(data.emailBlindIndex).toBe(emailIndex("user@example.com"));
    expect(JSON.stringify(data)).not.toContain("user@example.com");
    expect(JSON.stringify(data)).not.toContain("01012345678");
    expect(JSON.stringify(data)).not.toContain("hunter2hunter2");
    expect(data.passwordHash.startsWith("$2")).toBe(true);
    expect(data.consentedAt).toBeInstanceOf(Date);
  });

  it("writes a REGISTER audit event", async () => {
    const db = fakeDb();
    await registerUser(db, input, noMeta);
    expect((db.authAuditLog.create as ReturnType<typeof vi.fn>).mock.calls[0][0].data.event).toBe("REGISTER");
  });

  it("rejects a mismatched password confirmation", async () => {
    await expect(registerUser(fakeDb(), { ...input, passwordConfirm: "different-one" }, noMeta)).rejects.toBeInstanceOf(
      AppError,
    );
  });

  it("rejects missing consent", async () => {
    await expect(registerUser(fakeDb(), { ...input, consent: false }, noMeta)).rejects.toBeInstanceOf(AppError);
  });

  it("rejects a duplicate email", async () => {
    const db = fakeDb({ findFirst: vi.fn().mockResolvedValue({ id: "other", nickname: "다른사람" }) });
    await expect(registerUser(db, input, noMeta)).rejects.toMatchObject({ code: "EMAIL_TAKEN" });
  });

  it("rejects a duplicate nickname", async () => {
    const db = fakeDb({ findFirst: vi.fn().mockResolvedValue({ id: "other", nickname: "풀숲" }) });
    await expect(registerUser(db, input, noMeta)).rejects.toMatchObject({ code: "NICKNAME_TAKEN" });
  });

  it("maps a concurrent P2002 nickname collision (create) to 409 NICKNAME_TAKEN", async () => {
    const create = vi.fn().mockRejectedValue({ code: "P2002", meta: { target: ["nickname"] } });
    const db = fakeDb({ create });
    await expect(registerUser(db, input, noMeta)).rejects.toMatchObject({
      code: "NICKNAME_TAKEN",
      httpStatus: 409,
    });
  });

  it("maps a concurrent P2002 email collision (create) to 409 EMAIL_TAKEN", async () => {
    const create = vi.fn().mockRejectedValue({ code: "P2002", meta: { target: ["emailBlindIndex"] } });
    const db = fakeDb({ create });
    await expect(registerUser(db, input, noMeta)).rejects.toMatchObject({
      code: "EMAIL_TAKEN",
      httpStatus: 409,
    });
  });

  it("does not convert an unrelated create error into a 409", async () => {
    const create = vi.fn().mockRejectedValue(new Error("connection reset"));
    const db = fakeDb({ create });
    await expect(registerUser(db, input, noMeta)).rejects.toThrow("connection reset");
  });

  it("does not convert a P2002 whose target names neither unique column", async () => {
    const create = vi.fn().mockRejectedValue({ code: "P2002", meta: { target: ["someOtherColumn"] } });
    const db = fakeDb({ create });
    await expect(registerUser(db, input, noMeta)).rejects.toMatchObject({ code: "P2002" });
  });
});

describe("checkAvailability", () => {
  it("reports a free nickname", async () => {
    const findFirst = vi.fn().mockResolvedValue(null);
    expect(await checkAvailability(fakeDb({ findFirst }), { nickname: "풀숲" })).toEqual({ available: true });
  });

  it("reports a taken email without leaking the account", async () => {
    const findFirst = vi.fn().mockResolvedValue({ id: "u1", nickname: "풀숲" });
    expect(await checkAvailability(fakeDb({ findFirst }), { email: "user@example.com" })).toEqual({ available: false });
  });

  it("looks email up by blind index, not by plaintext", async () => {
    const findFirst = vi.fn().mockResolvedValue(null);
    const db = fakeDb({ findFirst });
    await checkAvailability(db, { email: "user@example.com" });
    expect(JSON.stringify(findFirst.mock.calls[0][0])).not.toContain("user@example.com");
  });

  it("rejects a query with both fields", async () => {
    await expect(checkAvailability(fakeDb(), { nickname: "풀숲", email: "user@example.com" })).rejects.toBeInstanceOf(
      AppError,
    );
  });
});
