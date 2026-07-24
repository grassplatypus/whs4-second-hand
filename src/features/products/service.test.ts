// @vitest-environment node
import { describe, it, expect, vi } from "vitest";
import {
  productInputSchema,
  createProduct,
  getProduct,
  updateProduct,
  deleteProduct,
  assertOwner,
} from "./service";
import { encryptPII } from "@/features/_shared/crypto";
import type { ProductDb } from "./db";

const SELLER_ID = "seller-1";
const OTHER_ID = "other-1";
const PRODUCT_ID = "product-1";

const VALID_INPUT = {
  title: "아이폰 팝니다",
  description: "상태 좋아요",
  price: 100000,
  category: "DIGITAL",
  directPlace: "강남역 3번 출구",
  images: ["img/1.png", "img/2.png"],
};

function fakeDb(overrides: {
  userFindUnique?: ReturnType<typeof vi.fn>;
  productFindUnique?: ReturnType<typeof vi.fn>;
  productCreate?: ReturnType<typeof vi.fn>;
  productUpdate?: ReturnType<typeof vi.fn>;
}) {
  return {
    user: {
      findUnique: overrides.userFindUnique ?? vi.fn().mockResolvedValue(null),
    },
    product: {
      findUnique: overrides.productFindUnique ?? vi.fn().mockResolvedValue(null),
      create: overrides.productCreate ?? vi.fn().mockResolvedValue({ id: PRODUCT_ID }),
      update: overrides.productUpdate ?? vi.fn().mockResolvedValue({}),
    },
    productImage: {},
    $queryRaw: vi.fn(),
    $queryRawUnsafe: vi.fn(),
  } as unknown as ProductDb;
}

describe("productInputSchema", () => {
  it("accepts a valid product input", () => {
    expect(() => productInputSchema.parse(VALID_INPUT)).not.toThrow();
  });

  it("rejects an empty title", () => {
    expect(() => productInputSchema.parse({ ...VALID_INPUT, title: "" })).toThrow();
  });

  it("rejects a title over 40 chars", () => {
    expect(() => productInputSchema.parse({ ...VALID_INPUT, title: "가".repeat(41) })).toThrow();
  });

  it("rejects a description over 2000 chars", () => {
    expect(() => productInputSchema.parse({ ...VALID_INPUT, description: "가".repeat(2001) })).toThrow();
  });

  it("rejects a negative price", () => {
    expect(() => productInputSchema.parse({ ...VALID_INPUT, price: -1 })).toThrow();
  });

  it("rejects a non-integer price", () => {
    expect(() => productInputSchema.parse({ ...VALID_INPUT, price: 100.5 })).toThrow();
  });

  it("rejects an unknown category", () => {
    expect(() => productInputSchema.parse({ ...VALID_INPUT, category: "NOPE" })).toThrow();
  });

  it("allows omitting directPlace and images", () => {
    const { directPlace, images, ...rest } = VALID_INPUT;
    expect(() => productInputSchema.parse(rest)).not.toThrow();
  });
});

