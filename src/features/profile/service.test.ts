// @vitest-environment node
import { describe, it, expect, vi } from "vitest";
import { getMyProfile, getPublicProfile, updateBio, bioSchema } from "./service";
import { encryptPII } from "@/features/_shared/crypto";
import { AppError } from "@/features/_shared/error";
import type { AuthDb } from "@/features/auth/db";

const USER_ID = "u1";
const EMAIL_PLAINTEXT = "user@example.com";
const PHONE_PLAINTEXT = "01012345678";
const REGION_PLAINTEXT = "서울특별시 강남구 역삼동";

function fakeDb(overrides: {
  userFindUnique?: ReturnType<typeof vi.fn>;
  userUpdate?: ReturnType<typeof vi.fn>;
  authIdentityFindMany?: ReturnType<typeof vi.fn>;
  authAuditLogCreate?: ReturnType<typeof vi.fn>;
}) {
  return {
    user: {
      findUnique: overrides.userFindUnique ?? vi.fn().mockResolvedValue(null),
      update: overrides.userUpdate ?? vi.fn().mockResolvedValue({}),
    },
    authIdentity: {
      findMany: overrides.authIdentityFindMany ?? vi.fn().mockResolvedValue([]),
    },
    authAuditLog: { create: overrides.authAuditLogCreate ?? vi.fn().mockResolvedValue({}) },
  } as unknown as AuthDb;
}

// A full "leaky" row — as if a careless implementation had spread the whole User row
// (plus a joined identities/lat-lng) into the mock. The service must still filter it down.
function fullUserRow(extra: Record<string, unknown> = {}) {
  return {
    id: USER_ID,
    nickname: "풀숲",
    bio: "안녕하세요",
    emailCiphertext: encryptPII(EMAIL_PLAINTEXT),
    phoneCiphertext: encryptPII(PHONE_PLAINTEXT),
    regionCiphertext: encryptPII(REGION_PLAINTEXT),
    phoneVerifiedAt: new Date("2026-01-01T00:00:00Z"),
    twoFactorMethod: "TOTP",
    passwordHash: "$2a$10$abcdefghijklmnopqrstuv",
    lat: 37.5,
    lng: 127.0,
    deletedAt: null,
    createdAt: new Date("2025-01-01T00:00:00Z"),
    identities: [{ provider: "GOOGLE" }],
    ...extra,
  };
}

describe("getPublicProfile", () => {
  it("returns ONLY the public subset — no email, phone, identities, or coordinates anywhere in the JSON", async () => {
    const findUnique = vi.fn().mockResolvedValue(fullUserRow());
    const db = fakeDb({ userFindUnique: findUnique });

    const result = await getPublicProfile(db, "풀숲");

    expect(result).toEqual({
      nickname: "풀숲",
      bio: "안녕하세요",
      region: REGION_PLAINTEXT,
      phoneVerified: true,
      createdAt: new Date("2025-01-01T00:00:00Z"),
    });
    expect(Object.keys(result).sort()).toEqual(["bio", "createdAt", "nickname", "phoneVerified", "region"].sort());
    const json = JSON.stringify(result);
    expect(json).not.toContain(EMAIL_PLAINTEXT);
    expect(json).not.toContain(PHONE_PLAINTEXT);
    expect(json).not.toContain("GOOGLE");
    expect(json).not.toContain("37.5");
    expect(json).not.toContain("127");
    expect(json).not.toContain("emailCiphertext");
    expect(json).not.toContain("phoneCiphertext");
    expect(json).not.toContain("identities");
    expect(json).not.toContain("lat");
    expect(json).not.toContain("lng");
    expect(json).not.toContain("passwordHash");
    expect(json).not.toContain("twoFactorMethod");
  });

  it("throws a 404 AppError when the user does not exist", async () => {
    const db = fakeDb({ userFindUnique: vi.fn().mockResolvedValue(null) });
    await expect(getPublicProfile(db, "없는닉네임")).rejects.toBeInstanceOf(AppError);
    await expect(getPublicProfile(db, "없는닉네임")).rejects.toMatchObject({ httpStatus: 404 });
  });

  it("throws a 404 AppError for a soft-deleted user (does not leak that the nickname once existed)", async () => {
    const db = fakeDb({
      userFindUnique: vi.fn().mockResolvedValue(fullUserRow({ deletedAt: new Date() })),
    });
    await expect(getPublicProfile(db, "풀숲")).rejects.toMatchObject({ code: "NOT_FOUND", httpStatus: 404 });
  });

  it("returns null region when there is no regionCiphertext", async () => {
    const db = fakeDb({
      userFindUnique: vi.fn().mockResolvedValue(fullUserRow({ regionCiphertext: null })),
    });
    const result = await getPublicProfile(db, "풀숲");
    expect(result.region).toBeNull();
  });
});

