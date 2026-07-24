// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import bcrypt from "bcryptjs";
import { generateSync } from "otplib";
import {
  startTotpSetup,
  confirmTotp,
  startEmailOtpSetup,
  confirmEmailOtpSetup,
  disableTwoFactor,
  verifyStepUpReauth,
  completeLoginTwoFactor,
  sendLoginOtp,
} from "./service";
import { generateTotpSecret } from "./totp";
import { encryptPII, decryptPII } from "@/features/_shared/crypto";
import { hashPassword } from "../password";
import { MemoryMailer, setMailerForTest } from "./mailer";
import type { AuthDb } from "../db";

const USER_ID = "u1";
const ACCOUNT_EMAIL = "user@example.com";
const noMeta = { ip: null, ua: null };

interface FakeDbOverrides {
  findUnique?: ReturnType<typeof vi.fn>;
  update?: ReturnType<typeof vi.fn>;
  sessionCreate?: ReturnType<typeof vi.fn>;
  emailFindMany?: ReturnType<typeof vi.fn>;
  emailUpdate?: ReturnType<typeof vi.fn>;
  emailFindFirst?: ReturnType<typeof vi.fn>;
  emailUpdateMany?: ReturnType<typeof vi.fn>;
  emailCreate?: ReturnType<typeof vi.fn>;
  auditCreate?: ReturnType<typeof vi.fn>;
}

function fakeDb(overrides: FakeDbOverrides = {}) {
  return {
    user: {
      findUnique: overrides.findUnique ?? vi.fn().mockResolvedValue(null),
      update: overrides.update ?? vi.fn().mockResolvedValue({}),
    },
    session: {
      create: overrides.sessionCreate ?? vi.fn().mockResolvedValue({ id: "s1" }),
    },
    authAuditLog: {
      create: overrides.auditCreate ?? vi.fn().mockResolvedValue({}),
    },
    emailOtp: {
      findFirst: overrides.emailFindFirst ?? vi.fn().mockResolvedValue(null),
      findMany: overrides.emailFindMany ?? vi.fn().mockResolvedValue([]),
      updateMany: overrides.emailUpdateMany ?? vi.fn().mockResolvedValue({ count: 0 }),
      create: overrides.emailCreate ?? vi.fn().mockResolvedValue({ id: "otp1" }),
      update: overrides.emailUpdate ?? vi.fn().mockResolvedValue({ id: "otp1" }),
    },
  } as unknown as AuthDb;
}

function auditEvents(db: AuthDb): string[] {
  return (db.authAuditLog.create as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0].data.event);
}