describe("createProduct", () => {
  it("throws NO_LOCATION (400) when the seller has no lat/lng set, and never creates a product", async () => {
    const userFindUnique = vi.fn().mockResolvedValue({ lat: null, lng: null, regionCiphertext: null });
    const productCreate = vi.fn();
    const db = fakeDb({ userFindUnique, productCreate });

    await expect(createProduct(db, SELLER_ID, VALID_INPUT)).rejects.toMatchObject({
      code: "NO_LOCATION",
      httpStatus: 400,
    });
    expect(productCreate).not.toHaveBeenCalled();
  });

  it("throws NO_LOCATION when the seller record itself is missing", async () => {
    const userFindUnique = vi.fn().mockResolvedValue(null);
    const db = fakeDb({ userFindUnique });

    await expect(createProduct(db, SELLER_ID, VALID_INPUT)).rejects.toMatchObject({ code: "NO_LOCATION" });
  });

  it("throws NO_LOCATION (400) when the seller has lat set but lng null", async () => {
    const userFindUnique = vi.fn().mockResolvedValue({ lat: 37.5, lng: null, regionCiphertext: null });
    const productCreate = vi.fn();
    const db = fakeDb({ userFindUnique, productCreate });

    await expect(createProduct(db, SELLER_ID, VALID_INPUT)).rejects.toMatchObject({
      code: "NO_LOCATION",
      httpStatus: 400,
    });
    expect(productCreate).not.toHaveBeenCalled();
  });

  it("snapshots the seller's (already-coarse) lat/lng onto the product — never a precise/derived value", async () => {
    const SELLER_LAT = 37.5;
    const SELLER_LNG = 127.03;
    const userFindUnique = vi.fn().mockResolvedValue({
      lat: SELLER_LAT,
      lng: SELLER_LNG,
      regionCiphertext: null,
    });
    const productCreate = vi.fn().mockResolvedValue({ id: PRODUCT_ID });
    const db = fakeDb({ userFindUnique, productCreate });

    const result = await createProduct(db, SELLER_ID, VALID_INPUT);

    expect(result).toEqual({ id: PRODUCT_ID });
    const payload = productCreate.mock.calls[0][0];
    expect(payload.data.lat).toBe(SELLER_LAT);
    expect(payload.data.lng).toBe(SELLER_LNG);
    expect(payload.data.sellerId).toBe(SELLER_ID);
  });

  it("computes titleChoseong from the title and attaches images ordered by array index", async () => {
    const userFindUnique = vi.fn().mockResolvedValue({ lat: 37.5, lng: 127.03, regionCiphertext: null });
    const productCreate = vi.fn().mockResolvedValue({ id: PRODUCT_ID });
    const db = fakeDb({ userFindUnique, productCreate });

    await createProduct(db, SELLER_ID, VALID_INPUT);

    const payload = productCreate.mock.calls[0][0];
    expect(payload.data.titleChoseong).toBe("ㅇㅇㅍ ㅍㄴㄷ");
    expect(payload.data.images.create).toEqual([
      { path: "img/1.png", order: 0 },
      { path: "img/2.png", order: 1 },
    ]);
  });

  it("decrypts the seller's regionCiphertext into a regionLabel snapshot, never storing ciphertext or plaintext-adjacent leaks", async () => {
    const region = "서울특별시 강남구 역삼동";
    const userFindUnique = vi.fn().mockResolvedValue({
      lat: 37.5,
      lng: 127.03,
      regionCiphertext: encryptPII(region),
    });
    const productCreate = vi.fn().mockResolvedValue({ id: PRODUCT_ID });
    const db = fakeDb({ userFindUnique, productCreate });

    await createProduct(db, SELLER_ID, VALID_INPUT);

    const payload = productCreate.mock.calls[0][0];
    expect(payload.data.regionLabel).toBe(region);
  });

  it("rejects invalid input before touching the database", async () => {
    const userFindUnique = vi.fn();
    const db = fakeDb({ userFindUnique });

    await expect(createProduct(db, SELLER_ID, { ...VALID_INPUT, title: "" })).rejects.toThrow();
    expect(userFindUnique).not.toHaveBeenCalled();
  });

  it("rejects invalid input (empty title) as AppError INVALID_INPUT (400), not a raw ZodError", async () => {
    const userFindUnique = vi.fn();
    const db = fakeDb({ userFindUnique });

    await expect(createProduct(db, SELLER_ID, { ...VALID_INPUT, title: "" })).rejects.toMatchObject({
      code: "INVALID_INPUT",
      httpStatus: 400,
    });
    expect(userFindUnique).not.toHaveBeenCalled();
  });

  it("rejects invalid input (negative price) as AppError INVALID_INPUT (400), not a raw ZodError", async () => {
    const userFindUnique = vi.fn();
    const db = fakeDb({ userFindUnique });

    await expect(createProduct(db, SELLER_ID, { ...VALID_INPUT, price: -1 })).rejects.toMatchObject({
      code: "INVALID_INPUT",
      httpStatus: 400,
    });
    expect(userFindUnique).not.toHaveBeenCalled();
  });
});

