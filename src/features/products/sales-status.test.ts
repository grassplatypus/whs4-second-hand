// @vitest-environment node
import { describe, it, expect, vi } from "vitest";
import { countActiveSales, hasRecentSold } from "./sales-status";
import type { ProductDb } from "./db";

const USER_ID = "user-1";

function fakeDb(overrides: {
  productCount?: ReturnType<typeof vi.fn>;
  productFindFirst?: ReturnType<typeof vi.fn>;
} = {}) {
  return {
    product: {
      count: overrides.productCount ?? vi.fn().mockResolvedValue(0),
      findFirst: overrides.productFindFirst ?? vi.fn().mockResolvedValue(null),
    },
    productImage: {},
    user: {},
    $queryRaw: vi.fn(),
    $queryRawUnsafe: vi.fn(),
  } as unknown as ProductDb;
}

describe("countActiveSales", () => {
  it("counts only SELLING/RESERVED, non-deleted products for the seller", async () => {
    const productCount = vi.fn().mockResolvedValue(3);
    const db = fakeDb({ productCount });

    const result = await countActiveSales(db, USER_ID);

    expect(result).toBe(3);
    expect(productCount).toHaveBeenCalledWith({
      where: {
        sellerId: USER_ID,
        status: { in: ["SELLING", "RESERVED"] },
        deletedAt: null,
      },
    });
  });

  it("returns 0 when the seller has no active listings", async () => {
    const productCount = vi.fn().mockResolvedValue(0);
    const db = fakeDb({ productCount });

    await expect(countActiveSales(db, USER_ID)).resolves.toBe(0);
  });
});

describe("hasRecentSold", () => {
  it("returns true when a SOLD product updated within the window exists", async () => {
    const productFindFirst = vi.fn().mockResolvedValue({ id: "p1" });
    const db = fakeDb({ productFindFirst });

    const result = await hasRecentSold(db, USER_ID, 7);

    expect(result).toBe(true);
    const call = productFindFirst.mock.calls[0][0];
    expect(call.where.sellerId).toBe(USER_ID);
    expect(call.where.status).toBe("SOLD");
    expect(call.where.deletedAt).toBeNull();
    expect(call.where.updatedAt.gte).toBeInstanceOf(Date);
    expect(call.select).toEqual({ id: true });
  });

  it("returns false when no matching SOLD product exists", async () => {
    const productFindFirst = vi.fn().mockResolvedValue(null);
    const db = fakeDb({ productFindFirst });

    await expect(hasRecentSold(db, USER_ID, 7)).resolves.toBe(false);
  });

  it("computes the cutoff as now - days (within a small tolerance)", async () => {
    const productFindFirst = vi.fn().mockResolvedValue(null);
    const db = fakeDb({ productFindFirst });
    const before = Date.now();

    await hasRecentSold(db, USER_ID, 3);

    const call = productFindFirst.mock.calls[0][0];
    const cutoff: Date = call.where.updatedAt.gte;
    const expected = before - 3 * 24 * 60 * 60 * 1000;
    expect(Math.abs(cutoff.getTime() - expected)).toBeLessThan(5000);
  });
});
