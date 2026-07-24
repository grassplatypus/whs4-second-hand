import { AppError } from "@/features/_shared/error";
import type { EscrowStatus } from "@prisma/client";

/**
 * 에스크로 상태 전이 머신.
 *
 * REQUESTED → ACCEPTED | CANCELLED   (조정 중 counter는 REQUESTED를 유지하므로 전이가 아니다 — amount만 갱신)
 * ACCEPTED  → FUNDED   | CANCELLED
 * FUNDED    → RELEASED | REFUNDED | DISPUTED
 * DISPUTED  → RELEASED | REFUNDED
 * RELEASED / REFUNDED / CANCELLED = 종착(재전이 불가)
 *
 * 주의: 이 표는 "어떤 상태에서 어떤 상태로 갈 수 있는가"(상태 규칙)만 정한다.
 * "누가 그 전이를 할 수 있는가"(행위자 인가 — fund=구매자, refund=판매자, resolve=관리자 등)는
 * 서비스(`service.ts`)의 각 액션 함수가 강제한다. 이 분리를 깨지 말 것.
 */
export const TRANSITIONS: Record<EscrowStatus, EscrowStatus[]> = {
  REQUESTED: ["ACCEPTED", "CANCELLED"],
  ACCEPTED: ["FUNDED", "CANCELLED"],
  FUNDED: ["RELEASED", "REFUNDED", "DISPUTED"],
  DISPUTED: ["RELEASED", "REFUNDED"],
  RELEASED: [],
  REFUNDED: [],
  CANCELLED: [],
};

/** 현재 상태에서 next로의 전이가 유효하지 않으면 409. */
export function assertTransition(cur: EscrowStatus, next: EscrowStatus): void {
  if (!TRANSITIONS[cur].includes(next)) {
    throw new AppError("INVALID_TRANSITION", "지금은 할 수 없는 거래 단계예요.", 409);
  }
}
