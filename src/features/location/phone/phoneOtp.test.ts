// @vitest-environment node
import { describe, it, expect, vi } from "vitest";
import bcrypt from "bcryptjs";
import { issuePhoneOtp, verifyPhoneOtp } from "./phoneOtp";
import { MemorySms } from "./sms";
import type { AuthDb } from "@/features/auth/db";

const USER_ID = "u1";
const PHONE_PLAINTEXT = "01012345678";
const PHONE_BLIND_INDEX = "blind-idx-abc";

function fakeDb(overrides: {
  findFirst?: ReturnType<typeof vi.fn>;
  findMany?: ReturnType<typeof vi.fn>;
  updateMany?: ReturnType<typeof vi.fn>;
  create?: ReturnType<typeof vi.fn>;
  update?: ReturnType<typeof vi.fn>;
}) {
  return {
    phoneOtp: {
      findFirst: overrides.findFirst ?? vi.fn().mockResolvedValue(null),
      findMany: overrides.findMany ?? vi.fn().mockResolvedValue([]),
      updateMany: overrides.updateMany ?? vi.fn().mockResolvedValue({ count: 0 }),
      create: overrides.create ?? vi.fn().mockResolvedValue({ id: "otp1" }),
      update: overrides.update ?? vi.fn().mockResolvedValue({ id: "otp1" }),
    },
    authAuditLog: { create: vi.fn().mockResolvedValue({}) },
  } as unknown as AuthDb;
}

