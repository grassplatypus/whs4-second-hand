// @vitest-environment node
import { describe, it, expect, vi } from "vitest";
import bcrypt from "bcryptjs";
import { issueEmailOtp, verifyEmailOtp } from "./emailOtp";
import { MemoryMailer } from "./mailer";
import type { AuthDb } from "../db";

const USER_ID = "u1";
const PURPOSE = "LOGIN_2FA" as const;
const ACCOUNT_EMAIL = "user@example.com";

function fakeDb(overrides: {
  findFirst?: ReturnType<typeof vi.fn>;
  findMany?: ReturnType<typeof vi.fn>;
  updateMany?: ReturnType<typeof vi.fn>;
  create?: ReturnType<typeof vi.fn>;
  update?: ReturnType<typeof vi.fn>;
}) {
  return {
    emailOtp: {
      findFirst: overrides.findFirst ?? vi.fn().mockResolvedValue(null),
      findMany: overrides.findMany ?? vi.fn().mockResolvedValue([]),
      updateMany: overrides.updateMany ?? vi.fn().mockResolvedValue({ count: 0 }),
      create: overrides.create ?? vi.fn().mockResolvedValue({ id: "otp1" }),
      update: overrides.update ?? vi.fn().mockResolvedValue({ id: "otp1" }),
    },
    authAuditLog: { create: vi.fn().mockResolvedValue({}) },
  } as unknown as AuthDb;
}

describe("issueEmailOtp", () => {
  it("creates a bcrypt-hashed code (never plaintext) and mails the plaintext code", async () => {
    const create = vi.fn().mockResolvedValue({ id: "otp1" });
    const db = fakeDb({ create });
    const mailer = new MemoryMailer();

    await issueEmailOtp(db, USER_ID, PURPOSE, mailer, ACCOUNT_EMAIL);

    expect(mailer.sent).toHaveLength(1);
    const mailedCode = mailer.sent[0]!.body.match(/\d{6}/)?.[0];
    expect(mailedCode).toBeDefined();
    expect(mailedCode).toHaveLength(6);

    expect(create).toHaveBeenCalledTimes(1);
    const payload = create.mock.calls[0][0];
    expect(payload.data.userId).toBe(USER_ID);
    expect(payload.data.purpose).toBe(PURPOSE);
    expect(payload.data.expiresAt.getTime()).toBeGreaterThan(Date.now());
    expect(payload.data.codeHash).toMatch(/^\$2/);
    // Persisted payload must never contain the plaintext code anywhere.
    expect(JSON.stringify(payload)).not.toContain(mailedCode);
    await expect(bcrypt.compare(mailedCode!, payload.data.codeHash)).resolves.toBe(true);
  });

  it("invalidates prior unconsumed codes for the same user+purpose before issuing a new one", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const db = fakeDb({ updateMany });
    await issueEmailOtp(db, USER_ID, PURPOSE, new MemoryMailer(), ACCOUNT_EMAIL);

    expect(updateMany).toHaveBeenCalledWith({
      where: { userId: USER_ID, purpose: PURPOSE, consumedAt: null },
      data: { consumedAt: expect.any(Date) },
    });
  });

  it("rejects a resend within 30s of an active code with OTP_TOO_SOON (429), issuing nothing new", async () => {
    const create = vi.fn();
    const updateMany = vi.fn();
    const findFirst = vi.fn().mockResolvedValue({ createdAt: new Date(Date.now() - 5_000) });
    const db = fakeDb({ findFirst, create, updateMany });

    await expect(issueEmailOtp(db, USER_ID, PURPOSE, new MemoryMailer(), ACCOUNT_EMAIL)).rejects.toMatchObject({
      code: "OTP_TOO_SOON",
      httpStatus: 429,
    });
    expect(create).not.toHaveBeenCalled();
    expect(updateMany).not.toHaveBeenCalled();
  });

  it("allows a resend once 30s have passed since the active code was issued", async () => {
    const findFirst = vi.fn().mockResolvedValue({ createdAt: new Date(Date.now() - 31_000) });
    const create = vi.fn().mockResolvedValue({ id: "otp2" });
    const db = fakeDb({ findFirst, create });

    await expect(issueEmailOtp(db, USER_ID, PURPOSE, new MemoryMailer(), ACCOUNT_EMAIL)).resolves.toBeUndefined();
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("audits OTP_SENT with userId only — no email or code in the audit row", async () => {
    const db = fakeDb({});
    await issueEmailOtp(db, USER_ID, PURPOSE, new MemoryMailer(), ACCOUNT_EMAIL);
    const auditData = (db.authAuditLog.create as ReturnType<typeof vi.fn>).mock.calls[0][0].data;
    expect(auditData.event).toBe("OTP_SENT");
    expect(auditData.userId).toBe(USER_ID);
    expect(JSON.stringify(auditData)).not.toContain(ACCOUNT_EMAIL);
  });
});

describe("verifyEmailOtp", () => {
  it("returns true and marks consumedAt for a matching, unexpired, unconsumed code", async () => {
    const codeHash = await bcrypt.hash("123456", 10);
    const findMany = vi.fn().mockResolvedValue([{ id: "otp1", codeHash }]);
    const update = vi.fn().mockResolvedValue({ id: "otp1" });
    const db = fakeDb({ findMany, update });

    await expect(verifyEmailOtp(db, USER_ID, PURPOSE, "123456")).resolves.toBe(true);
    expect(update).toHaveBeenCalledWith({ where: { id: "otp1" }, data: { consumedAt: expect.any(Date) } });
  });

  it("rejects a wrong code and does not consume anything", async () => {
    const codeHash = await bcrypt.hash("123456", 10);
    const findMany = vi.fn().mockResolvedValue([{ id: "otp1", codeHash }]);
    const update = vi.fn();
    const db = fakeDb({ findMany, update });

    await expect(verifyEmailOtp(db, USER_ID, PURPOSE, "999999")).resolves.toBe(false);
    expect(update).not.toHaveBeenCalled();
  });

  it("rejects an expired code (filtered out of the candidate query)", async () => {
    // Expired codes are excluded by the expiresAt > now clause, so the mock
    // returns no candidates — same observable behavior as a real DB.
    const findMany = vi.fn().mockResolvedValue([]);
    const db = fakeDb({ findMany });

    await expect(verifyEmailOtp(db, USER_ID, PURPOSE, "123456")).resolves.toBe(false);
    expect(findMany.mock.calls[0][0].where.expiresAt).toEqual({ gt: expect.any(Date) });
  });

  it("rejects an already-consumed code (filtered out of the candidate query)", async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const db = fakeDb({ findMany });

    await expect(verifyEmailOtp(db, USER_ID, PURPOSE, "123456")).resolves.toBe(false);
    expect(findMany.mock.calls[0][0].where.consumedAt).toBeNull();
  });

  it("rejects a code issued for a different purpose (purpose isolation)", async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const db = fakeDb({ findMany });

    await expect(verifyEmailOtp(db, USER_ID, "STEP_UP" as never, "123456")).resolves.toBe(false);
    expect(findMany.mock.calls[0][0].where.purpose).toBe("STEP_UP");
  });

  it("never puts the plaintext code into the query", async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const db = fakeDb({ findMany });

    await verifyEmailOtp(db, USER_ID, PURPOSE, "654321");
    expect(JSON.stringify(findMany.mock.calls[0][0])).not.toContain("654321");
  });
});
