// @vitest-environment node
import { describe, it, expect, vi } from "vitest";
import {
  getMyProfile,
  getPublicProfile,
  getPublicProfileWithProducts,
  getReceivedReviews,
  getPurchasedProducts,
  updateBio,
  bioSchema,
} from "./service";
import { encryptPII } from "@/features/_shared/crypto";
import { AppError } from "@/features/_shared/error";

const USER_ID = "u1";
const EMAIL_PLAINTEXT = "user@example.com";
const PHONE_PLAINTEXT = "01012345678";
const REGION_PLAINTEXT = "서울특별시 강남구 역삼동";

function fakeDb(overrides: {
  userFindUnique?: ReturnType<typeof vi.fn>;
  userUpdate?: ReturnType<typeof vi.fn>;
  authIdentityFindMany?: ReturnType<typeof vi.fn>;
  authAuditLogCreate?: ReturnType<typeof vi.fn>;
  productFindMany?: ReturnType<typeof vi.fn>;
  tradeReviewFindMany?: ReturnType<typeof vi.fn>;
  escrowFindMany?: ReturnType<typeof vi.fn>;
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
    product: {
      findMany: overrides.productFindMany ?? vi.fn().mockResolvedValue([]),
    },
    tradeReview: {
      findMany: overrides.tradeReviewFindMany ?? vi.fn().mockResolvedValue([]),
    },
    escrow: {
      findMany: overrides.escrowFindMany ?? vi.fn().mockResolvedValue([]),
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
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
    expect(Object.keys(result).sort()).toEqual(["avatarPath", "bio", "createdAt", "nickname", "phoneVerified", "region"].sort());
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

describe("getPublicProfileWithProducts", () => {
  function productRow(overrides: Record<string, unknown> = {}) {
    return {
      id: "p1",
      title: "낡은 자전거",
      price: 30000,
      category: "SPORTS",
      status: "SELLING",
      regionLabel: "서울특별시 강남구",
      createdAt: new Date("2025-02-01T00:00:00Z"),
      images: [{ path: "img/bike.png" }],
      ...overrides,
    };
  }

  it("splits the seller's non-deleted products into active (SELLING/RESERVED) and sold (SOLD)", async () => {
    const userFindUnique = vi.fn().mockResolvedValue(fullUserRow());
    const productFindMany = vi.fn().mockResolvedValue([
      productRow({ id: "p1", status: "SELLING" }),
      productRow({ id: "p2", status: "RESERVED" }),
      productRow({ id: "p3", status: "SOLD" }),
    ]);
    const db = fakeDb({ userFindUnique, productFindMany });

    const result = await getPublicProfileWithProducts(db, "풀숲");

    expect(result.profile).toEqual({
      nickname: "풀숲",
      bio: "안녕하세요",
      region: REGION_PLAINTEXT,
      phoneVerified: true,
      createdAt: new Date("2025-01-01T00:00:00Z"),
    });
    expect(result.active.map((p) => p.id).sort()).toEqual(["p1", "p2"]);
    expect(result.sold.map((p) => p.id)).toEqual(["p3"]);
    expect(productFindMany.mock.calls[0][0].where).toEqual({ sellerId: USER_ID, deletedAt: null });
  });

  it("maps the first image (by order) to thumbnail, and null when there are no images", async () => {
    const userFindUnique = vi.fn().mockResolvedValue(fullUserRow());
    const productFindMany = vi.fn().mockResolvedValue([
      productRow({ id: "p1", images: [{ path: "img/bike.png" }] }),
      productRow({ id: "p2", images: [] }),
    ]);
    const db = fakeDb({ userFindUnique, productFindMany });

    const result = await getPublicProfileWithProducts(db, "풀숲");

    expect(result.active.find((p) => p.id === "p1")?.thumbnail).toBe("img/bike.png");
    expect(result.active.find((p) => p.id === "p2")?.thumbnail).toBeNull();
  });

  it("never leaks seller PII (email/phone/coordinates) in the product cards or profile", async () => {
    const userFindUnique = vi.fn().mockResolvedValue(fullUserRow());
    const productFindMany = vi.fn().mockResolvedValue([productRow()]);
    const db = fakeDb({ userFindUnique, productFindMany });

    const result = await getPublicProfileWithProducts(db, "풀숲");
    const json = JSON.stringify(result);
    expect(json).not.toContain(EMAIL_PLAINTEXT);
    expect(json).not.toContain(PHONE_PLAINTEXT);
    expect(json).not.toContain("sellerId");
  });

  it("throws a 404 AppError when the user does not exist", async () => {
    const db = fakeDb({ userFindUnique: vi.fn().mockResolvedValue(null) });
    await expect(getPublicProfileWithProducts(db, "없는닉네임")).rejects.toMatchObject({ httpStatus: 404 });
  });

  it("throws a 404 AppError for a soft-deleted user", async () => {
    const db = fakeDb({
      userFindUnique: vi.fn().mockResolvedValue(fullUserRow({ deletedAt: new Date() })),
    });
    await expect(getPublicProfileWithProducts(db, "풀숲")).rejects.toMatchObject({ code: "NOT_FOUND", httpStatus: 404 });
  });
});

/** tradeReview.findMany은 두 번 불린다(전체 rating 집계용, 최신 20건 목록용) — select 모양으로 분기한다. */
function tradeReviewFindManyMock(allRatings: { rating: string }[], items: Record<string, unknown>[]) {
  return vi.fn(async (args: { select?: { author?: unknown } }) => {
    if (args?.select?.author) return items;
    return allRatings;
  });
}

describe("getReceivedReviews", () => {
  it("등급별 카운트·긍정 비율(좋아요 비율)을 집계하고, 최신순 후기 목록을 내려준다", async () => {
    const userFindUnique = vi.fn().mockResolvedValue(fullUserRow());
    const tradeReviewFindMany = tradeReviewFindManyMock(
      [{ rating: "GOOD" }, { rating: "GOOD" }, { rating: "OK" }, { rating: "BAD" }],
      [
        {
          rating: "GOOD",
          comment: "친절해요",
          createdAt: new Date("2026-02-01T00:00:00Z"),
          author: { nickname: "구매왕", avatarPath: null },
        },
      ],
    );
    const db = fakeDb({ userFindUnique, tradeReviewFindMany });

    const result = await getReceivedReviews(db, "풀숲");

    expect(result.summary).toEqual({ counts: { GOOD: 2, OK: 1, BAD: 1 }, positiveRate: 50, total: 4 });
    expect(result.items).toEqual([
      {
        reviewer: { nickname: "구매왕", avatarPath: null },
        rating: "GOOD",
        comment: "친절해요",
        createdAt: new Date("2026-02-01T00:00:00Z"),
      },
    ]);
  });

  it("후기가 없으면 카운트 0, 긍정 비율 0", async () => {
    const userFindUnique = vi.fn().mockResolvedValue(fullUserRow());
    const db = fakeDb({ userFindUnique, tradeReviewFindMany: tradeReviewFindManyMock([], []) });

    const result = await getReceivedReviews(db, "풀숲");
    expect(result.summary).toEqual({ counts: { GOOD: 0, OK: 0, BAD: 0 }, positiveRate: 0, total: 0 });
    expect(result.items).toEqual([]);
  });

  it("작성자는 닉네임·아바타만 노출한다 — 이메일/전화/좌표/식별정보 없음", async () => {
    const userFindUnique = vi.fn().mockResolvedValue(fullUserRow());
    const tradeReviewFindMany = tradeReviewFindManyMock(
      [{ rating: "GOOD" }],
      [
        {
          rating: "GOOD",
          comment: null,
          createdAt: new Date("2026-02-01T00:00:00Z"),
          author: { nickname: "구매왕", avatarPath: "avatars/a.png" },
        },
      ],
    );
    const db = fakeDb({ userFindUnique, tradeReviewFindMany });

    const result = await getReceivedReviews(db, "풀숲");
    const json = JSON.stringify(result);
    expect(json).not.toContain(EMAIL_PLAINTEXT);
    expect(json).not.toContain(PHONE_PLAINTEXT);
    expect(json).not.toContain("authorId");
    expect(json).not.toContain("targetId");
  });

  it("존재하지 않거나 탈퇴한 계정은 404(프로필 조회와 동일)", async () => {
    const db = fakeDb({ userFindUnique: vi.fn().mockResolvedValue(null) });
    await expect(getReceivedReviews(db, "없는닉네임")).rejects.toMatchObject({ code: "NOT_FOUND", httpStatus: 404 });

    const dbDeleted = fakeDb({ userFindUnique: vi.fn().mockResolvedValue(fullUserRow({ deletedAt: new Date() })) });
    await expect(getReceivedReviews(dbDeleted, "풀숲")).rejects.toMatchObject({ code: "NOT_FOUND", httpStatus: 404 });
  });

  it("목록 조회는 대상(targetId)으로 필터하고 최신순 최대 20건만 요청한다", async () => {
    const userFindUnique = vi.fn().mockResolvedValue(fullUserRow());
    const tradeReviewFindMany = tradeReviewFindManyMock([], []);
    const db = fakeDb({ userFindUnique, tradeReviewFindMany });

    await getReceivedReviews(db, "풀숲");

    const itemsCall = tradeReviewFindMany.mock.calls.find((c) => (c[0] as { select?: { author?: unknown } })?.select?.author);
    expect(itemsCall?.[0]).toMatchObject({ where: { targetId: USER_ID }, orderBy: { createdAt: "desc" }, take: 20 });
  });
});

describe("getPurchasedProducts", () => {
  function escrowRow(overrides: Record<string, unknown> = {}) {
    return {
      releasedAt: new Date("2026-03-01T00:00:00Z"),
      product: {
        id: "p1",
        title: "낡은 자전거",
        price: 30000,
        category: "SPORTS",
        status: "SOLD",
        regionLabel: "서울특별시 강남구",
        images: [{ path: "img/bike.png" }],
      },
      ...overrides,
    };
  }

  it("내가 구매자이고 RELEASED된 에스크로의 상품만 최신순으로 반환한다", async () => {
    const escrowFindMany = vi.fn().mockResolvedValue([escrowRow()]);
    const db = fakeDb({ escrowFindMany });

    const result = await getPurchasedProducts(db, USER_ID);

    expect(result).toEqual([
      {
        id: "p1",
        title: "낡은 자전거",
        price: 30000,
        category: "SPORTS",
        status: "SOLD",
        thumbnail: "img/bike.png",
        regionLabel: "서울특별시 강남구",
      },
    ]);
    const call = escrowFindMany.mock.calls[0][0];
    expect(call.where).toMatchObject({ buyerId: USER_ID, status: "RELEASED", product: { deletedAt: null } });
    expect(call.orderBy).toEqual({ releasedAt: "desc" });
  });

  it("이미지가 없으면 thumbnail은 null", async () => {
    const escrowFindMany = vi.fn().mockResolvedValue([escrowRow({ product: { ...escrowRow().product, images: [] } })]);
    const db = fakeDb({ escrowFindMany });

    const result = await getPurchasedProducts(db, USER_ID);
    expect(result[0].thumbnail).toBeNull();
  });

  it("아무것도 구매하지 않았으면 빈 배열", async () => {
    const db = fakeDb({ escrowFindMany: vi.fn().mockResolvedValue([]) });
    const result = await getPurchasedProducts(db, USER_ID);
    expect(result).toEqual([]);
  });

  it("소프트 삭제된 상품은 where 조건에서 제외 요청한다(product.deletedAt: null)", async () => {
    const escrowFindMany = vi.fn().mockResolvedValue([]);
    const db = fakeDb({ escrowFindMany });
    await getPurchasedProducts(db, USER_ID);
    expect(escrowFindMany.mock.calls[0][0].where.product).toEqual({ deletedAt: null });
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