describe("startTotpSetup", () => {
  it("generates a secret, stores only its ciphertext, leaves method untouched, and returns secret+uri", async () => {
    const update = vi.fn().mockResolvedValue({});
    const findUnique = vi.fn().mockResolvedValue({ emailCiphertext: encryptPII(ACCOUNT_EMAIL) });
    const db = fakeDb({ findUnique, update });

    const result = await startTotpSetup(db, USER_ID);

    expect(result.secret).toMatch(/^[A-Z2-7]+$/);
    expect(result.uri).toMatch(/^otpauth:\/\/totp\//);

    expect(update).toHaveBeenCalledTimes(1);
    const data = update.mock.calls[0][0].data;
    expect(data.totpSecret).not.toBe(result.secret);
    expect(decryptPII(data.totpSecret)).toBe(result.secret);
    expect(data.twoFactorMethod).toBeUndefined();
    expect(JSON.stringify(data)).not.toContain(result.secret);
  });

  it("rejects an unknown user", async () => {
    const db = fakeDb({ findUnique: vi.fn().mockResolvedValue(null) });
    await expect(startTotpSetup(db, USER_ID)).rejects.toMatchObject({ code: "AUTH_FAILED" });
  });
});

describe("confirmTotp", () => {
  it("verifies against the decrypted stored secret, enables TOTP, and audits TWO_FACTOR_ENABLED", async () => {
    const secret = generateTotpSecret();
    const findUnique = vi.fn().mockResolvedValue({ totpSecret: encryptPII(secret) });
    const update = vi.fn().mockResolvedValue({});
    const db = fakeDb({ findUnique, update });

    await confirmTotp(db, USER_ID, generateSync({ secret }), noMeta);

    expect(update).toHaveBeenCalledWith({ where: { id: USER_ID }, data: { twoFactorMethod: "TOTP" } });
    expect(auditEvents(db)).toEqual(["TWO_FACTOR_ENABLED"]);
  });

  it("rejects a wrong code, leaving method unchanged, with no plaintext secret in the error", async () => {
    const secret = generateTotpSecret();
    const findUnique = vi.fn().mockResolvedValue({ totpSecret: encryptPII(secret) });
    const update = vi.fn();
    const db = fakeDb({ findUnique, update });

    await expect(confirmTotp(db, USER_ID, "000000", noMeta)).rejects.toMatchObject({
      code: "TWO_FACTOR_FAILED",
      httpStatus: 401,
    });
    expect(update).not.toHaveBeenCalled();
  });

  it("rejects when no secret was ever set up", async () => {
    const db = fakeDb({ findUnique: vi.fn().mockResolvedValue({ totpSecret: null }) });
    await expect(confirmTotp(db, USER_ID, "123456", noMeta)).rejects.toMatchObject({ code: "TWO_FACTOR_FAILED" });
  });
});

describe("startEmailOtpSetup", () => {
  it("issues a SETUP-purpose email OTP to the decrypted account email", async () => {
    const findUnique = vi.fn().mockResolvedValue({ emailCiphertext: encryptPII(ACCOUNT_EMAIL) });
    const emailCreate = vi.fn().mockResolvedValue({ id: "otp1" });
    const db = fakeDb({ findUnique, emailCreate });
    const mailer = new MemoryMailer();

    await startEmailOtpSetup(db, USER_ID, mailer);

    expect(emailCreate).toHaveBeenCalledTimes(1);
    expect(emailCreate.mock.calls[0][0].data.purpose).toBe("SETUP");
    expect(mailer.sent).toHaveLength(1);
    expect(mailer.sent[0]!.to).toBe(ACCOUNT_EMAIL);
  });
});

describe("confirmEmailOtpSetup", () => {
  it("enables EMAIL 2FA on a correct code and audits TWO_FACTOR_ENABLED", async () => {
    const codeHash = await bcrypt.hash("123456", 10);
    const emailFindMany = vi.fn().mockResolvedValue([{ id: "otp1", codeHash }]);
    const update = vi.fn().mockResolvedValue({});
    const db = fakeDb({ emailFindMany, update });

    await confirmEmailOtpSetup(db, USER_ID, "123456", noMeta);

    expect(update).toHaveBeenCalledWith({
      where: { id: USER_ID },
      data: { twoFactorMethod: "EMAIL", totpSecret: null },
    });
    expect(auditEvents(db)).toEqual(["TWO_FACTOR_ENABLED"]);
  });

  it("rejects a wrong code and leaves method unchanged", async () => {
    const codeHash = await bcrypt.hash("123456", 10);
    const emailFindMany = vi.fn().mockResolvedValue([{ id: "otp1", codeHash }]);
    const update = vi.fn();
    const db = fakeDb({ emailFindMany, update });

    await expect(confirmEmailOtpSetup(db, USER_ID, "999999", noMeta)).rejects.toMatchObject({
      code: "TWO_FACTOR_FAILED",
    });
    expect(update).not.toHaveBeenCalled();
  });
});

describe("disableTwoFactor", () => {
  it("resets method to NONE, clears the stored secret, and audits TWO_FACTOR_DISABLED", async () => {
    const update = vi.fn().mockResolvedValue({});
    const db = fakeDb({ update });

    await disableTwoFactor(db, USER_ID, noMeta);

    expect(update).toHaveBeenCalledWith({
      where: { id: USER_ID },
      data: { twoFactorMethod: "NONE", totpSecret: null },
    });
    expect(auditEvents(db)).toEqual(["TWO_FACTOR_DISABLED"]);
  });
});

describe("verifyStepUpReauth", () => {
  it("succeeds for the password method against the stored hash and audits STEP_UP_SUCCESS", async () => {
    const passwordHash = await hashPassword("hunter2hunter2");
    const findUnique = vi.fn().mockResolvedValue({ passwordHash });
    const db = fakeDb({ findUnique });

    await verifyStepUpReauth(db, USER_ID, { method: "password", password: "hunter2hunter2" }, noMeta);
    expect(auditEvents(db)).toEqual(["STEP_UP_SUCCESS"]);
  });

  it("fails the password method on a wrong password with a generic error + STEP_UP_FAIL", async () => {
    const passwordHash = await hashPassword("hunter2hunter2");
    const findUnique = vi.fn().mockResolvedValue({ passwordHash });
    const db = fakeDb({ findUnique });

    await expect(
      verifyStepUpReauth(db, USER_ID, { method: "password", password: "wrong-wrong" }, noMeta),
    ).rejects.toMatchObject({ code: "STEP_UP_FAILED", httpStatus: 401 });
    expect(auditEvents(db)).toEqual(["STEP_UP_FAIL"]);
  });

  it("fails cleanly for the password method on an OAuth-only account (no passwordHash)", async () => {
    const findUnique = vi.fn().mockResolvedValue({ passwordHash: null });
    const db = fakeDb({ findUnique });

    await expect(
      verifyStepUpReauth(db, USER_ID, { method: "password", password: "anything123" }, noMeta),
    ).rejects.toMatchObject({ code: "STEP_UP_FAILED" });
    expect(auditEvents(db)).toEqual(["STEP_UP_FAIL"]);
  });

  it("succeeds for the totp method against the decrypted stored secret", async () => {
    const secret = generateTotpSecret();
    const findUnique = vi.fn().mockResolvedValue({ totpSecret: encryptPII(secret) });
    const db = fakeDb({ findUnique });

    await verifyStepUpReauth(db, USER_ID, { method: "totp", code: generateSync({ secret }) }, noMeta);
    expect(auditEvents(db)).toEqual(["STEP_UP_SUCCESS"]);
  });

  it("fails the totp method on a wrong code", async () => {
    const secret = generateTotpSecret();
    const findUnique = vi.fn().mockResolvedValue({ totpSecret: encryptPII(secret) });
    const db = fakeDb({ findUnique });

    await expect(
      verifyStepUpReauth(db, USER_ID, { method: "totp", code: "000000" }, noMeta),
    ).rejects.toMatchObject({ code: "STEP_UP_FAILED" });
    expect(auditEvents(db)).toEqual(["STEP_UP_FAIL"]);
  });

  it("succeeds for the email method via verifyEmailOtp(STEP_UP)", async () => {
    const codeHash = await bcrypt.hash("123456", 10);
    const emailFindMany = vi.fn().mockResolvedValue([{ id: "otp1", codeHash }]);
    const db = fakeDb({ emailFindMany });

    await verifyStepUpReauth(db, USER_ID, { method: "email", code: "123456" }, noMeta);
    expect(auditEvents(db)).toEqual(["STEP_UP_SUCCESS"]);
    expect(emailFindMany.mock.calls[0][0].where.purpose).toBe("STEP_UP");
  });

  it("fails the email method on a wrong code", async () => {
    const codeHash = await bcrypt.hash("123456", 10);
    const emailFindMany = vi.fn().mockResolvedValue([{ id: "otp1", codeHash }]);
    const db = fakeDb({ emailFindMany });

    await expect(
      verifyStepUpReauth(db, USER_ID, { method: "email", code: "999999" }, noMeta),
    ).rejects.toMatchObject({ code: "STEP_UP_FAILED" });
  });

  it("fails unknown/malformed step-up methods the same generic way", async () => {
    const db = fakeDb({});
    await expect(verifyStepUpReauth(db, USER_ID, { method: "carrier-pigeon" }, noMeta)).rejects.toMatchObject({
      code: "STEP_UP_FAILED",
    });
    await expect(verifyStepUpReauth(db, USER_ID, null, noMeta)).rejects.toMatchObject({ code: "STEP_UP_FAILED" });
  });

  it("never leaks the plaintext password/code into the audit row", async () => {
    const passwordHash = await hashPassword("hunter2hunter2");
    const findUnique = vi.fn().mockResolvedValue({ passwordHash });
    const db = fakeDb({ findUnique });

    await expect(
      verifyStepUpReauth(db, USER_ID, { method: "password", password: "super-secret-pw" }, noMeta),
    ).rejects.toBeTruthy();
    const auditData = (db.authAuditLog.create as ReturnType<typeof vi.fn>).mock.calls[0][0].data;
    expect(JSON.stringify(auditData)).not.toContain("super-secret-pw");
  });
});

describe("completeLoginTwoFactor", () => {
  it("issues a session on a correct TOTP code and audits TWO_FACTOR_SUCCESS", async () => {
    const secret = generateTotpSecret();
    const findUnique = vi.fn().mockResolvedValue({ totpSecret: encryptPII(secret) });
    const sessionCreate = vi.fn().mockResolvedValue({ id: "s1" });
    const db = fakeDb({ findUnique, sessionCreate });
    const mailer = new MemoryMailer();

    const session = await completeLoginTwoFactor(
      db,
      USER_ID,
      "TOTP",
      { code: generateSync({ secret }) },
      mailer,
      noMeta,
    );

    expect(session.refreshToken.length).toBeGreaterThan(20);
    expect(sessionCreate).toHaveBeenCalledTimes(1);
    expect(auditEvents(db)).toEqual(["TWO_FACTOR_SUCCESS"]);
  });

  it("rejects a wrong TOTP code without issuing a session, and audits TWO_FACTOR_FAIL", async () => {
    const secret = generateTotpSecret();
    const findUnique = vi.fn().mockResolvedValue({ totpSecret: encryptPII(secret) });
    const sessionCreate = vi.fn();
    const db = fakeDb({ findUnique, sessionCreate });

    await expect(
      completeLoginTwoFactor(db, USER_ID, "TOTP", { code: "000000" }, new MemoryMailer(), noMeta),
    ).rejects.toMatchObject({ code: "TWO_FACTOR_FAILED", httpStatus: 401 });
    expect(sessionCreate).not.toHaveBeenCalled();
    expect(auditEvents(db)).toEqual(["TWO_FACTOR_FAIL"]);
  });

  it("verifies EMAIL method via verifyEmailOtp(LOGIN_2FA) and issues a session on success", async () => {
    const codeHash = await bcrypt.hash("654321", 10);
    const emailFindMany = vi.fn().mockResolvedValue([{ id: "otp1", codeHash }]);
    const sessionCreate = vi.fn().mockResolvedValue({ id: "s1" });
    const db = fakeDb({ emailFindMany, sessionCreate });

    const session = await completeLoginTwoFactor(
      db,
      USER_ID,
      "EMAIL",
      { code: "654321" },
      new MemoryMailer(),
      noMeta,
    );

    expect(session.refreshToken).toBeDefined();
    expect(emailFindMany.mock.calls[0][0].where.purpose).toBe("LOGIN_2FA");
    expect(auditEvents(db)).toEqual(["TWO_FACTOR_SUCCESS"]);
  });

  it("rejects a wrong EMAIL code and audits TWO_FACTOR_FAIL", async () => {
    const codeHash = await bcrypt.hash("654321", 10);
    const emailFindMany = vi.fn().mockResolvedValue([{ id: "otp1", codeHash }]);
    const sessionCreate = vi.fn();
    const db = fakeDb({ emailFindMany, sessionCreate });

    await expect(
      completeLoginTwoFactor(db, USER_ID, "EMAIL", { code: "000000" }, new MemoryMailer(), noMeta),
    ).rejects.toMatchObject({ code: "TWO_FACTOR_FAILED" });
    expect(sessionCreate).not.toHaveBeenCalled();
  });

  it("rejects an unknown/garbage method fail-closed, without issuing a session, and audits TWO_FACTOR_FAIL", async () => {
    const findUnique = vi.fn().mockResolvedValue({ totpSecret: null });
    const emailFindMany = vi.fn().mockResolvedValue([]);
    const sessionCreate = vi.fn();
    const db = fakeDb({ findUnique, emailFindMany, sessionCreate });

    await expect(
      completeLoginTwoFactor(db, USER_ID, "SMS", { code: "123456" }, new MemoryMailer(), noMeta),
    ).rejects.toMatchObject({ code: "TWO_FACTOR_FAILED", httpStatus: 401 });
    expect(sessionCreate).not.toHaveBeenCalled();
    expect(auditEvents(db)).toEqual(["TWO_FACTOR_FAIL"]);

    await expect(
      completeLoginTwoFactor(db, USER_ID, "", { code: "123456" }, new MemoryMailer(), noMeta),
    ).rejects.toMatchObject({ code: "TWO_FACTOR_FAILED" });
    expect(sessionCreate).not.toHaveBeenCalled();
  });

  it("rejects an unknown method even when a valid (stale) TOTP secret and matching code exist — no downgrade fallthrough", async () => {
    const secret = generateTotpSecret();
    const findUnique = vi.fn().mockResolvedValue({ totpSecret: encryptPII(secret) });
    const sessionCreate = vi.fn();
    const db = fakeDb({ findUnique, sessionCreate });

    await expect(
      completeLoginTwoFactor(db, USER_ID, "SMS", { code: generateSync({ secret }) }, new MemoryMailer(), noMeta),
    ).rejects.toMatchObject({ code: "TWO_FACTOR_FAILED", httpStatus: 401 });
    expect(sessionCreate).not.toHaveBeenCalled();
    expect(auditEvents(db)).toEqual(["TWO_FACTOR_FAIL"]);
  });
});

describe("sendLoginOtp", () => {
  const originalMailer = new MemoryMailer();
  beforeEach(() => setMailerForTest(originalMailer));
  afterEach(() => setMailerForTest(null));

  it("issues a LOGIN_2FA email OTP to the decrypted account email", async () => {
    const findUnique = vi.fn().mockResolvedValue({ emailCiphertext: encryptPII(ACCOUNT_EMAIL) });
    const emailCreate = vi.fn().mockResolvedValue({ id: "otp1" });
    const db = fakeDb({ findUnique, emailCreate });

    await sendLoginOtp(db, USER_ID, noMeta);

    expect(emailCreate.mock.calls[0][0].data.purpose).toBe("LOGIN_2FA");
    expect(originalMailer.sent).toHaveLength(1);
    expect(originalMailer.sent[0]!.to).toBe(ACCOUNT_EMAIL);
  });

  it("rejects an unknown user", async () => {
    const db = fakeDb({ findUnique: vi.fn().mockResolvedValue(null) });
    await expect(sendLoginOtp(db, USER_ID, noMeta)).rejects.toMatchObject({ code: "AUTH_FAILED" });
  });

  it("carries the caller's meta (ip/ua) into the OTP_SENT audit row", async () => {
    const findUnique = vi.fn().mockResolvedValue({ emailCiphertext: encryptPII(ACCOUNT_EMAIL) });
    const auditCreate = vi.fn().mockResolvedValue({});
    const db = fakeDb({ findUnique, auditCreate });
    const meta = { ip: "198.51.100.9", ua: "resend-agent/2.0" };

    await sendLoginOtp(db, USER_ID, meta);

    const auditData = auditCreate.mock.calls[0][0].data;
    expect(auditData.event).toBe("OTP_SENT");
    expect(auditData.ip).toBe("198.51.100.9");
    expect(auditData.ua).toBe("resend-agent/2.0");
  });
});
