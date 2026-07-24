import { AppError } from "@/features/_shared/error";
import type { AuthDb } from "@/features/auth/db";

/**
 * 탈퇴 가드 인터페이스. 위반 시 assert()가 AppError("WITHDRAW_BLOCKED", ..., 409)를 던지는 계약이다.
 * #3(판매중/예약중·최근 판매완료)·#5(진행 중 에스크로) 규칙을 아래 createWithdrawGuard가 합성한다.
 */
export interface WithdrawGuard {
  assert(db: AuthDb, userId: string): Promise<void>;
}

export const defaultWithdrawGuard: WithdrawGuard = {
  async assert() {
    /* no-op — 테스트·초기 기본값. 운영 배선은 realWithdrawGuard(합성 규칙). */
  },
};

/**
 * 탈퇴 차단 규칙이 참조하는 조회들(구현은 #3 products/sales-status·#5 escrow/service에 있음).
 * 여기서는 주입만 받아 합성한다 — 규칙(무엇이면 막을지)과 조회(어떻게 세는지)를 분리한다.
 */
export interface WithdrawRules {
  /** 진행 중(ACCEPTED/FUNDED/DISPUTED) 에스크로 수 — 대금이 걸려 있으면 탈퇴 불가. */
  countActiveEscrows(userId: string): Promise<number>;
  /** 판매중/예약중 상품 수 — 판매 진행 중이면 탈퇴 불가. */
  countActiveSales(userId: string): Promise<number>;
  /** 최근 days일 내 판매완료가 있는가 — 구매자 사후 연락(반품·분쟁) 보호를 위한 쿨다운. */
  hasRecentSold(userId: string, days: number): Promise<boolean>;
}

/** 최근 판매완료 쿨다운 기간(일). 이 기간 안에 판매완료가 있으면 탈퇴를 막는다. */
export const RECENT_SOLD_COOLDOWN_DAYS = 7;

function blocked(message: string): AppError {
  return new AppError("WITHDRAW_BLOCKED", message, 409);
}

/**
 * 실제 탈퇴 가드 — 진행 중 에스크로 → 판매 진행 상품 → 최근 판매완료 순으로 검사한다.
 * 대금이 걸린 거래(에스크로)를 가장 먼저 막는다(가장 위험). 하나라도 걸리면 409.
 */
export function createWithdrawGuard(
  rules: WithdrawRules,
  cooldownDays: number = RECENT_SOLD_COOLDOWN_DAYS,
): WithdrawGuard {
  return {
    async assert(_db, userId) {
      if ((await rules.countActiveEscrows(userId)) > 0) {
        throw blocked("진행 중인 안전거래가 있어 지금은 탈퇴할 수 없어요.");
      }
      if ((await rules.countActiveSales(userId)) > 0) {
        throw blocked("판매 중이거나 예약 중인 상품이 있어 지금은 탈퇴할 수 없어요.");
      }
      if (await rules.hasRecentSold(userId, cooldownDays)) {
        throw blocked("최근 판매완료된 거래가 있어 지금은 탈퇴할 수 없어요.");
      }
    },
  };
}

export async function assertWithdrawable(
  db: AuthDb,
  userId: string,
  guard: WithdrawGuard = defaultWithdrawGuard,
): Promise<void> {
  await guard.assert(db, userId);
}
