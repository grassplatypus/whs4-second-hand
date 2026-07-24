import type { PrismaClient } from "@prisma/client";

/**
 * 상품 서비스가 쓰는 DB 표면만 노출한다.
 * 단위 테스트는 이 타입에 맞는 목 객체를 넘긴다(#0 checkHealth 패턴).
 */
export type ProductDb = Pick<
  PrismaClient,
  "product" | "productImage" | "user" | "$queryRaw" | "$queryRawUnsafe"
>;
