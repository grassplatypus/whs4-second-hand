import type { AuthDb } from "@/features/auth/db";

/**
 * 탈퇴 가드 인터페이스. 지금은 통과(no-op)만 구현돼 있다 — #3(거래중·판매완료7일)·
 * #5(에스크로)·#7(예약중) 서브프로젝트가 실제 규칙을 이 인터페이스로 주입/합성한다.
 * 위반 시 assert()가 AppError("WITHDRAW_BLOCKED", ..., 409)를 던지는 계약이다.
 */
export interface WithdrawGuard {
  assert(db: AuthDb, userId: string): Promise<void>;
}

export const defaultWithdrawGuard: WithdrawGuard = {
  async assert() {
    /* no-op — 지금은 아무 조건도 막지 않는다 */
  },
};

export async function assertWithdrawable(
  db: AuthDb,
  userId: string,
  guard: WithdrawGuard = defaultWithdrawGuard,
): Promise<void> {
  await guard.assert(db, userId);
}
