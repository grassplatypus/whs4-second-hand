// @vitest-environment node
import { describe, it, expect, vi } from "vitest";
import { setLocation, startPhoneVerification, confirmPhoneVerification, locationSchema } from "./service";
import { encryptPII } from "@/features/_shared/crypto";
import { MemorySms } from "./phone/sms";
import type { Geocoder, GeoResult } from "./geocoder/geocoder";
import type { AuthDb } from "@/features/auth/db";

const USER_ID = "u1";

function fakeDb(overrides: {
  userUpdate?: ReturnType<typeof vi.fn>;
  userFindUnique?: ReturnType<typeof vi.fn>;
  userFindFirst?: ReturnType<typeof vi.fn>;
  phoneOtpFindMany?: ReturnType<typeof vi.fn>;
  phoneOtpUpdate?: ReturnType<typeof vi.fn>;
  phoneOtpFindFirst?: ReturnType<typeof vi.fn>;
  phoneOtpUpdateMany?: ReturnType<typeof vi.fn>;
  phoneOtpCreate?: ReturnType<typeof vi.fn>;
  authAuditLogCreate?: ReturnType<typeof vi.fn>;
}) {
  return {
    user: {
      update: overrides.userUpdate ?? vi.fn().mockResolvedValue({ id: USER_ID }),
      findUnique: overrides.userFindUnique ?? vi.fn().mockResolvedValue(null),
      findFirst: overrides.userFindFirst ?? vi.fn().mockResolvedValue(null),
    },
    phoneOtp: {
      findMany: overrides.phoneOtpFindMany ?? vi.fn().mockResolvedValue([]),
      update: overrides.phoneOtpUpdate ?? vi.fn().mockResolvedValue({ id: "otp1" }),
      findFirst: overrides.phoneOtpFindFirst ?? vi.fn().mockResolvedValue(null),
      updateMany: overrides.phoneOtpUpdateMany ?? vi.fn().mockResolvedValue({ count: 0 }),
      create: overrides.phoneOtpCreate ?? vi.fn().mockResolvedValue({ id: "otp1" }),
    },
    authAuditLog: { create: overrides.authAuditLogCreate ?? vi.fn().mockResolvedValue({}) },
  } as unknown as AuthDb;
}

function fakeGeocoder(result: GeoResult): Geocoder {
  return { geocode: vi.fn().mockResolvedValue(result) };
}

const REGION_INPUT = { sido: "서울특별시", sigungu: "강남구", dong: "역삼동" };
const META = { ip: null, ua: null };

describe("locationSchema", () => {
  it("accepts trimmed non-empty sido/sigungu/dong", () => {
    expect(locationSchema.parse({ sido: " 서울 ", sigungu: "강남구", dong: "역삼동" })).toEqual({
      sido: "서울",
      sigungu: "강남구",
      dong: "역삼동",
    });
  });

  it("rejects an empty field", () => {
    expect(() => locationSchema.parse({ sido: "", sigungu: "강남구", dong: "역삼동" })).toThrow();
  });

  it("rejects a whitespace-only field", () => {
    expect(() => locationSchema.parse({ sido: "   ", sigungu: "강남구", dong: "역삼동" })).toThrow();
  });
});