describe("issuePhoneOtp", () => {
  it("creates a bcrypt-hashed code (never plaintext) with phoneBlindIndex, and sends the plaintext code via SMS", async () => {
    const create = vi.fn().mockResolvedValue({ id: "otp1" });
    const db = fakeDb({ create });
    const sms = new MemorySms();

    await issuePhoneOtp(db, USER_ID, PHONE_PLAINTEXT, PHONE_BLIND_INDEX, sms);

    expect(sms.sent).toHaveLength(1);
    const sentCode = sms.sent[0]!.code;
    expect(sentCode).toMatch(/^\d{6}$/);

    expect(create).toHaveBeenCalledTimes(1);
    const payload = create.mock.calls[0][0];
    expect(payload.data.userId).toBe(USER_ID);
    expect(payload.data.phoneBlindIndex).toBe(PHONE_BLIND_INDEX);
    expect(payload.data.expiresAt.getTime()).toBeGreaterThan(Date.now());
    expect(payload.data.codeHash).toMatch(/^\$2/);
    // Persisted payload must never contain the plaintext code or plaintext phone anywhere.
    expect(JSON.stringify(payload)).not.toContain(sentCode);
    expect(JSON.stringify(payload)).not.toContain(PHONE_PLAINTEXT);
    await expect(bcrypt.compare(sentCode, payload.data.codeHash)).resolves.toBe(true);
  });

  it("invalidates prior unconsumed codes for the same user before issuing a new one", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const db = fakeDb({ updateMany });
    await issuePhoneOtp(db, USER_ID, PHONE_PLAINTEXT, PHONE_BLIND_INDEX, new MemorySms());

    expect(updateMany).toHaveBeenCalledWith({
      where: { userId: USER_ID, consumedAt: null },
      data: { consumedAt: expect.any(Date) },
    });
  });

  it("rejects a resend within 30s of an active code with OTP_TOO_SOON (429), issuing nothing new", async () => {
    const create = vi.fn();
    const updateMany = vi.fn();
    const findFirst = vi.fn().mockResolvedValue({ createdAt: new Date(Date.now() - 5_000) });
    const db = fakeDb({ findFirst, create, updateMany });

    await expect(
      issuePhoneOtp(db, USER_ID, PHONE_PLAINTEXT, PHONE_BLIND_INDEX, new MemorySms()),
    ).rejects.toMatchObject({
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

    await expect(
      issuePhoneOtp(db, USER_ID, PHONE_PLAINTEXT, PHONE_BLIND_INDEX, new MemorySms()),
    ).resolves.toBeUndefined();
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("audits PHONE_OTP_SENT with userId only — no phone or code in the audit row", async () => {
    const db = fakeDb({});
    const sms = new MemorySms();
    await issuePhoneOtp(db, USER_ID, PHONE_PLAINTEXT, PHONE_BLIND_INDEX, sms);
    const sentCode = sms.sent[0]!.code;
    const auditData = (db.authAuditLog.create as ReturnType<typeof vi.fn>).mock.calls[0][0].data;
    expect(auditData.event).toBe("PHONE_OTP_SENT");
    expect(auditData.userId).toBe(USER_ID);
    expect(JSON.stringify(auditData)).not.toContain(PHONE_PLAINTEXT);
    expect(JSON.stringify(auditData)).not.toContain(sentCode);
  });

  it("defaults the PHONE_OTP_SENT audit's ip/ua to null when no meta is passed", async () => {
    const db = fakeDb({});
    await issuePhoneOtp(db, USER_ID, PHONE_PLAINTEXT, PHONE_BLIND_INDEX, new MemorySms());
    const auditData = (db.authAuditLog.create as ReturnType<typeof vi.fn>).mock.calls[0][0].data;
    expect(auditData.ip).toBeNull();
    expect(auditData.ua).toBeNull();
  });

  it("carries the caller's meta (ip/ua) into the PHONE_OTP_SENT audit row when provided", async () => {
    const db = fakeDb({});
    const meta = { ip: "203.0.113.7", ua: "test-agent/1.0" };
    await issuePhoneOtp(db, USER_ID, PHONE_PLAINTEXT, PHONE_BLIND_INDEX, new MemorySms(), meta);
    const auditData = (db.authAuditLog.create as ReturnType<typeof vi.fn>).mock.calls[0][0].data;
    expect(auditData.ip).toBe("203.0.113.7");
    expect(auditData.ua).toBe("test-agent/1.0");
  });
});

describe("verifyPhoneOtp", () => {
  it("returns true and marks consumedAt for a matching, unexpired, unconsumed code", async () => {
    const codeHash = await bcrypt.hash("123456", 10);
    const findMany = vi.fn().mockResolvedValue([{ id: "otp1", codeHash }]);
    const update = vi.fn().mockResolvedValue({ id: "otp1" });
    const db = fakeDb({ findMany, update });

    await expect(verifyPhoneOtp(db, USER_ID, "123456")).resolves.toBe(true);
    expect(update).toHaveBeenCalledWith({ where: { id: "otp1" }, data: { consumedAt: expect.any(Date) } });
  });

  it("rejects a wrong code and does not consume anything", async () => {
    const codeHash = await bcrypt.hash("123456", 10);
    const findMany = vi.fn().mockResolvedValue([{ id: "otp1", codeHash }]);
    const update = vi.fn();
    const db = fakeDb({ findMany, update });

    await expect(verifyPhoneOtp(db, USER_ID, "999999")).resolves.toBe(false);
    expect(update).not.toHaveBeenCalled();
  });

  it("rejects an expired code (filtered out of the candidate query)", async () => {
    // Expired codes are excluded by the expiresAt > now clause, so the mock
    // returns no candidates — same observable behavior as a real DB.
    const findMany = vi.fn().mockResolvedValue([]);
    const db = fakeDb({ findMany });

    await expect(verifyPhoneOtp(db, USER_ID, "123456")).resolves.toBe(false);
    expect(findMany.mock.calls[0][0].where.expiresAt).toEqual({ gt: expect.any(Date) });
  });

  it("rejects an already-consumed code (filtered out of the candidate query)", async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const db = fakeDb({ findMany });

    await expect(verifyPhoneOtp(db, USER_ID, "123456")).resolves.toBe(false);
    expect(findMany.mock.calls[0][0].where.consumedAt).toBeNull();
  });

  it("never puts the plaintext code into the query", async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const db = fakeDb({ findMany });

    await verifyPhoneOtp(db, USER_ID, "654321");
    expect(JSON.stringify(findMany.mock.calls[0][0])).not.toContain("654321");
  });
});
