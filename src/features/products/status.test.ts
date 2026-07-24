// @vitest-environment node
import { describe, it, expect, vi } from "vitest";
import { changeStatus, TRANSITIONS } from "./status";
import { AppError } from "@/features/_shared/error";
import type { ProductDb } from "./db";
import type { ProductStatus } from "@prisma/client";

const SELLER_ID = "seller-1";
const OTHER_ID = "other-1";
const PRODUCT_ID = "product-1";

function fakeDb(overrides: {
  productFindFirst?: ReturnType<typeof vi.fn>;
  productUpdate?: ReturnType<typeof vi.fn>;
} = {}) {
  return {
    product: {
      findFirst: overrides.productFindFirst ?? vi.fn().mockResolvedValue(null),
      update: overrides.productUpdate ?? vi.fn().mockResolvedValue({}),
    },
    user: {},
    productImage: {},
    $queryRaw: vi.fn(),
    $queryRawUnsafe: vi.fn(),
  } as unknown as ProductDb;
}

describe("TRANSITIONS", () => {
  it("defines correct transitions for SELLING", () => {
    expect(TRANSITIONS.SELLING).toEqual(["RESERVED", "SOLD"]);
  });

  it("defines correct transitions for RESERVED", () => {
    expect(TRANSITIONS.RESERVED).toEqual(["SELLING", "SOLD"]);
  });

  it("defines correct transitions for SOLD (terminal)", () => {
    expect(TRANSITIONS.SOLD).toEqual([]);
  });
});

describe("changeStatus - Valid Transitions", () => {
  it("allows SELLING → RESERVED transition", async () => {
    const productFindFirst = vi.fn().mockResolvedValue({ sellerId: SELLER_ID, status: "SELLING" });
    const productUpdate = vi.fn().mockResolvedValue({});
    const db = fakeDb({ productFindFirst, productUpdate });

    await changeStatus(db, SELLER_ID, PRODUCT_ID, "RESERVED");

    expect(productFindFirst).toHaveBeenCalledWith({
      where: { id: PRODUCT_ID, deletedAt: null },
      select: { sellerId: true, status: true },
    });
    expect(productUpdate).toHaveBeenCalledWith({
      where: { id: PRODUCT_ID },
      data: { status: "RESERVED" },
    });
  });

  it("allows SELLING → SOLD transition", async () => {
    const productFindFirst = vi.fn().mockResolvedValue({ sellerId: SELLER_ID, status: "SELLING" });
    const productUpdate = vi.fn().mockResolvedValue({});
    const db = fakeDb({ productFindFirst, productUpdate });

    await changeStatus(db, SELLER_ID, PRODUCT_ID, "SOLD");

    expect(productUpdate).toHaveBeenCalledWith({
      where: { id: PRODUCT_ID },
      data: { status: "SOLD" },
    });
  });

  it("allows RESERVED → SELLING transition", async () => {
    const productFindFirst = vi.fn().mockResolvedValue({ sellerId: SELLER_ID, status: "RESERVED" });
    const productUpdate = vi.fn().mockResolvedValue({});
    const db = fakeDb({ productFindFirst, productUpdate });

    await changeStatus(db, SELLER_ID, PRODUCT_ID, "SELLING");

    expect(productUpdate).toHaveBeenCalledWith({
      where: { id: PRODUCT_ID },
      data: { status: "SELLING" },
    });
  });

  it("allows RESERVED → SOLD transition", async () => {
    const productFindFirst = vi.fn().mockResolvedValue({ sellerId: SELLER_ID, status: "RESERVED" });
    const productUpdate = vi.fn().mockResolvedValue({});
    const db = fakeDb({ productFindFirst, productUpdate });

    await changeStatus(db, SELLER_ID, PRODUCT_ID, "SOLD");

    expect(productUpdate).toHaveBeenCalledWith({
      where: { id: PRODUCT_ID },
      data: { status: "SOLD" },
    });
  });
});

describe("changeStatus - Invalid Transitions", () => {
  it("rejects SOLD → SELLING transition with 409", async () => {
    const productFindFirst = vi.fn().mockResolvedValue({ sellerId: SELLER_ID, status: "SOLD" });
    const productUpdate = vi.fn();
    const db = fakeDb({ productFindFirst, productUpdate });

    await expect(changeStatus(db, SELLER_ID, PRODUCT_ID, "SELLING")).rejects.toMatchObject({
      code: "INVALID_TRANSITION",
      httpStatus: 409,
    });
    expect(productUpdate).not.toHaveBeenCalled();
  });

  it("rejects SOLD → RESERVED transition with 409", async () => {
    const productFindFirst = vi.fn().mockResolvedValue({ sellerId: SELLER_ID, status: "SOLD" });
    const productUpdate = vi.fn();
    const db = fakeDb({ productFindFirst, productUpdate });

    await expect(changeStatus(db, SELLER_ID, PRODUCT_ID, "RESERVED")).rejects.toMatchObject({
      code: "INVALID_TRANSITION",
      httpStatus: 409,
    });
    expect(productUpdate).not.toHaveBeenCalled();
  });

  it("rejects SOLD → SOLD transition with 409", async () => {
    const productFindFirst = vi.fn().mockResolvedValue({ sellerId: SELLER_ID, status: "SOLD" });
    const productUpdate = vi.fn();
    const db = fakeDb({ productFindFirst, productUpdate });

    await expect(changeStatus(db, SELLER_ID, PRODUCT_ID, "SOLD")).rejects.toMatchObject({
      code: "INVALID_TRANSITION",
      httpStatus: 409,
    });
    expect(productUpdate).not.toHaveBeenCalled();
  });

  it("rejects same-state transition SELLING → SELLING with 409", async () => {
    const productFindFirst = vi.fn().mockResolvedValue({ sellerId: SELLER_ID, status: "SELLING" });
    const productUpdate = vi.fn();
    const db = fakeDb({ productFindFirst, productUpdate });

    await expect(changeStatus(db, SELLER_ID, PRODUCT_ID, "SELLING")).rejects.toMatchObject({
      code: "INVALID_TRANSITION",
      httpStatus: 409,
    });
    expect(productUpdate).not.toHaveBeenCalled();
  });

  it("rejects same-state transition RESERVED → RESERVED with 409", async () => {
    const productFindFirst = vi.fn().mockResolvedValue({ sellerId: SELLER_ID, status: "RESERVED" });
    const productUpdate = vi.fn();
    const db = fakeDb({ productFindFirst, productUpdate });

    await expect(changeStatus(db, SELLER_ID, PRODUCT_ID, "RESERVED")).rejects.toMatchObject({
      code: "INVALID_TRANSITION",
      httpStatus: 409,
    });
    expect(productUpdate).not.toHaveBeenCalled();
  });
});

