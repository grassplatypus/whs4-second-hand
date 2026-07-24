import { z } from "zod";
import { Prisma } from "@prisma/client";
import { AppError } from "@/features/_shared/error";
import { isChoseongQuery } from "./choseong";
import type { ProductDb } from "./db";

const CATEGORIES = ["DIGITAL", "APPLIANCE", "FURNITURE", "CLOTHING", "BOOK", "BEAUTY", "SPORTS", "ETC"] as const;

function invalidInput(): AppError {
  return new AppError("INVALID_INPUT", "검색 조건을 다시 확인해 주세요.", 400);
}

function escapeWildcards(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}

export const searchSchema = z.object({
  lat: z.number().optional(),
  lng: z.number().optional(),
  radiusKm: z.number().positive().optional(),
  category: z.enum(CATEGORIES).optional(),
  minPrice: z.number().int().min(0).optional(),
  maxPrice: z.number().int().min(0).optional(),
  q: z.string().optional(),
  status: z.enum(["SELLING", "RESERVED", "SOLD"]).optional(),
  cursor: z.string().optional(),
  limit: z.number().int().min(1).max(50).default(20),
});
export type SearchInput = z.infer<typeof searchSchema>;

/**
 * 검색 결과 카드 — 이 안전한 부분집합 외에는 절대 추가하지 않는다.
 * 판매자 PII(닉네임 포함 그 무엇도) 없음, 정확 좌표 없음(distanceKm만 노출).
 */
export interface ProductCard {
  id: string;
  title: string;
  price: number;
  category: string;
  status: string;
  thumbnail: string | null;
  regionLabel: string | null;
  distanceKm: number | null;
  createdAt: Date;
}

/** 키셋 페이지네이션 커서 페이로드. distanceKm은 거리순 경로, createdAt은 최신순 경로에서 쓴다. */
interface CursorPayload {
  id: string;
  createdAt?: string;
  distanceKm?: number;
}

function encodeCursor(payload: CursorPayload): string {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

function decodeCursor(cursor: string): CursorPayload {
  try {
    const json = Buffer.from(cursor, "base64url").toString("utf8");
    const parsed = JSON.parse(json) as unknown;
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      typeof (parsed as Record<string, unknown>).id !== "string" ||
      (parsed as Record<string, unknown>).id === ""
    ) {
      throw new Error("malformed cursor");
    }
    const payload = parsed as Record<string, unknown>;

    // Validate createdAt if present: must be a string that parses to a valid Date
    if (payload.createdAt !== undefined) {
      if (typeof payload.createdAt !== "string") {
        throw new Error("createdAt must be a string");
      }
      const date = new Date(payload.createdAt);
      if (isNaN(date.getTime())) {
        throw new Error("createdAt is not a valid ISO date");
      }
    }

    // Validate distanceKm if present: must be a finite number
    if (payload.distanceKm !== undefined) {
      if (typeof payload.distanceKm !== "number" || !isFinite(payload.distanceKm)) {
        throw new Error("distanceKm must be a finite number");
      }
    }

    return payload as unknown as CursorPayload;
  } catch {
    throw invalidInput();
  }
}

interface SearchRow {
  id: string;
  title: string;
  price: number;
  category: string;
  status: string;
  regionLabel: string | null;
  createdAt: Date | string;
  thumbnail: string | null;
  distanceKm?: number | null;
}

function toCard(row: SearchRow): ProductCard {
  return {
    id: row.id,
    title: row.title,
    price: row.price,
    category: row.category,
    status: row.status,
    thumbnail: row.thumbnail ?? null,
    regionLabel: row.regionLabel ?? null,
    distanceKm: row.distanceKm ?? null,
    createdAt: row.createdAt instanceof Date ? row.createdAt : new Date(row.createdAt),
  };
}

/**
 * 상품 검색: haversine 반경 필터, category/price 필터, 초성/제목 검색, 키셋 페이지네이션.
 * 모든 사용자 입력값은 Prisma.sql 태그드 템플릿을 통해 바인딩 파라미터로만 전달한다 —
 * 절대 문자열로 이어붙이지 않는다(SQL 인젝션 차단이 이 함수의 핵심 요구사항).
 */
