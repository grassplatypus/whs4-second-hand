// @vitest-environment node
import { describe, it, expect, vi } from "vitest";
import { searchSchema, searchProducts } from "./search";
import type { ProductDb } from "./db";

function fakeDb(queryRawImpl: (...args: unknown[]) => unknown) {
  return {
    product: {},
    productImage: {},
    user: {},
    $queryRaw: vi.fn(queryRawImpl),
    $queryRawUnsafe: vi.fn(),
  } as unknown as ProductDb;
}

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: "p1",
    title: "아이폰 팝니다",
    price: 100000,
    category: "DIGITAL",
    status: "SELLING",
    regionLabel: "강남구 역삼동",
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    thumbnail: "img/1.png",
    distanceKm: null,
    ...overrides,
  };
}

describe("searchSchema", () => {
  it("accepts an empty object (all filters optional) and defaults limit to 20", () => {
    const parsed = searchSchema.parse({});
    expect(parsed.limit).toBe(20);
  });

  it("accepts a fully populated valid input", () => {
    expect(() =>
      searchSchema.parse({
        lat: 37.5,
        lng: 127.0,
        radiusKm: 5,
        category: "DIGITAL",
        minPrice: 1000,
        maxPrice: 500000,
        q: "아이폰",
        cursor: "abc",
        limit: 10,
      }),
    ).not.toThrow();
  });

  it("rejects radiusKm of 0 (must be > 0)", () => {
    expect(() => searchSchema.parse({ radiusKm: 0 })).toThrow();
  });

  it("rejects a negative radiusKm", () => {
    expect(() => searchSchema.parse({ radiusKm: -5 })).toThrow();
  });

  it("rejects an unknown category", () => {
    expect(() => searchSchema.parse({ category: "NOPE" })).toThrow();
  });

  it("rejects a negative minPrice", () => {
    expect(() => searchSchema.parse({ minPrice: -1 })).toThrow();
  });

  it("rejects a negative maxPrice", () => {
    expect(() => searchSchema.parse({ maxPrice: -1 })).toThrow();
  });

  it("rejects a non-integer minPrice", () => {
    expect(() => searchSchema.parse({ minPrice: 1.5 })).toThrow();
  });

  it("rejects a limit over 50", () => {
    expect(() => searchSchema.parse({ limit: 51 })).toThrow();
  });

  it("rejects a limit under 1", () => {
    expect(() => searchSchema.parse({ limit: 0 })).toThrow();
  });
});

describe("searchProducts — validation", () => {
  it("throws AppError INVALID_INPUT (400) for bad params and never touches the db", async () => {
    const queryRaw = vi.fn();
    const db = fakeDb(queryRaw);

    await expect(searchProducts(db, { radiusKm: -1 })).rejects.toMatchObject({
      code: "INVALID_INPUT",
      httpStatus: 400,
    });
    expect(queryRaw).not.toHaveBeenCalled();
  });

  it("throws AppError INVALID_INPUT for a malformed cursor", async () => {
    const queryRaw = vi.fn();
    const db = fakeDb(queryRaw);

    await expect(searchProducts(db, { cursor: "not-valid-base64url-json!!" })).rejects.toMatchObject({
      code: "INVALID_INPUT",
    });
  });
});

describe("searchProducts — base filters", () => {
  it("always filters deletedAt IS NULL and excludes SOLD status", async () => {
    const queryRaw = vi.fn().mockResolvedValue([]);
    const db = fakeDb(queryRaw);

    await searchProducts(db, {});

    const sqlArg = queryRaw.mock.calls[0][0] as { sql: string; text: string };
    const text = sqlArg.text ?? sqlArg.sql;
    expect(text).toContain('"deletedAt" IS NULL');
    expect(text).toContain("SOLD");
  });

  it("orders by createdAt DESC, id DESC when no lat/lng/radius given", async () => {
    const queryRaw = vi.fn().mockResolvedValue([]);
    const db = fakeDb(queryRaw);

    await searchProducts(db, {});

    const sqlArg = queryRaw.mock.calls[0][0] as { sql: string; text: string };
    const text = sqlArg.text ?? sqlArg.sql;
    expect(text).toMatch(/ORDER BY\s+"createdAt" DESC,\s*"id" DESC/);
    expect(text).not.toContain("acos");
  });

  it("binds category as a parameter, not spliced into the SQL text", async () => {
    const queryRaw = vi.fn().mockResolvedValue([]);
    const db = fakeDb(queryRaw);

    await searchProducts(db, { category: "DIGITAL" });

    const sqlArg = queryRaw.mock.calls[0][0] as { sql: string; text: string; values: unknown[] };
    expect(sqlArg.values).toContain("DIGITAL");
    expect(sqlArg.text ?? sqlArg.sql).toContain('"category"');
  });

  it("binds minPrice and maxPrice as parameters", async () => {
    const queryRaw = vi.fn().mockResolvedValue([]);
    const db = fakeDb(queryRaw);

    await searchProducts(db, { minPrice: 1000, maxPrice: 50000 });

    const sqlArg = queryRaw.mock.calls[0][0] as { values: unknown[] };
    expect(sqlArg.values).toContain(1000);
    expect(sqlArg.values).toContain(50000);
  });

  it("omits category/price conditions entirely when not provided", async () => {
    const queryRaw = vi.fn().mockResolvedValue([]);
    const db = fakeDb(queryRaw);

    await searchProducts(db, {});

    const sqlArg = queryRaw.mock.calls[0][0] as { sql: string; text: string };
    const text = sqlArg.text ?? sqlArg.sql;
    expect(text).not.toContain('"category" =');
    expect(text).not.toContain('"price" >=');
    expect(text).not.toContain('"price" <=');
  });
});