describe("changeStatus - Missing/Deleted Product", () => {
  it("throws NOT_FOUND (404) when product does not exist, never calls update", async () => {
    const productFindFirst = vi.fn().mockResolvedValue(null);
    const productUpdate = vi.fn();
    const db = fakeDb({ productFindFirst, productUpdate });

    await expect(changeStatus(db, SELLER_ID, PRODUCT_ID, "RESERVED")).rejects.toMatchObject({
      code: "NOT_FOUND",
      httpStatus: 404,
    });
    expect(productUpdate).not.toHaveBeenCalled();
  });

  it("throws NOT_FOUND (404) when product is deleted (deletedAt is not null), never calls update", async () => {
    // When deletedAt != null, findFirst with deletedAt: null WHERE clause returns null
    const productFindFirst = vi.fn().mockResolvedValue(null);
    const productUpdate = vi.fn();
    const db = fakeDb({ productFindFirst, productUpdate });

    await expect(changeStatus(db, SELLER_ID, PRODUCT_ID, "RESERVED")).rejects.toMatchObject({
      code: "NOT_FOUND",
      httpStatus: 404,
    });
    expect(productUpdate).not.toHaveBeenCalled();
  });

  it("checks for missing/deleted product with correct WHERE clause", async () => {
    const productFindFirst = vi.fn().mockResolvedValue(null);
    const db = fakeDb({ productFindFirst });

    await expect(changeStatus(db, SELLER_ID, PRODUCT_ID, "RESERVED")).rejects.toThrow();

    expect(productFindFirst).toHaveBeenCalledWith({
      where: { id: PRODUCT_ID, deletedAt: null },
      select: { sellerId: true, status: true },
    });
  });
});

describe("changeStatus - Ownership Enforcement", () => {
  it("throws FORBIDDEN (403) when seller is not the owner, never calls update", async () => {
    const productFindFirst = vi.fn().mockResolvedValue({ sellerId: OTHER_ID, status: "SELLING" });
    const productUpdate = vi.fn();
    const db = fakeDb({ productFindFirst, productUpdate });

    await expect(changeStatus(db, SELLER_ID, PRODUCT_ID, "RESERVED")).rejects.toMatchObject({
      code: "FORBIDDEN",
      httpStatus: 403,
    });
    expect(productUpdate).not.toHaveBeenCalled();
  });

  it("checks ownership before checking transition validity", async () => {
    // Non-owner trying invalid transition → should get 403, not 409
    const productFindFirst = vi.fn().mockResolvedValue({ sellerId: OTHER_ID, status: "SOLD" });
    const productUpdate = vi.fn();
    const db = fakeDb({ productFindFirst, productUpdate });

    await expect(changeStatus(db, SELLER_ID, PRODUCT_ID, "SELLING")).rejects.toMatchObject({
      code: "FORBIDDEN",
      httpStatus: 403,
    });
    expect(productUpdate).not.toHaveBeenCalled();
  });
});

describe("changeStatus - Check Order", () => {
  it("checks for missing/deleted product (404) before checking ownership (403)", async () => {
    const productFindFirst = vi.fn().mockResolvedValue(null); // Product not found
    const productUpdate = vi.fn();
    const db = fakeDb({ productFindFirst, productUpdate });

    // Even if we pass a different seller ID, should get 404 because product doesn't exist
    await expect(changeStatus(db, SELLER_ID, PRODUCT_ID, "RESERVED")).rejects.toMatchObject({
      code: "NOT_FOUND",
      httpStatus: 404,
    });
  });

  it("checks ownership (403) before checking transition validity (409)", async () => {
    // Non-owner trying invalid transition → should get 403, not 409
    const productFindFirst = vi.fn().mockResolvedValue({ sellerId: OTHER_ID, status: "SOLD" });
    const productUpdate = vi.fn();
    const db = fakeDb({ productFindFirst, productUpdate });

    await expect(changeStatus(db, SELLER_ID, PRODUCT_ID, "SELLING")).rejects.toMatchObject({
      code: "FORBIDDEN",
      httpStatus: 403,
    });
  });
});