describe("getProduct", () => {
  function leakySellerRow() {
    // Simulates a careless query result: even if the underlying row/mocked layer carries
    // PII fields, the service must never copy them into the returned detail object.
    return {
      nickname: "판매자닉네임",
      email: "seller@example.com",
      phone: "01099998888",
      emailCiphertext: encryptPII("seller@example.com"),
      lat: 37.9999,
      lng: 127.9999,
    };
  }

  it("returns a public detail with no seller PII — only nickname survives", async () => {
    const productFindUnique = vi.fn().mockResolvedValue({
      id: PRODUCT_ID,
      title: "아이폰 팝니다",
      description: "상태 좋아요",
      price: 100000,
      category: "DIGITAL",
      status: "SELLING",
      lat: 37.5,
      lng: 127.03,
      regionLabel: "강남구 역삼동",
      directPlace: "강남역 3번 출구",
      deletedAt: null,
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      images: [
        { path: "img/2.png", order: 1 },
        { path: "img/1.png", order: 0 },
      ],
      seller: leakySellerRow(),
    });
    const db = fakeDb({ productFindUnique });

    const detail = await getProduct(db, PRODUCT_ID);
    const json = JSON.stringify(detail);

    expect(json).not.toContain("seller@example.com");
    expect(json).not.toContain("01099998888");
    expect((detail as any).seller).toEqual({ nickname: "판매자닉네임" });
    expect(Object.keys((detail as any).seller)).toEqual(["nickname"]);
    expect(detail.title).toBe("아이폰 팝니다");
    expect(detail.lat).toBe(37.5);
    expect(detail.lng).toBe(127.03);
  });

  it("throws NOT_FOUND (404) when the product does not exist", async () => {
    const productFindUnique = vi.fn().mockResolvedValue(null);
    const db = fakeDb({ productFindUnique });

    await expect(getProduct(db, PRODUCT_ID)).rejects.toMatchObject({ code: "NOT_FOUND", httpStatus: 404 });
  });

  it("throws NOT_FOUND (404) when the product is soft-deleted", async () => {
    const productFindUnique = vi.fn().mockResolvedValue({
      id: PRODUCT_ID,
      deletedAt: new Date(),
      seller: { nickname: "x" },
      images: [],
    });
    const db = fakeDb({ productFindUnique });

    await expect(getProduct(db, PRODUCT_ID)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("assertOwner", () => {
  it("throws NOT_FOUND when missing", async () => {
    const productFindUnique = vi.fn().mockResolvedValue(null);
    const db = fakeDb({ productFindUnique });
    await expect(assertOwner(db, PRODUCT_ID, SELLER_ID)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("throws NOT_FOUND when soft-deleted", async () => {
    const productFindUnique = vi.fn().mockResolvedValue({ sellerId: SELLER_ID, deletedAt: new Date() });
    const db = fakeDb({ productFindUnique });
    await expect(assertOwner(db, PRODUCT_ID, SELLER_ID)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("throws FORBIDDEN when the caller is not the owner", async () => {
    const productFindUnique = vi.fn().mockResolvedValue({ sellerId: SELLER_ID, deletedAt: null });
    const db = fakeDb({ productFindUnique });
    await expect(assertOwner(db, PRODUCT_ID, OTHER_ID)).rejects.toMatchObject({
      code: "FORBIDDEN",
      httpStatus: 403,
    });
  });

  it("resolves for the owner of a live product", async () => {
    const productFindUnique = vi.fn().mockResolvedValue({ sellerId: SELLER_ID, deletedAt: null });
    const db = fakeDb({ productFindUnique });
    await expect(assertOwner(db, PRODUCT_ID, SELLER_ID)).resolves.toBeUndefined();
  });
});

describe("updateProduct", () => {
  it("throws FORBIDDEN (403) for a non-owner and performs no mutation", async () => {
    const productFindUnique = vi.fn().mockResolvedValue({ sellerId: SELLER_ID, deletedAt: null });
    const productUpdate = vi.fn();
    const db = fakeDb({ productFindUnique, productUpdate });

    await expect(updateProduct(db, OTHER_ID, PRODUCT_ID, { title: "새 제목" })).rejects.toMatchObject({
      code: "FORBIDDEN",
      httpStatus: 403,
    });
    expect(productUpdate).not.toHaveBeenCalled();
  });

  it("throws NOT_FOUND (404) for a missing/deleted product", async () => {
    const productFindUnique = vi.fn().mockResolvedValue(null);
    const productUpdate = vi.fn();
    const db = fakeDb({ productFindUnique, productUpdate });

    await expect(updateProduct(db, SELLER_ID, PRODUCT_ID, { title: "새 제목" })).rejects.toMatchObject({
      code: "NOT_FOUND",
      httpStatus: 404,
    });
    expect(productUpdate).not.toHaveBeenCalled();
  });

  it("recomputes titleChoseong when the title changes", async () => {
    const productFindUnique = vi.fn().mockResolvedValue({ sellerId: SELLER_ID, deletedAt: null });
    const productUpdate = vi.fn().mockResolvedValue({});
    const db = fakeDb({ productFindUnique, productUpdate });

    await updateProduct(db, SELLER_ID, PRODUCT_ID, { title: "아이폰 팝니다" });

    const payload = productUpdate.mock.calls[0][0];
    expect(payload.where).toEqual({ id: PRODUCT_ID });
    expect(payload.data.title).toBe("아이폰 팝니다");
    expect(payload.data.titleChoseong).toBe("ㅇㅇㅍ ㅍㄴㄷ");
  });

  it("does not touch titleChoseong when the title is not part of the update", async () => {
    const productFindUnique = vi.fn().mockResolvedValue({ sellerId: SELLER_ID, deletedAt: null });
    const productUpdate = vi.fn().mockResolvedValue({});
    const db = fakeDb({ productFindUnique, productUpdate });

    await updateProduct(db, SELLER_ID, PRODUCT_ID, { price: 5000 });

    const payload = productUpdate.mock.calls[0][0];
    expect(payload.data.price).toBe(5000);
    expect(payload.data.titleChoseong).toBeUndefined();
  });

  it("rejects an owner's invalid update input (e.g. empty title) before mutating", async () => {
    const productFindUnique = vi.fn().mockResolvedValue({ sellerId: SELLER_ID, deletedAt: null });
    const productUpdate = vi.fn();
    const db = fakeDb({ productFindUnique, productUpdate });

    await expect(updateProduct(db, SELLER_ID, PRODUCT_ID, { title: "" })).rejects.toThrow();
    expect(productUpdate).not.toHaveBeenCalled();
  });

  it("rejects an owner's invalid update input as AppError INVALID_INPUT (400), not a raw ZodError", async () => {
    const productFindUnique = vi.fn().mockResolvedValue({ sellerId: SELLER_ID, deletedAt: null });
    const productUpdate = vi.fn();
    const db = fakeDb({ productFindUnique, productUpdate });

    await expect(updateProduct(db, SELLER_ID, PRODUCT_ID, { title: "" })).rejects.toMatchObject({
      code: "INVALID_INPUT",
      httpStatus: 400,
    });
    expect(productUpdate).not.toHaveBeenCalled();
  });

  it("rejects an owner's invalid update input (negative price) as AppError INVALID_INPUT (400)", async () => {
    const productFindUnique = vi.fn().mockResolvedValue({ sellerId: SELLER_ID, deletedAt: null });
    const productUpdate = vi.fn();
    const db = fakeDb({ productFindUnique, productUpdate });

    await expect(updateProduct(db, SELLER_ID, PRODUCT_ID, { price: -1 })).rejects.toMatchObject({
      code: "INVALID_INPUT",
      httpStatus: 400,
    });
    expect(productUpdate).not.toHaveBeenCalled();
  });
});

describe("deleteProduct", () => {
  it("throws FORBIDDEN (403) for a non-owner and performs no mutation", async () => {
    const productFindUnique = vi.fn().mockResolvedValue({ sellerId: SELLER_ID, deletedAt: null });
    const productUpdate = vi.fn();
    const db = fakeDb({ productFindUnique, productUpdate });

    await expect(deleteProduct(db, OTHER_ID, PRODUCT_ID)).rejects.toMatchObject({
      code: "FORBIDDEN",
      httpStatus: 403,
    });
    expect(productUpdate).not.toHaveBeenCalled();
  });

  it("throws NOT_FOUND (404) for a missing product", async () => {
    const productFindUnique = vi.fn().mockResolvedValue(null);
    const productUpdate = vi.fn();
    const db = fakeDb({ productFindUnique, productUpdate });

    await expect(deleteProduct(db, SELLER_ID, PRODUCT_ID)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(productUpdate).not.toHaveBeenCalled();
  });

  it("soft-deletes by setting deletedAt for the owner", async () => {
    const productFindUnique = vi.fn().mockResolvedValue({ sellerId: SELLER_ID, deletedAt: null });
    const productUpdate = vi.fn().mockResolvedValue({});
    const db = fakeDb({ productFindUnique, productUpdate });

    await deleteProduct(db, SELLER_ID, PRODUCT_ID);

    expect(productUpdate).toHaveBeenCalledWith({
      where: { id: PRODUCT_ID },
      data: { deletedAt: expect.any(Date) },
    });
  });
});