export async function searchProducts(
  db: ProductDb,
  raw: unknown,
): Promise<{ items: ProductCard[]; nextCursor: string | null }> {
  const parsed = searchSchema.safeParse(raw);
  if (!parsed.success) throw invalidInput();
  const input = parsed.data;

  const hasDistance = input.lat !== undefined && input.lng !== undefined && input.radiusKm !== undefined;

  const cursorPayload = input.cursor ? decodeCursor(input.cursor) : null;
  if (cursorPayload) {
    if (hasDistance && cursorPayload.distanceKm === undefined) throw invalidInput();
    if (!hasDistance && !cursorPayload.createdAt) throw invalidInput();
  }

  // 상태 필터: 지정되면 그 상태만, 없으면 기본(판매완료 제외 — 판매중/예약중).
  const baseConditions: Prisma.Sql[] = [Prisma.sql`p."deletedAt" IS NULL`];
  if (input.status) {
    baseConditions.push(Prisma.sql`p."status" = ${input.status}::"ProductStatus"`);
  } else {
    baseConditions.push(Prisma.sql`p."status" != 'SOLD'`);
  }
  if (input.category) {
    baseConditions.push(Prisma.sql`p."category" = ${input.category}::"Category"`);
  }
  if (input.minPrice !== undefined) {
    baseConditions.push(Prisma.sql`p."price" >= ${input.minPrice}`);
  }
  if (input.maxPrice !== undefined) {
    baseConditions.push(Prisma.sql`p."price" <= ${input.maxPrice}`);
  }
  if (input.q) {
    const escapedQ = escapeWildcards(input.q);
    baseConditions.push(
      isChoseongQuery(input.q)
        ? Prisma.sql`p."titleChoseong" ILIKE '%' || ${escapedQ} || '%' ESCAPE '\\'`
        : Prisma.sql`p."title" ILIKE '%' || ${escapedQ} || '%' ESCAPE '\\'`,
    );
  }

  const selectItems: Prisma.Sql[] = [
    Prisma.sql`p."id"`,
    Prisma.sql`p."title"`,
    Prisma.sql`p."price"`,
    Prisma.sql`p."category"`,
    Prisma.sql`p."status"`,
    Prisma.sql`p."regionLabel"`,
    Prisma.sql`p."createdAt"`,
    Prisma.sql`(SELECT pi."path" FROM "ProductImage" pi WHERE pi."productId" = p."id" ORDER BY pi."order" ASC LIMIT 1) AS "thumbnail"`,
  ];
  if (hasDistance) {
    // haversine: 6371km * acos(clamp(cos(lat1)*cos(lat2)*cos(lng2-lng1) + sin(lat1)*sin(lat2), -1, 1))
    selectItems.push(Prisma.sql`(
      6371 * acos(
        LEAST(1, GREATEST(-1,
          cos(radians(${input.lat})) * cos(radians(p."lat")) * cos(radians(p."lng") - radians(${input.lng}))
          + sin(radians(${input.lat})) * sin(radians(p."lat"))
        ))
      )
    ) AS "distanceKm"`);
  }

  // 거리(distanceKm)/반경 필터와 커서 조건은 SELECT 별칭을 참조해야 하므로 CTE로 감싼다
  // (표준 SQL에서 WHERE 절은 같은 레벨의 SELECT 별칭을 볼 수 없다).
  const outerConditions: Prisma.Sql[] = [];
  if (hasDistance) {
    outerConditions.push(Prisma.sql`"distanceKm" <= ${input.radiusKm}`);
  }
  if (cursorPayload) {
    if (hasDistance) {
      const d = cursorPayload.distanceKm as number;
      outerConditions.push(
        Prisma.sql`("distanceKm" > ${d} OR ("distanceKm" = ${d} AND "id" > ${cursorPayload.id}))`,
      );
    } else {
      const createdAt = new Date(cursorPayload.createdAt as string);
      outerConditions.push(
        Prisma.sql`("createdAt" < ${createdAt} OR ("createdAt" = ${createdAt} AND "id" < ${cursorPayload.id}))`,
      );
    }
  }
  const outerWhere =
    outerConditions.length > 0 ? Prisma.sql`WHERE ${Prisma.join(outerConditions, " AND ")}` : Prisma.empty;

  const orderBy = hasDistance
    ? Prisma.sql`ORDER BY "distanceKm" ASC, "id" ASC`
    : Prisma.sql`ORDER BY "createdAt" DESC, "id" DESC`;

  const fetchLimit = input.limit + 1;

  const sql = Prisma.sql`
    WITH base AS (
      SELECT ${Prisma.join(selectItems, ", ")}
      FROM "Product" p
      WHERE ${Prisma.join(baseConditions, " AND ")}
    )
    SELECT * FROM base
    ${outerWhere}
    ${orderBy}
    LIMIT ${fetchLimit}
  `;

  const rows = await db.$queryRaw<SearchRow[]>(sql);

  const hasMore = rows.length > input.limit;
  const pageRows = hasMore ? rows.slice(0, input.limit) : rows;
  const items = pageRows.map(toCard);

  let nextCursor: string | null = null;
  if (hasMore) {
    const last = pageRows[pageRows.length - 1];
    nextCursor = hasDistance
      ? encodeCursor({ id: last.id, distanceKm: last.distanceKm ?? 0 })
      : encodeCursor({ id: last.id, createdAt: new Date(last.createdAt).toISOString() });
  }

  return { items, nextCursor };
}
