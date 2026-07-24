# #1c 프로필/마이페이지/계정관리 설계

작성일: 2026-07-24
상태: 승인됨 (자율 결정 — 근거 문서화)
상위: #1 인증+회원+위치. 선행: #1a/ext-1/ext-2/1b(완료, master).
문서화 방침(goal): 대단계 주요내용·검토중점을 스펙·워크로그로 남긴다.

## 목적

회원의 **프로필(나/상대)·소개글·닉네임·비밀번호·탈퇴**를 제공하고, 민감작업에 **step-up 재인증**을 강제한다(ext-2 프리미티브 재사용). 탈퇴 제한 규칙은 #3/#5/#7이 채울 **스텁 인터페이스**로 남긴다.

**범위 원칙:** 프로필 조회·편집 + 비번 설정/변경 + 닉네임 변경 + 탈퇴(soft-delete) + step-up 게이팅까지. 실제 거래 의존 탈퇴 가드는 #7, 상품·거래는 #3/#5.

## 확정 결정 (자율 — 근거)

- **프로필 노출 최소화(중점):** 내 프로필 = 닉네임·소개글·동네(문자열)·전화인증배지·2FA상태·연동신원·가입일. 상대 프로필 = **공개 subset만**: 닉네임·소개글·동네·전화인증배지·가입일. **이메일·전화번호·정확좌표·연동신원 상세는 상대에게 절대 노출 금지.**
- **소개글:** 자유 편집(step-up 불필요 — 저민감). 길이 제한(≤500).
- **비밀번호 설정(OAuth-only 추가):** 비번 없는 유저가 비번을 추가 설정 → **ext-1 last-credential 갭 해소**(이후 소셜 연동해제 가능). step-up 필요.
- **비밀번호 변경:** 기존 비번 유저. step-up 필요. 변경 시 **다른 세션 전체 폐기**(현재 세션 제외) — 탈취 대비.
- **닉네임 변경:** 유니크 검사 + step-up 필요(식별자성 높음). 동시성 P2002 → 409.
- **탈퇴:** soft-delete(`deletedAt`). step-up 필요. **탈퇴 가드 스텁**: `assertWithdrawable(db, userId)` — 거래중·예약중·판매완료7일내 검사 인터페이스(지금은 통과, #3/#5/#7이 실제 구현 주입). 탈퇴 시 세션 전체 폐기.
- **step-up 재사용:** ext-2 `requireRecentAuth`/`/api/auth/step-up`. 1c 민감작업(비번 설정/변경·닉네임변경·탈퇴)은 라우트에서 `requireRecentAuth` 강제. OAuth-only 유저는 step-up을 이메일 OTP/2FA로(ext-2 `/step-up/send-otp` 존재).
- **마이그레이션 없음:** 필요한 컬럼(bio·deletedAt·passwordHash·nickname) 전부 존재. 감사 이벤트만 추가.

## A. 데이터 모델 — 마이그레이션 없음

컬럼 재사용. 감사 이벤트(String) 추가: `PROFILE_UPDATED | PASSWORD_SET | PASSWORD_CHANGED | NICKNAME_CHANGED | ACCOUNT_WITHDRAWN`. AuthDb 변경 없음(user/session 이미 포함).

## B. 프로필 서비스 (`src/features/profile/service.ts`)

- `getMyProfile(db, userId)` — 전체 필드(단 이메일/전화는 **복호화 안 함**, 존재/검증 여부만 배지로): `{ nickname, bio, region(복호화된 동네 문자열|null), phoneVerified: bool, twoFactorMethod, identities: provider[], hasPassword: bool, createdAt }`. 이메일/전화 평문 미반환.
- `getPublicProfile(db, nickname)` — 공개 subset: `{ nickname, bio, region, phoneVerified, createdAt }`. 없거나 `deletedAt` 있으면 404. 이메일·전화·연동신원·좌표 미포함.
- `updateBio(db, userId, bio, meta)` — zod(≤500) 검증, 저장, PROFILE_UPDATED 감사.

## C. 계정 서비스 (`src/features/profile/account.ts`)

- `setPassword(db, userId, newPassword, meta)` — 유저가 비번 없을 때만(있으면 changePassword로). bcrypt 해시 저장, PASSWORD_SET 감사. (step-up은 라우트)
- `changePassword(db, userId, currentPassword, newPassword, meta, currentSessionId?)` — 기존 비번 검증(틀리면 일반 401) → 새 해시 저장 → **다른 세션 폐기**(현재 제외) → PASSWORD_CHANGED 감사.
- `changeNickname(db, userId, nickname, meta)` — zod(2~20, trim), 유니크 검사(+P2002 409), 저장, NICKNAME_CHANGED 감사.
- `withdraw(db, userId, meta)` — `assertWithdrawable(db, userId)` 통과해야 → `deletedAt=now` → 세션 전체 폐기 → ACCOUNT_WITHDRAWN 감사.

## D. 탈퇴 가드 스텁 (`src/features/profile/withdrawable.ts`)

- `interface WithdrawGuard { assert(db, userId): Promise<void> }` — 위반 시 `AppError("WITHDRAW_BLOCKED", 409, reason)`.
- `defaultWithdrawGuard`: 지금은 통과(no-op). #3(거래중·판매완료7일)·#5(에스크로 진행)·#7(예약중)이 실제 가드를 이 인터페이스로 주입/합성. 문서에 확장점 명시.

## E. 엔드포인트 (`src/app/api/`)

- `GET /api/profile/me` — 로그인 필요. getMyProfile.
- `GET /api/profile/[nickname]` — 공개. getPublicProfile(404 처리).
- `PATCH /api/profile/bio` — 로그인 필요. updateBio.
- `POST /api/auth/password/set` — 로그인 + **step-up**. setPassword.
- `POST /api/auth/password/change` — 로그인 + **step-up**. changePassword.
- `POST /api/profile/nickname` — 로그인 + **step-up**. changeNickname.
- `POST /api/auth/withdraw` — 로그인 + **step-up**. withdraw.
- 얇은 JSON 라우트, `withErrorHandling`, `currentUserFromRefresh`. step-up 라우트는 `requireRecentAuth`(ext-2) 먼저(step_up userId == refresh userId 확인).

## F. UI (한/영 평어체)

- `/mypage`(신규) — 내 프로필(배지·연동상태), 소개글 편집, 계정관리 링크(비번·닉네임·탈퇴는 각 폼에서 StepUpPrompt 유도).
- `/u/[nickname]`(신규) — 공개 프로필(공개 subset만).
- 비번 설정/변경·닉네임변경·탈퇴 폼 — 401 STEP_UP_REQUIRED 시 ext-2 `StepUpPrompt` 재사용→재시도.
- 서버 원문 렌더 금지(코드→카탈로그). 신규 카탈로그 `profile.*`, `account.*`.

## G. 보안·프라이버시 규약 (검토 중점)

- **상대 프로필 PII 금지:** getPublicProfile은 이메일·전화·연동신원·정확좌표 절대 미포함. 리뷰 필수 확인.
- **비번 변경 세션 무효화:** 변경 시 다른 세션 폐기(현재 제외) — 탈취 세션 축출.
- **민감작업 step-up:** 비번설정/변경·닉네임변경·탈퇴 전부 `requireRecentAuth`. step_up userId==refresh userId.
- **탈퇴 가드:** 스텁이 통과여도 인터페이스·게이트는 실배선(#7이 실제 규칙 주입 시 코드 변경 최소).
- **일반화 실패:** 비번 변경 오류 일반 401. PII 로그·응답 금지.

## H. 재사용

`requireRecentAuth`/step-up(ext-2)·`hashPassword`/`verifyPassword`·`currentUserFromRefresh`·세션 폐기(session.ts `revokeSession`/`updateMany`)·`encryptPII`/`decryptPII`·`logAuthEvent`·`AppError`·`StepUpPrompt` UI 전부 재사용.

## I. 테스트

- profile: getMy(이메일/전화 평문 미반환), getPublic(공개 subset만·PII 없음·탈퇴시 404), updateBio(길이제한).
- account: setPassword(비번 없을때만), changePassword(구비번 검증·다른세션 폐기·오류 일반401), changeNickname(유니크·409), withdraw(가드 통과→soft-delete+세션폐기, 가드 위반→409).
- withdrawable: defaultGuard 통과, 커스텀 가드 위반 전파.
- 라우트/E2E: 마이페이지·공개프로필, 비번설정(OAuth-only)→연동해제 가능, 비번변경(step-up), 닉네임변경, 탈퇴(step-up→로그인 불가). step-up 없으면 401.
- 로그·응답에 이메일·전화 평문 없음.

## J. 완료 기준 (DoD)

1. 내/상대 프로필 조회, 상대에 PII(이메일·전화·연동상세·정확좌표) 없음
2. 소개글 편집(길이제한)
3. OAuth-only 유저 비번 설정 → 이후 소셜 연동해제 가능(ext-1 갭 해소)
4. 비번 변경(step-up, 다른세션 폐기), 닉네임 변경(유니크·step-up)
5. 탈퇴(step-up, soft-delete, 세션 폐기, 이후 로그인 불가), 탈퇴 가드 스텁 인터페이스
6. 민감작업 전부 step-up 강제, 미통과 401
7. 전체 테스트 통과, 로그·응답 PII 평문 없음
8. UI 한/영

## K. 범위 밖

- 실제 탈퇴 가드 규칙(거래중·예약중·판매완료7일) → #3/#5/#7이 주입
- 상품·거래·채팅 → #3/#4/#5
- RBAC 강제 → #2

## 커밋/브랜치
- 브랜치 `feat/profile-account`. 🔴(계정·프로필·탈퇴·라우트)=적대적 리뷰, 🟢(UI·E2E)=메인 점검. 최종 opus. 짧은 한글 커밋, Co-Authored-By 금지.
