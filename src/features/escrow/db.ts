import type { PrismaClient } from "@prisma/client";

/**
 * 에스크로 서비스가 쓰는 DB 표면만 노출한다.
 * 상품 상태 연동이 원자적이어야 하므로 `$transaction`을 포함한다.
 * 단위 테스트는 이 타입에 맞는 목 객체를 넘긴다(#3 ProductDb 패턴).
 */
// 상대 닉네임은 escrow→buyer/seller 관계 include로 가져오므로 db.user는 직접 쓰지 않는다.
export type EscrowDb = Pick<
  PrismaClient,
  "escrow" | "escrowEvent" | "product" | "tradeReview" | "$transaction"
>;
