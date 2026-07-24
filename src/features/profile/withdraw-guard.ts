import { prisma } from "@/features/_shared/prisma";
import { countActiveSales, hasRecentSold } from "@/features/products/sales-status";
import { countActiveEscrows } from "@/features/escrow/service";
import { createWithdrawGuard } from "./withdrawable";

/**
 * 운영 배선 — #3(상품 판매 상태)·#5(에스크로) 조회를 실제 prisma로 묶어 탈퇴 가드를 만든다.
 * 규칙 자체(무엇이면 막을지)는 withdrawable.ts, 조회 구현은 각 서브프로젝트에 있다.
 */
export const realWithdrawGuard = createWithdrawGuard({
  countActiveEscrows: (userId) => countActiveEscrows(prisma, userId),
  countActiveSales: (userId) => countActiveSales(prisma, userId),
  hasRecentSold: (userId, days) => hasRecentSold(prisma, userId, days),
});