describe("getMyProfile", () => {
  it("returns the owner's own profile shape with no plaintext email/phone anywhere", async () => {
    const findUnique = vi.fn().mockResolvedValue(fullUserRow());
    const authIdentityFindMany = vi.fn().mockResolvedValue([{ provider: "GOOGLE" }]);
    const db = fakeDb({ userFindUnique: findUnique, authIdentityFindMany });

    const result = await getMyProfile(db, USER_ID);

    expect(result).toEqual({
      nickname: "풀숲",
      bio: "안녕하세요",
      region: REGION_PLAINTEXT,
      phoneVerified: true,
      twoFactorMethod: "TOTP",
      identities: ["GOOGLE"],
      hasPassword: true,
      createdAt: new Date("2025-01-01T00:00:00Z"),
    });
    const json = JSON.stringify(result);
    expect(json).not.toContain(EMAIL_PLAINTEXT);
    expect(json).not.toContain(PHONE_PLAINTEXT);
    expect(json).not.toContain("emailCiphertext");
    expect(json).not.toContain("phoneCiphertext");
    expect(json).not.toContain("passwordHash");
  });

  it("reports hasPassword=false and phoneVerified=false for an OAuth-only, unverified user", async () => {
    const findUnique = vi.fn().mockResolvedValue(
      fullUserRow({ passwordHash: null, phoneVerifiedAt: null, regionCiphertext: null, bio: null }),
    );
    const db = fakeDb({ userFindUnique: findUnique });

    const result = await getMyProfile(db, USER_ID);

    expect(result.hasPassword).toBe(false);
    expect(result.phoneVerified).toBe(false);
    expect(result.region).toBeNull();
    expect(result.bio).toBeNull();
  });

  it("throws a 404 AppError when the user is missing", async () => {
    const db = fakeDb({ userFindUnique: vi.fn().mockResolvedValue(null) });
    await expect(getMyProfile(db, USER_ID)).rejects.toMatchObject({ code: "NOT_FOUND", httpStatus: 404 });
  });

  it("throws a 404 AppError for a soft-deleted user", async () => {
    const db = fakeDb({ userFindUnique: vi.fn().mockResolvedValue(fullUserRow({ deletedAt: new Date() })) });
    await expect(getMyProfile(db, USER_ID)).rejects.toMatchObject({ code: "NOT_FOUND", httpStatus: 404 });
  });
});

describe("bioSchema", () => {
  it("accepts a trimmed bio up to 500 chars", () => {
    expect(bioSchema.parse("  안녕하세요  ")).toBe("안녕하세요");
  });

  it("rejects a bio over 500 chars", () => {
    expect(() => bioSchema.parse("a".repeat(501))).toThrow();
  });

  it("accepts exactly 500 chars", () => {
    expect(bioSchema.parse("a".repeat(500))).toHaveLength(500);
  });
});

const META = { ip: null, ua: null };

describe("updateBio", () => {
  it("validates, stores the trimmed bio, and logs a PROFILE_UPDATED audit event with userId only", async () => {
    const update = vi.fn().mockResolvedValue({});
    const auditCreate = vi.fn().mockResolvedValue({});
    const db = fakeDb({ userUpdate: update, authAuditLogCreate: auditCreate });

    await updateBio(db, USER_ID, "  안녕하세요  ", META);

    expect(update).toHaveBeenCalledWith({ where: { id: USER_ID }, data: { bio: "안녕하세요" } });
    const auditData = auditCreate.mock.calls[0][0].data;
    expect(auditData.event).toBe("PROFILE_UPDATED");
    expect(auditData.userId).toBe(USER_ID);
    expect(Object.keys(auditData).sort()).toEqual(["event", "ip", "ua", "userId"].sort());
  });

  it("rejects a bio over 500 chars with a 400 AppError and never touches the db", async () => {
    const update = vi.fn();
    const db = fakeDb({ userUpdate: update });

    await expect(updateBio(db, USER_ID, "a".repeat(501), META)).rejects.toMatchObject({ httpStatus: 400 });
    expect(update).not.toHaveBeenCalled();
  });
});
