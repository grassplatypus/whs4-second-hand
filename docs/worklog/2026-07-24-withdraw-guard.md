# 워크로그 — #7 탈퇴/차단 규칙 (withdrawable 가드 합성)

작성일: 2026-07-24

## 0. 스코프

- **무엇:** 1c에서 주입점으로만 열어둔 `WithdrawGuard`(회원 탈퇴 가드)에 실제 규칙을 배선한다. #3(상품 판매 상태)·#5(에스크로) 조회를 합성해, 진행 중인 거래·판매가 있으면 탈퇴를 막는다.
- **왜:** 대금이 걸린 거래(에스크로 보관 중)나 진행 중인 판매를 남기고 유저가 사라지면 상대방(구매자/판매자)이 피해를 본다. 탈퇴는 이미 step-up 재인증(ext-2)과 soft-delete·세션 폐기(1c)까지 돼 있었고, 빠진 건 "언제 막을지"의 실제 규칙 — 그것을 소유 서브프로젝트들이 제공한 조회로 합성한다.
- **결정:** 새 마이그레이션 없음. 규칙(무엇이면 막을지)은 `withdrawable.ts`, 조회(어떻게 세는지)는 #3 `sales-status.ts`·#5 `escrow/service.ts`에 그대로 두고 주입만 한다(관심사 분리·테스트 용이).

## 1. 구현

- `src/features/profile/withdrawable.ts` — `WithdrawRules` 인터페이스(`countActiveEscrows`·`countActiveSales`·`hasRecentSold`) + `createWithdrawGuard(rules, cooldownDays=7)`. 검사 순서: **진행 중 에스크로 → 판매중/예약중 상품 → 최근 판매완료(쿨다운)**. 하나라도 걸리면 `AppError("WITHDRAW_BLOCKED", ..., 409)`. 에스크로를 가장 먼저(대금이 걸려 가장 위험).
- `src/features/profile/withdraw-guard.ts` — 운영 배선. `realWithdrawGuard`가 prisma로 #3/#5 조회를 묶는다.
- `src/app/api/auth/withdraw/route.ts` — `withdraw(...)`에 기본(no-op) 대신 `realWithdrawGuard` 주입.

## 2. 규칙 근거

- **진행 중 에스크로(ACCEPTED/FUNDED/DISPUTED)** — 대금이 보관/조정 중이면 탈퇴 불가. buyer·seller 양쪽 모두 카운트(#5 `countActiveEscrows`가 OR로 조회) — 구매자든 판매자든 돈이 걸려 있으면 막힌다.
- **판매중/예약중 상품(SELLING/RESERVED)** — 판매를 진행 중이면 탈퇴 불가(#3 `countActiveSales`).
- **최근 7일 내 판매완료** — 판매 직후 구매자가 반품·문의로 판매자에게 닿아야 할 수 있어 쿨다운(#3 `hasRecentSold`). 판매자 측 비대칭(구매자는 수령확인=정산 후 에스크로가 종착이라 바로 탈퇴 가능).

## 3. 테스트

- unit(`withdrawable.test.ts`): 합성 가드 — 전부 깨끗하면 통과, 에스크로>0/판매>0/최근판매 각각 409, 에스크로를 가장 먼저 검사(나머지 조회 안 부름), 기본 쿨다운 일수 전달. (기존 assertWithdrawable/주입 테스트 유지.)
- route(`withdraw/route.test.ts`): withdraw에 가드가 4번째 인자로 전달됨(step-up 게이팅 회귀 없음).
- E2E(`profile.spec.ts`): 판매중 상품이 있는 유저는 step-up 후에도 탈퇴 409 `WITHDRAW_BLOCKED`, 상품 삭제 후엔 탈퇴 성공. 실 DB로 차단→해제 증명.

## 4. 검증

```
node vitest run src/features/profile/withdrawable.test.ts src/app/api/auth/withdraw → 15 passed
node vitest run (전체)                                                              → 885 passed
node playwright test profile                                                       → 7 passed (가드 포함)
node tsc --noEmit                                                                   → 클린
```

## 5. 남은 갭

- 강제 탈퇴(관리자)·계정 파기 — 범위 밖(#6도 정지/해제만).
- 차단(유저 차단)은 #4 채팅 차단에서 이미 처리 — #7의 "차단"은 탈퇴 차단(가드)을 의미.