describe("setLocation", () => {
  const PRECISE_LAT = 37.123456;
  const PRECISE_LNG = 127.987654;
  const GEO_RESULT: GeoResult = { lat: PRECISE_LAT, lng: PRECISE_LNG, region: "서울특별시 강남구 역삼동" };

  it("stores the COARSENED lat/lng (not the precise geocoded value) and an encrypted region", async () => {
    const update = vi.fn().mockResolvedValue({ id: USER_ID });
    const db = fakeDb({ userUpdate: update });
    const geocoder = fakeGeocoder(GEO_RESULT);

    await setLocation(db, USER_ID, REGION_INPUT, geocoder, META);

    expect(update).toHaveBeenCalledTimes(1);
    const payload = update.mock.calls[0][0];
    expect(payload.where).toEqual({ id: USER_ID });
    expect(payload.data.lat).toBe(37.12);
    expect(payload.data.lng).toBe(127.99);
    // The precise coordinate must never appear anywhere in the persisted payload.
    expect(JSON.stringify(payload)).not.toContain(String(PRECISE_LAT));
    expect(JSON.stringify(payload)).not.toContain(String(PRECISE_LNG));
  });

  it("stores regionCiphertext as ciphertext, never the plaintext region", async () => {
    const update = vi.fn().mockResolvedValue({ id: USER_ID });
    const db = fakeDb({ userUpdate: update });
    const geocoder = fakeGeocoder(GEO_RESULT);

    await setLocation(db, USER_ID, REGION_INPUT, geocoder, META);

    const payload = update.mock.calls[0][0];
    expect(payload.data.regionCiphertext).not.toBe(GEO_RESULT.region);
    expect(JSON.stringify(payload)).not.toContain(GEO_RESULT.region);
    // Ciphertext should decrypt back to the plaintext region.
    const { decryptPII } = await import("@/features/_shared/crypto");
    expect(decryptPII(payload.data.regionCiphertext)).toBe(GEO_RESULT.region);
  });

  it("logs a LOCATION_SET audit event with userId only", async () => {
    const auditCreate = vi.fn().mockResolvedValue({});
    const db = fakeDb({ authAuditLogCreate: auditCreate });
    const geocoder = fakeGeocoder(GEO_RESULT);

    await setLocation(db, USER_ID, REGION_INPUT, geocoder, META);

    expect(auditCreate).toHaveBeenCalledTimes(1);
    const auditData = auditCreate.mock.calls[0][0].data;
    expect(auditData.event).toBe("LOCATION_SET");
    expect(auditData.userId).toBe(USER_ID);
    expect(JSON.stringify(auditData)).not.toContain(String(PRECISE_LAT));
    expect(JSON.stringify(auditData)).not.toContain(GEO_RESULT.region);
  });

  it("returns ONLY the region string — no coordinates in the return value", async () => {
    const db = fakeDb({});
    const geocoder = fakeGeocoder(GEO_RESULT);

    const result = await setLocation(db, USER_ID, REGION_INPUT, geocoder, META);

    expect(result).toEqual({ region: GEO_RESULT.region });
    expect(JSON.stringify(result)).not.toContain(String(PRECISE_LAT));
    expect(JSON.stringify(result)).not.toContain(String(PRECISE_LNG));
  });
});

