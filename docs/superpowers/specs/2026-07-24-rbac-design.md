# #2 RBAC 미들웨어 설계

작성일: 2026-07-24
상태: 승인됨 (자율 결정)
선행: #1 전체(완료, master). 문서화 방침(goal): 주요내용·검토중점 기록.

## 목적

역할 기반 접근 제어: GUEST(미인증)/USER/SUSPENDED/ADMIN 게이트, **SUSPENDED 전면차단**, 에러 마스킹 유지. 재사용 가능한 authorize 프리미티브로 이후(#3~#7) 라우트가 얹힘.

**범위 원칙:** RBAC 프리미티브 + SUSPENDED 강제 + admin 게이트 + 기존 인증 라우트 적용까지. 관리자 UI·제재 플로우는 #6.

## 확정 결정 (자율 — 근거)

- **역할 원천:** access 토큰이 `role`을 담지만(최대 15분 stale) 신뢰의 최종 원천은 **DB**. authorize는 DB에서 fresh role·deletedAt을 읽는다.
- **SUSPENDED 전면차단(중점):** 두 겹.
  1. **초크포인트:** `loginUser`·`rotateSession`이 SUSPENDED면 세션 발급 거부(`ACCOUNT_SUSPENDED` 403). 정지 유저는 로그인·회전 불가 → 기존 access는 ≤15분 내 만료 → 전 플랫폼 자동 잠김.
  2. **실시간:** 인증 필요 라우트는 `requireActiveUser`로 매 요청 DB fresh 검사(즉시 차단). soft-delete(`deletedAt`)도 동일 차단.
- **GUEST:** 토큰/쿠키 없음 → 보호 라우트 401 `UNAUTHENTICATED`. 공개 라우트(공개 프로필 등)는 무인증 허용.
- **ADMIN:** `requireAdmin`으로 ADMIN만. #6 관리자 라우트가 사용. 데모용 `GET /api/admin/ping` 추가.
- **역할 부여:** 역할 변경(정지/해제/승격)은 #6 관리자 몫. #2는 테스트용 시드/직접 DB 설정으로 검증(관리 API는 #6).
- **에러 마스킹:** 기존 `withErrorHandling`/`toClientError` 유지. RBAC은 `AppError(FORBIDDEN 403 / ACCOUNT_SUSPENDED 403 / UNAUTHENTICATED 401)`만 던진다 — 내부 노출 없음.
- **마이그레이션·UI 없음:** Role enum 존재. UI는 정지 안내 카탈로그 문자열 1개만(에러 매핑).

## A. RBAC 프리미티브 (`src/features/auth/rbac.ts`)

- `type Role = "USER" | "SUSPENDED" | "ADMIN"`.
- `assertNotSuspended(user: { role: Role; deletedAt: Date | null })` — SUSPENDED→`AppError("ACCOUNT_SUSPENDED", 403)`, deletedAt→`AppError("ACCOUNT_GONE", 403)`.
- `assertRole(role: Role, allowed: Role[])` — 불포함→`AppError("FORBIDDEN", 403)`.
- `requireActiveUser(db, req): Promise<{ userId, role }>` — `currentUserFromRefresh`(쿠키)로 신원 → DB fresh `{role, deletedAt}` 로드(없으면 401) → `assertNotSuspended` → 반환. (미인증→401.)
- `requireAdmin(db, req): Promise<{ userId }>` — requireActiveUser → `assertRole(role, ["ADMIN"])`.
- `requireActiveBearer(db, req)` — bearer(getCurrentUser) 경로용 동종(예: `/api/auth/me`). DB fresh 검사.

## B. 초크포인트 강제 (기존 코드 최소 수정)

- `login.ts` `loginUser`: 비번 검증 후 user select에 `role`·`deletedAt` 추가, SUSPENDED/deletedAt이면 세션·2FA챌린지 발급 전에 `AppError("ACCOUNT_SUSPENDED", 403)`. (실패 일반화와 별개 — 정지는 명시 코드.)
- `oauth/link.ts` `loginOrRegisterWithOAuth`: 기존 신원 로그인 경로에서 동일 SUSPENDED 차단.
- `session.ts` `rotateSession`: 이미 `user.deletedAt` 검사 있음 → `role==="SUSPENDED"`도 폐기·`ACCOUNT_SUSPENDED`. (재사용 감지·회전 기존 로직 불변, 조건만 추가.)

## C. 라우트 적용

- 기존 인증 필요 mutating 라우트(프로필 bio·닉네임·비번·탈퇴·위치·전화·2FA설정·oauth unlink·step-up 등)를 `requireActiveUser`로 전환(또는 `currentUserFromRefresh` 뒤 `assertNotSuspended` 삽입). **최소 침습:** 공통 헬퍼로 한 줄 교체. 공개 라우트(공개 프로필·헬스)는 불변.
- 데모 admin 라우트 `GET /api/admin/ping` — `requireAdmin`→`{ok, role}`. USER/SUSPENDED/GUEST는 403/401.
- step-up 라우트도 active-user 전제(정지 유저는 step-up 불가).

## D. 보안 규약 (검토 중점)

- **정지 우회 불가:** 로그인·OAuth로그인·refresh 회전 전부 SUSPENDED 차단(세션 못 얻음) + 라우트 실시간 검사(기존 access로도 mutating 불가). 두 겹 다 확인.
- **역할 stale 무시:** authorize는 토큰 role이 아니라 DB role로 판단(정지 직후 즉시 반영).
- **에러 마스킹:** RBAC 실패는 코드만(FORBIDDEN/ACCOUNT_SUSPENDED/UNAUTHENTICATED), 내부·PII 없음.
- **공개 라우트 회귀 없음:** 공개 프로필·헬스는 여전히 무인증.

## E. UI

- 카탈로그 `common.suspended`("계정이 정지되었어요. 문의해 주세요") 등 에러 코드 매핑 몇 개. 정지 유저가 mutating 시 폼이 코드→이 문자열 표시. 전용 페이지 불필요.

## F. 테스트

- rbac 프리미티브: assertNotSuspended(정지·삭제 차단), assertRole, requireActiveUser(정지→403·삭제→403·미인증→401·정상 반환), requireAdmin(USER→403·ADMIN→통과).
- 초크포인트: 정지 유저 loginUser→403(세션·챌린지 미발급), OAuth 로그인→403, rotateSession→ACCOUNT_SUSPENDED+폐기.
- 라우트: admin/ping — ADMIN 200, USER 403, GUEST 401. 정지 유저가 mutating 라우트→403.
- E2E: 정상 유저 mutating OK → (DB로 정지 설정) → 같은 세션 mutating 403 + refresh 403 + 재로그인 403. admin 라우트 게이트.
- 로그·응답에 내부·PII 없음.

## G. 완료 기준 (DoD)

1. GUEST 보호 라우트 401
2. SUSPENDED: 로그인·OAuth·refresh 차단 + 인증 라우트 실시간 403(기존 access로도 mutating 불가)
3. ADMIN 게이트: admin 라우트 ADMIN만
4. authorize가 DB fresh role로 판단(토큰 stale 무시)
5. 에러 마스킹 유지, 공개 라우트 무인증 회귀 없음
6. 전체 테스트 통과

## H. 범위 밖
- 관리자 제재 API·UI·대시보드 → #6. 세밀 권한(리소스 소유권)은 각 도메인(#3~#5)에서.

## 커밋/브랜치
- `feat/rbac`. 🔴(프리미티브·초크포인트·라우트 적용)=적대적 리뷰. 🟢(E2E·카탈로그)=메인 점검. 최종 opus. 짧은 한글 커밋.
