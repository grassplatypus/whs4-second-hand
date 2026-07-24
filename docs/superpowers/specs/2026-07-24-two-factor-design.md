# #1a-ext-2 2차 인증(2FA) + 민감작업 재인증 설계

작성일: 2026-07-24
상태: 승인됨 (구현 대기)
상위: #1a-ext (소셜+2FA). 이 문서는 **ext-2 2FA+step-up**. OAuth는 ext-1(완료).
선행: #1a 인증 코어 + #1a-ext-1 OAuth(둘 다 완료, master). 세션·crypto·감사·OAuth 재사용.

## 목적

유저별 옵션으로 2차 인증(TOTP 또는 이메일 OTP)을 설정·강제하고, 민감작업에 재인증(step-up)을 요구한다.
`twoFactorMethod`/`totpSecret` 컬럼은 #1a에 이미 마이그레이션됨.

**범위 원칙:** 2FA 설정/해제 + 로그인 시 2FA 강제(로컬·OAuth 둘 다) + step-up 프리미티브와 현존 민감작업(2FA 해제, 소셜 연동해제) 게이팅까지. 비번변경·탈퇴 게이팅은 1c가 프리미티브 재사용.

## 확정 결정 (브레인스토밍)

- **2FA 방식:** TOTP(인증 앱) + 이메일 OTP, 유저별 택1(`twoFactorMethod`). 로그인 시 비번(또는 OAuth 신원) 통과 후 2차 강제.
- **로그인 챌린지 = 서명 단기 토큰:** 1차 통과 시 세션 발급 대신 `{sub:userId, purpose:'2fa', method, exp:5분}` HS256 JWT를 HttpOnly 쿠키로. `/verify-login`이 검증 후에야 진짜 세션 발급. 무상태·DB 불필요. access 토큰과 상호 교환 불가(role claim 없음 → `verifyAccessToken` 거부; verify 함수가 purpose도 확인).
- **이메일 OTP 폴백:** 별도 백업 코드 없음. TOTP 유저도 "이메일로 코드 받기"로 통과 가능(이메일=계정 신원이라 항상 가능). **트레이드오프:** 이메일 계정이 뚫리면 2FA가 이메일-접근으로 격하됨 — demo 수용, 문서화.
- **step-up:** 재사용 프리미티브 `requireRecentAuth`. 유효한 step_up 쿠키(재인증 후 발급, 10분) 없으면 `STEP_UP_REQUIRED` 401. 재인증 수단 = 비번(있으면) 또는 이메일 OTP(항상) 또는 TOTP(켠 유저). ext-2 게이트 대상: **2FA 해제, 소셜 연동해제**.
- **OAuth도 2FA 강제(보안 필수):** 유저가 비번+OAuth 둘 다면 OAuth 로그인으로 2FA를 우회할 수 있으므로, `loginOrRegisterWithOAuth`도 2FA 켠 유저면 세션 대신 챌린지를 발급한다. 챌린지 토큰은 "1차 통과, 2차 필요"만 표현해 로컬·OAuth 공유.
- **메일러·TOTP:** 목/실제 토글(#1a 어댑터 원칙). 이메일은 목 메일러(dev는 콘솔, 실 SMTP는 이후). TOTP는 `otplib`.

## A. 데이터 모델

**마이그레이션 1개** — `EmailOtp` 테이블 추가:
```prisma
enum OtpPurpose { LOGIN_2FA STEP_UP SETUP }

model EmailOtp {
  id         String     @id @default(cuid())
  userId     String
  user       User       @relation(fields: [userId], references: [id], onDelete: Cascade)
  codeHash   String     // bcrypt(코드) — 평문 코드는 저장 안 함
  purpose    OtpPurpose
  expiresAt  DateTime
  consumedAt DateTime?
  createdAt  DateTime   @default(now())

  @@index([userId])
}
```
- `User`에 `emailOtps EmailOtp[]` 관계 추가(back-relation). 그 외 User 컬럼 변경 없음.
- `twoFactorMethod`(NONE/TOTP/EMAIL) + `totpSecret`(AES-GCM 암호화 저장)은 기존 컬럼 재사용.
- 복구는 이메일 OTP 폴백 → 새 컬럼 없음.

감사 이벤트(String 컬럼, 마이그레이션 불필요) 추가:
`TWO_FACTOR_ENABLED | TWO_FACTOR_DISABLED | TWO_FACTOR_CHALLENGE | TWO_FACTOR_SUCCESS | TWO_FACTOR_FAIL | STEP_UP_SUCCESS | STEP_UP_FAIL | OTP_SENT`.

`AuthDb`에 `emailOtp` 표면 추가.

## B. 환경변수 (`src/features/_shared/env.ts`)

- `TWO_FACTOR_ISSUER?` — TOTP otpauth 라벨(기본 `"GrassSecondhand"`).
- `SMTP_*?` — 있으면 실 메일러, 없으면 목(콘솔). (호스트/포트/유저/비번, 전부 optional.)
- 신규 서명 시크릿 불필요 — challenge/step-up 토큰은 `JWT_ACCESS_SECRET` 재사용하되 `purpose` claim으로 격리(access와 상호 배타).

## C. TOTP·이메일 OTP 코어 (`src/features/auth/twofactor/`)

- `totp.ts` — `generateTotpSecret(): string`(base32), `totpUri(secret, accountEmail): string`(otpauth://), `verifyTotp(secret, code): boolean`(otplib, ±1 window). 시크릿 저장은 `encryptPII(secret)`, 조회 시 `decryptPII`.
- `emailOtp.ts`:
  - `issueEmailOtp(db, userId, purpose, mailer): Promise<void>` — 6자리 랜덤 코드 생성 → bcrypt 해시로 `EmailOtp` 저장(기존 미소비 동일 purpose 코드는 무효화), 5분 만료, `mailer.send`로 코드 발송(평문 코드는 메일 본문에만·로그 금지), `OTP_SENT` 감사. **레이트리밋:** 동일 유저·purpose 활성 코드 1개, 재발급 최소 간격(예: 30초).
  - `verifyEmailOtp(db, userId, purpose, code): Promise<boolean>` — 미소비·미만료 코드 조회 → bcrypt 비교 → 성공 시 `consumedAt` 기록(재사용 차단). 실패 카운트/만료 처리.
- `mailer.ts` — `interface Mailer { send(to: string, subject: string, body: string): Promise<void> }`, `getMailer()`(SMTP env 있으면 실제, 없으면 콘솔 목). **평문 이메일 주소는 발송에만 쓰고 로그·감사에 남기지 않는다.** 목은 dev에서 코드 콘솔 출력(테스트는 in-memory 캡처).

## D. 챌린지·step-up 토큰 (`src/features/auth/twofactor/challenge.ts`, `stepup.ts`)

- `challenge.ts`: `signChallenge(userId, method): string`(`{sub, purpose:'2fa', method, exp:5분}` HS256, JWT_ACCESS_SECRET), `verifyChallenge(token): {userId, method}|null`(purpose 확인), 쿠키 `CHALLENGE_COOKIE="2fa_challenge"`(HttpOnly, SameSite=Lax, Path=/, 5분, prod Secure), read/clear 헬퍼.
- `stepup.ts`: `signStepUp(userId): string`(`{sub, purpose:'step_up', exp:10분}`), `verifyStepUp(token): {userId}|null`, 쿠키 `STEPUP_COOKIE="step_up"`, read/clear 헬퍼. `requireRecentAuth(req): Promise<{userId}>` — step_up 쿠키 검증, 없거나 무효면 `AppError("STEP_UP_REQUIRED", 401)`.
- 두 토큰 모두 access 토큰과 purpose로 배타 — 서로/access로 교환 불가(각 verify가 purpose 대조).

## E. 2FA 설정·step-up 서비스 (`src/features/auth/twofactor/service.ts`)

- `startTotpSetup(db, userId): Promise<{secret, uri}>` — 시크릿 생성, `totpSecret`에 암호화 저장(아직 `twoFactorMethod`는 NONE, 확인 전까지 미활성), uri 반환.
- `confirmTotp(db, userId, code): Promise<void>` — 저장된 시크릿으로 `verifyTotp` → 성공 시 `twoFactorMethod=TOTP`. `TWO_FACTOR_ENABLED` 감사.
- `startEmailOtpSetup(db, userId, mailer)` → `issueEmailOtp(SETUP)` 발송. `confirmEmailOtp(db, userId, code)` → `verifyEmailOtp(SETUP)` 성공 시 `twoFactorMethod=EMAIL`. `TWO_FACTOR_ENABLED` 감사. (SETUP 코드와 LOGIN_2FA 코드는 purpose로 격리 — 상호 사용 불가.)
- `disableTwoFactor(db, userId): Promise<void>` — **step-up 필요(라우트에서 강제)**. `twoFactorMethod=NONE`, `totpSecret=null`. `TWO_FACTOR_DISABLED` 감사.
- `verifyStepUpReauth(db, userId, body): Promise<void>` — 재인증: `{method:'password', password}` → bcrypt 검증 / `{method:'totp', code}` → verifyTotp / `{method:'email', code}` → verifyEmailOtp(STEP_UP). 성공 시 호출부가 step_up 쿠키 발급. `STEP_UP_SUCCESS`/`STEP_UP_FAIL` 감사.
- `completeLoginTwoFactor(db, userId, method, body): Promise<IssuedSession>` — 챌린지 검증 후 호출: method별 코드 검증(totp/email) → 성공 시 `createSession` 발급. `TWO_FACTOR_SUCCESS`/`TWO_FACTOR_FAIL` 감사.

## F. 로그인 통합 (기존 코드 수정 — 최소·주의)

- `login.ts` `loginUser`: 비번 검증 성공 후, `user.twoFactorMethod !== NONE`이면 세션 발급 대신 `{ twoFactorRequired: true, method }` 반환 + 라우트가 challenge 쿠키 심음. `TWO_FACTOR_CHALLENGE` 감사. NONE이면 기존대로 세션.
- `oauth/link.ts` `loginOrRegisterWithOAuth`: 기존 신원 로그인 경로에서 `user.twoFactorMethod !== NONE`이면 세션 대신 challenge. (신규 가입은 2FA NONE이라 그대로.) 콜백은 challenge면 `/login/2fa`로, 아니면 기존대로 `/`.
- `/api/auth/2fa/verify-login`: challenge 쿠키 + `{code}` → `completeLoginTwoFactor` → 세션 발급 + refresh 쿠키 + challenge 쿠키 삭제. `/api/auth/2fa/resend`(이메일 method): challenge 쿠키의 userId로 `issueEmailOtp(LOGIN_2FA)`.
- **로그인 실패 일반화 유지:** 2FA 코드 실패도 계정 존재 여부·방식 이상 정보 누출 금지, 일반 401.

## G. step-up 게이팅 (기존 민감작업)

- `/api/auth/2fa/disable`: `requireRecentAuth` 통과해야 `disableTwoFactor`. 미통과 시 401 `STEP_UP_REQUIRED`.
- `/api/auth/oauth/[provider]/unlink`(ext-1): `requireRecentAuth` 추가. (unlink는 이미 refresh 쿠키 인증 — 여기에 step-up 요건 추가.)
- step-up 획득 플로우: 민감작업 401 → 클라가 재인증 프롬프트 → `/api/auth/step-up`(비번/2FA/이메일 OTP) → step_up 쿠키 → 작업 재시도.

## H. 엔드포인트 요약 (`src/app/api/auth/`)

- `POST /2fa/verify-login` · `POST /2fa/resend` — 로그인 챌린지 완료·이메일 재발송
- `POST /2fa/totp/start` · `POST /2fa/totp/confirm` — TOTP 설정(로그인 필요)
- `POST /2fa/email/start` · `POST /2fa/email/confirm` — 이메일 2FA 설정
- `POST /2fa/disable` — 해제(step-up 필요)
- `POST /step-up` — 재인증 → step_up 쿠키
- 수정: `POST /oauth/[provider]/unlink` — step-up 요건 추가
- 로직은 전부 `features/auth/twofactor/`, 라우트는 얇게. verify-login/step-up은 리다이렉트 아닌 JSON(`withErrorHandling`).

## I. UI (`src/i18n` 한/영 평어체)

- `/settings/security`(신규) — 2FA 상태·설정(TOTP QR/시크릿, 이메일 2FA), 해제. 로그인 필요(SSR refresh 쿠키).
- `/login/2fa`(신규) — 로그인 챌린지 페이지: 코드 입력, TOTP면 "이메일로 받기" 폴백 버튼. challenge 쿠키 기반.
- step-up 재인증 프롬프트 — 민감작업 시 모달/페이지(비번 또는 코드). 최소 구현.
- 서버 원문 렌더 금지(코드→카탈로그). QR은 otpauth URI를 클라에서 렌더(외부 요청 없이 인라인 QR 또는 시크릿 수동입력 안내).
- 신규 카탈로그 키: `auth.twofactor.*`(설정·해제·챌린지·재인증·에러).

## J. 보안 규약

- **PII 평문 금지:** 이메일 주소는 OTP 발송에만, 로그·감사·응답 금지. TOTP 시크릿·OTP 코드 평문 저장 금지(시크릿 AES-GCM, 코드 bcrypt).
- **OTP 재사용 차단:** `consumedAt`으로 1회용. 만료·소비 코드 거부.
- **레이트리밋:** 이메일 OTP 재발송 최소 간격·활성 코드 1개. 코드 검증 실패 일반화 401.
- **토큰 격리:** challenge/step-up/access는 purpose로 상호 배타. 각 verify가 purpose 대조.
- **2FA 우회 불가:** 로컬·OAuth 로그인 둘 다 2FA 강제.
- **step-up 만료:** 10분. 민감작업마다 유효성 재확인.
- 챌린지/step-up 쿠키 HttpOnly·SameSite=Lax·prod Secure.

## K. 테스트

- **totp:** 시크릿 생성·uri, verifyTotp(정상/오코드/window), 암복호 왕복.
- **emailOtp:** 발급→해시 저장(평문 없음)·발송, 검증(정상/오코드/만료/소비 재사용 거부), 레이트리밋, 동일 purpose 재발급 무효화.
- **challenge/stepup 토큰:** 서명 왕복, purpose 배타(access로 verify 시 null, 반대도), 만료.
- **service:** TOTP 설정·확인·활성, 이메일 2FA 설정, 해제, step-up 재인증(3수단), 로그인 2FA 완료.
- **로그인 통합:** 2FA 유저 로컬 로그인→세션 없이 챌린지, verify-login→세션. OAuth 2FA 유저도 챌린지. 2FA 코드 실패 일반 401.
- **step-up 게이팅:** disable/unlink가 step_up 없으면 401, 있으면 통과.
- **E2E:** TOTP 설정→로그아웃→재로그인 2FA 챌린지→통과, 이메일 OTP 설정·로그인, 이메일 폴백, 2FA 해제(step-up), OAuth 2FA 유저 챌린지. 목 메일러로 코드 캡처.
- 로그·응답에 평문 이메일·코드·시크릿 없음 확인.

## L. 완료 기준 (DoD)

1. TOTP 설정(QR/시크릿)·확인·활성, 잘못된 코드 거부
2. 이메일 2FA 설정·활성, 목 메일러로 코드 발송·검증
3. 2FA 유저 로컬 로그인 시 세션 없이 챌린지 → verify-login 후 세션
4. **OAuth 로그인도 2FA 유저면 챌린지**(우회 불가)
5. 이메일 OTP 폴백(TOTP 유저가 이메일로 통과)
6. 2FA 해제·소셜 연동해제가 step-up 필요, 미통과 401
7. step-up 재인증(비번/TOTP/이메일) → step_up 쿠키 → 작업 통과
8. OTP 1회용·만료·레이트리밋, 시크릿 암호화·코드 해시 저장, 로그·응답에 평문 없음, 전체 테스트 통과
9. 2FA 설정·챌린지·재인증 UI 한/영 동작(E2E)

## M. 범위 밖 (ext-2)

- 비번변경·탈퇴 step-up 게이팅 → 1c(프리미티브 재사용)
- 로컬 비번 추가("비밀번호 설정") → 1c
- 실 SMTP·실 TOTP 발급기 UI 고급화 → 이후
- RBAC 강제 → #2
- SMS 2FA, WebAuthn/passkey → YAGNI

## 커밋/브랜치 (빠른-정확 워크플로우)

- 브랜치 `feat/two-factor`(페이즈 하나=브랜치 하나).
- 🔴 보안 핵심(코어·토큰·서비스·로그인통합·step-up게이팅)은 적대적 리뷰+fix 루프. 🟢(마이그레이션·UI·E2E)는 구현+메인 diff점검.
- 독립 태스크 병렬, 최종 whole-branch opus 리뷰 안전망.
- 짧은 한글 커밋, Co-Authored-By 금지. 워크로그 `docs/worklog/`.