describe("startPhoneVerification", () => {
  const PHONE_PLAINTEXT = "01012345678";
  const PHONE_BLIND_INDEX = "blind-idx-abc";

  it("decrypts the stored phone and calls issuePhoneOtp with the blind index, sending an SMS", async () => {
    const findUnique = vi.fn().mockResolvedValue({
      phoneCiphertext: encryptPII(PHONE_PLAINTEXT),
      phoneBlindIndex: PHONE_BLIND_INDEX,
    });
    const db = fakeDb({ userFindUnique: findUnique });
    const sms = new MemorySms();

    await startPhoneVerification(db, USER_ID, sms, META);

    expect(sms.sent).toHaveLength(1);
    expect(sms.sent[0]!.code).toMatch(/^\d{6}$/);
    const createCall = (db.phoneOtp.create as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(createCall.data.phoneBlindIndex).toBe(PHONE_BLIND_INDEX);
    expect(createCall.data.userId).toBe(USER_ID);
  });

  it("throws NO_PHONE (400) when the user has no phone stored, sending nothing", async () => {
    const findUnique = vi.fn().mockResolvedValue({ phoneCiphertext: null, phoneBlindIndex: null });
    const db = fakeDb({ userFindUnique: findUnique });
    const sms = new MemorySms();

    await expect(startPhoneVerification(db, USER_ID, sms, META)).rejects.toMatchObject({
      code: "NO_PHONE",
      httpStatus: 400,
    });
    expect(sms.sent).toHaveLength(0);
  });

  it("throws NO_PHONE when the user record itself is missing", async () => {
    const findUnique = vi.fn().mockResolvedValue(null);
    const db = fakeDb({ userFindUnique: findUnique });

    await expect(startPhoneVerification(db, USER_ID, new MemorySms(), META)).rejects.toMatchObject({
      code: "NO_PHONE",
    });
  });
});

describe("confirmPhoneVerification", () => {
  it("on success: sets phoneVerifiedAt and logs PHONE_VERIFIED", async () => {
    const findMany = vi.fn().mockResolvedValue([{ id: "otp1", codeHash: await bcryptHash("123456") }]);
    const userFindUnique = vi.fn().mockResolvedValue({ phoneBlindIndex: "blind-1" });
    const userFindFirst = vi.fn().mockResolvedValue(null); // no other user has this phone verified
    const userUpdate = vi.fn().mockResolvedValue({ id: USER_ID });
    const auditCreate = vi.fn().mockResolvedValue({});
    const db = fakeDb({
      phoneOtpFindMany: findMany,
      userFindUnique,
      userFindFirst,
      userUpdate,
      authAuditLogCreate: auditCreate,
    });

    await confirmPhoneVerification(db, USER_ID, "123456", META);

    expect(userUpdate).toHaveBeenCalledWith({
      where: { id: USER_ID },
      data: { phoneVerifiedAt: expect.any(Date) },
    });
    const auditData = auditCreate.mock.calls.at(-1)![0].data;
    expect(auditData.event).toBe("PHONE_VERIFIED");
    expect(auditData.userId).toBe(USER_ID);
  });

  it("on failure: throws a generic 401 and logs PHONE_VERIFY_FAIL, never updates phoneVerifiedAt", async () => {
    const findMany = vi.fn().mockResolvedValue([]); // no candidates → verifyPhoneOtp returns false
    const userUpdate = vi.fn();
    const auditCreate = vi.fn().mockResolvedValue({});
    const db = fakeDb({ phoneOtpFindMany: findMany, userUpdate, authAuditLogCreate: auditCreate });

    await expect(confirmPhoneVerification(db, USER_ID, "000000", META)).rejects.toMatchObject({
      httpStatus: 401,
    });
    expect(userUpdate).not.toHaveBeenCalled();
    const auditData = auditCreate.mock.calls[0][0].data;
    expect(auditData.event).toBe("PHONE_VERIFY_FAIL");
    expect(auditData.userId).toBe(USER_ID);
    // The wrong code must never leak into the audit row.
    expect(JSON.stringify(auditData)).not.toContain("000000");
  });

  it("rejects with PHONE_TAKEN (409) when another VERIFIED user already holds the same phoneBlindIndex", async () => {
    const findMany = vi.fn().mockResolvedValue([{ id: "otp1", codeHash: await bcryptHash("123456") }]);
    const userFindUnique = vi.fn().mockResolvedValue({ phoneBlindIndex: "blind-shared" });
    const userFindFirst = vi.fn().mockResolvedValue({ id: "other-user" });
    const userUpdate = vi.fn();
    const db = fakeDb({ phoneOtpFindMany: findMany, userFindUnique, userFindFirst, userUpdate });

    await expect(confirmPhoneVerification(db, USER_ID, "123456", META)).rejects.toMatchObject({
      code: "PHONE_TAKEN",
      httpStatus: 409,
    });
    expect(userUpdate).not.toHaveBeenCalled();
    // The dup check must exclude the current user themself.
    expect(userFindFirst.mock.calls[0][0].where.id).toEqual({ not: USER_ID });
    expect(userFindFirst.mock.calls[0][0].where.phoneVerifiedAt).toEqual({ not: null });
  });
});

async function bcryptHash(code: string): Promise<string> {
  const bcrypt = (await import("bcryptjs")).default;
  return bcrypt.hash(code, 10);
}