describe("searchProducts — 초성 vs title search", () => {
  it("matches titleChoseong when q is a choseong-only query", async () => {
    const queryRaw = vi.fn().mockResolvedValue([]);
    const db = fakeDb(queryRaw);

    await searchProducts(db, { q: "ㅇㅍ" });

    const sqlArg = queryRaw.mock.calls[0][0] as { sql: string; text: string; values: unknown[] };
    const text = sqlArg.text ?? sqlArg.sql;
    expect(text).toContain('"titleChoseong" ILIKE');
    expect(text).not.toContain('"title" ILIKE');
    expect(sqlArg.values).toContain("ㅇㅍ");
  });

  it("matches title when q is a normal (non-choseong) query", async () => {
    const queryRaw = vi.fn().mockResolvedValue([]);
    const db = fakeDb(queryRaw);

    await searchProducts(db, { q: "아이폰" });

    const sqlArg = queryRaw.mock.calls[0][0] as { sql: string; text: string; values: unknown[] };
    const text = sqlArg.text ?? sqlArg.sql;
    expect(text).toContain('"title" ILIKE');
    expect(text).not.toContain('"titleChoseong" ILIKE');
    expect(sqlArg.values).toContain("아이폰");
  });
});

describe("searchProducts — SQL injection", () => {
  it("binds a malicious q as a parameter and never splices it into the SQL text", async () => {
    const malicious = '\'; DROP TABLE "Product";--';
    const queryRaw = vi.fn().mockResolvedValue([]);
    const db = fakeDb(queryRaw);

    await searchProducts(db, { q: malicious });

    const sqlArg = queryRaw.mock.calls[0][0] as { sql: string; text: string; values: unknown[] };
    const text = sqlArg.text ?? sqlArg.sql;
    expect(sqlArg.values).toContain(malicious);
    expect(text).not.toContain("DROP TABLE");
    expect(text).not.toContain(malicious);
  });

  it("binds malicious lat/lng/radiusKm-shaped strings safely (schema rejects non-numbers)", async () => {
    const db = fakeDb(vi.fn());
    await expect(
      searchProducts(db, { lat: "1; DROP TABLE \"Product\";--" as unknown as number }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });
});

describe("searchProducts — haversine distance path", () => {
  it("computes distance and filters/orders by it when lat+lng+radiusKm are all present", async () => {
    const queryRaw = vi.fn().mockResolvedValue([]);
    const db = fakeDb(queryRaw);

    await searchProducts(db, { lat: 37.5, lng: 127.0, radiusKm: 5 });

    const sqlArg = queryRaw.mock.calls[0][0] as { sql: string; text: string; values: unknown[] };
    const text = sqlArg.text ?? sqlArg.sql;
    expect(text).toContain("acos");
    expect(text).toContain('"distanceKm"');
    expect(text).toMatch(/ORDER BY\s+"distanceKm" ASC/);
    expect(sqlArg.values).toContain(37.5);
    expect(sqlArg.values).toContain(127.0);
    expect(sqlArg.values).toContain(5);
  });

  it("does not use the distance path when only lat/lng are given without radiusKm", async () => {
    const queryRaw = vi.fn().mockResolvedValue([]);
    const db = fakeDb(queryRaw);

    await searchProducts(db, { lat: 37.5, lng: 127.0 });

    const sqlArg = queryRaw.mock.calls[0][0] as { sql: string; text: string };
    const text = sqlArg.text ?? sqlArg.sql;
    expect(text).not.toContain("acos");
    expect(text).toMatch(/ORDER BY\s+"createdAt" DESC/);
  });
});

describe("searchProducts — pagination", () => {
  it("fetches limit+1 rows and returns a nextCursor when more rows exist", async () => {
    const rows = Array.from({ length: 3 }, (_, i) => row({ id: `p${i}`, createdAt: new Date(2026, 0, i + 1) }));
    const queryRaw = vi.fn().mockResolvedValue(rows);
    const db = fakeDb(queryRaw);

    const result = await searchProducts(db, { limit: 2 });

    const sqlArg = queryRaw.mock.calls[0][0] as { values: unknown[] };
    expect(sqlArg.values).toContain(3); // limit(2) + 1

    expect(result.items).toHaveLength(2);
    expect(result.nextCursor).not.toBeNull();
    expect(typeof result.nextCursor).toBe("string");
  });

  it("returns nextCursor null when fewer than limit+1 rows come back", async () => {
    const rows = [row({ id: "p0" }), row({ id: "p1" })];
    const queryRaw = vi.fn().mockResolvedValue(rows);
    const db = fakeDb(queryRaw);

    const result = await searchProducts(db, { limit: 5 });

    expect(result.items).toHaveLength(2);
    expect(result.nextCursor).toBeNull();
  });

  it("applies a valid cursor as a bound WHERE condition (createdAt/id keyset)", async () => {
    const queryRaw = vi.fn().mockResolvedValue([]);
    const db = fakeDb(queryRaw);
    const cursor = Buffer.from(
      JSON.stringify({ createdAt: "2026-01-01T00:00:00.000Z", id: "p5" }),
    ).toString("base64url");

    await searchProducts(db, { cursor });

    const sqlArg = queryRaw.mock.calls[0][0] as { sql: string; text: string; values: unknown[] };
    expect(sqlArg.values).toContain("p5");
    expect(sqlArg.values.some((v) => v instanceof Date && v.toISOString() === "2026-01-01T00:00:00.000Z")).toBe(
      true,
    );
  });

  it("applies a valid distance cursor as a bound WHERE condition (distanceKm/id keyset)", async () => {
    const queryRaw = vi.fn().mockResolvedValue([]);
    const db = fakeDb(queryRaw);
    const cursor = Buffer.from(JSON.stringify({ distanceKm: 3.2, id: "p9" })).toString("base64url");

    await searchProducts(db, { lat: 37.5, lng: 127.0, radiusKm: 5, cursor });

    const sqlArg = queryRaw.mock.calls[0][0] as { sql: string; text: string; values: unknown[] };
    expect(sqlArg.values).toContain("p9");
    expect(sqlArg.values).toContain(3.2);
  });
});

describe("searchProducts — response shape", () => {
  it("returns ProductCard items with no seller PII and no precise coordinates, even if the row carries extra fields", async () => {
    const leakyRow = row({
      sellerId: "seller-1",
      sellerEmail: "seller@example.com",
      sellerPhone: "01099998888",
      lat: 37.999999,
      lng: 127.999999,
    });
    const queryRaw = vi.fn().mockResolvedValue([leakyRow]);
    const db = fakeDb(queryRaw);

    const result = await searchProducts(db, {});
    const json = JSON.stringify(result.items);

    expect(json).not.toContain("seller@example.com");
    expect(json).not.toContain("01099998888");
    expect(json).not.toContain("sellerId");
    expect(json).not.toContain("37.999999");
    expect(json).not.toContain("127.999999");

    expect(result.items[0]).toEqual({
      id: "p1",
      title: "아이폰 팝니다",
      price: 100000,
      category: "DIGITAL",
      status: "SELLING",
      thumbnail: "img/1.png",
      regionLabel: "강남구 역삼동",
      distanceKm: null,
      createdAt: row().createdAt,
    });
  });

  it("carries distanceKm through on the distance path", async () => {
    const queryRaw = vi.fn().mockResolvedValue([row({ distanceKm: 4.2 })]);
    const db = fakeDb(queryRaw);

    const result = await searchProducts(db, { lat: 37.5, lng: 127.0, radiusKm: 5 });

    expect(result.items[0].distanceKm).toBe(4.2);
  });

  it("sets thumbnail to null when the row has none", async () => {
    const queryRaw = vi.fn().mockResolvedValue([row({ thumbnail: null })]);
    const db = fakeDb(queryRaw);

    const result = await searchProducts(db, {});

    expect(result.items[0].thumbnail).toBeNull();
  });
});
