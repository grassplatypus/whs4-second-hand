import type { ProductDb } from "./db";

/**
 * #7(회원 탈퇴)의 withdrawable 가드가 주입할 판매 상태 조회.
 * 이 파일은 조회만 한다 — 탈퇴 차단 규칙(어떤 조건이면 막을지) 자체는 #7의 스코프.
 */

/** 판매자가 지금 진행 중인 거래(SELLING/RESERVED, 삭제되지 않은) 개수. */
export async function countActiveSales(db: ProductDb, userId: string): Promise<number> {
  return db.product.count({
    where: {
      sellerId: userId,
      status: { in: ["SELLING", "RESERVED"] },
      deletedAt: null,
    },
  });
}

/** 최근 `days`일 내에 판매완료(SOLD)로 바뀐(삭제되지 않은) 상품이 하나라도 있는가. */
export async function hasRecentSold(db: ProductDb, userId: string, days: number): Promise<boolean> {
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const found = await db.product.findFirst({
    where: {
      sellerId: userId,
      status: "SOLD",
      updatedAt: { gte: cutoff },
      deletedAt: null,
    },
    select: { id: true },
  });
  return found !== null;
}
