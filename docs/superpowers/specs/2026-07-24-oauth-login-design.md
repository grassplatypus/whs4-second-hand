# #1a-ext-1 소셜 OAuth 로그인·연동 설계

작성일: 2026-07-24
상태: 승인됨 (구현 대기)
상위: #1a-ext (소셜+2FA). 이 문서는 **ext-1 OAuth**만. 2FA·step-up 재인증은 ext-2.
선행: #1a 인증 코어(완료, master 머지). 모델 `AuthIdentity`·세션·감사·crypto 재사용.

## 목적

로컬(이메일+비번) 외에 **소셜 로그인**을 추가한다: OAuth로 가입·로그인, 로그인한 계정에 소셜 신원 연동/해제.
Google은 실제 연동, Kakao/Naver는 목(키 없이 전 기능·테스트 동작 — #1a 어댑터 원칙 계승).

**범위 원칙:** OAuth로 인증된 세션을 갖는 것 + 연동/해제까지. 2FA·민감작업 재인증은 ext-2, 프로필/탈퇴는 1c.

## 확정 결정 (브레인스토밍)

- **Provider 깊이:** Google 실제(authorization code 교환 + userinfo), Kakao/Naver 목(결정적 신원). 어댑터 공통 인터페이스, Google도 키 env 없으면 목으로 폴백 → 키 없이 전 플로우·테스트 동작.
- **자동 연동 안 함:** OAuth 이메일이 기존 계정과 같아도 자동 연동/자동 로그인 금지(provider 이메일 신뢰 못 함 → 계정 탈취 위험). 기존 계정 연동은 **그 계정에 로그인한 상태에서만**(명시적·인증된 연동).
- **passwordless 가입:** OAuth 최초 로그인 시 매칭 신원 없고 이메일도 신규면 새 User를 비번 없이 생성. 닉네임 자동 생성(유니크 보장).
- **마지막 자격증명 해제 금지:** 로컬 비번 없고 OAuth 신원 1개뿐이면 그 신원 해제 불가(계정 잠김 방지).
- **콜백은 refresh 쿠키만 심고 리다이렉트:** 브라우저 리다이렉트 플로우라 access 토큰을 URL에 싣지 않는다(로그 유출 회피). 클라는 이후 `/api/auth/refresh`로 access를 받는다(#1a 클라 토큰 보관 이관 결정과 정합).
- **CSRF state:** `/start`가 서명된 state(HMAC)를 쿠키에 double-submit로 심고, `/callback`이 서명·쿠키 일치를 검증. state에 mode(login|link)와 link 시 userId 포함.
- **provider 이메일 평문 저장 안 함:** `AuthIdentity.emailAtProvider`는 채우지 않는다(평문 PII 회피). 정규 이메일은 신규 User면 `User.emailCiphertext`(AES-GCM)에만.

## A. 데이터 모델 — 마이그레이션 없음

`AuthIdentity`(provider, providerUserId, `@@unique([provider, providerUserId])`, userId FK)는 #1a에서 이미 마이그레이션됨. ext-1은 **스키마 변경 없음**. `emailAtProvider`는 남기되 채우지 않는다.

감사 이벤트는 `AuthAuditLog.event`(String 컬럼)에 문자열만 추가 — 마이그레이션 불필요:
`OAUTH_LOGIN | OAUTH_REGISTER | OAUTH_LINK | OAUTH_UNLINK | OAUTH_FAIL`.

`AuthDb` 타입에 `authIdentity` 표면 추가 필요:
`export type AuthDb = Pick<PrismaClient, "user" | "session" | "authAuditLog" | "authIdentity">`.

## B. 환경변수 (`src/features/_shared/env.ts`)

추가(전부 optional — 없으면 목/폴백):
- `GOOGLE_CLIENT_ID?`, `GOOGLE_CLIENT_SECRET?`, `GOOGLE_REDIRECT_URI?` — 셋 다 있으면 Google 실제, 하나라도 없으면 Google도 목.
- `OAUTH_STATE_SECRET` — state HMAC 서명 키(min 16). state는 짧은 수명이라 별도 키. **필수**(없으면 부팅 실패, fail-fast).
- `APP_BASE_URL?` — 리다이렉트 기준(기본 `http://localhost:3000`).

`.env`·`.env.example` 갱신. compose는 `env_file: .env`라 자동 전달.

## C. 어댑터 (`src/features/auth/oauth/`)

```ts
// provider.ts
export interface OAuthUserInfo { providerUserId: string; email: string }
export interface OAuthAdapter {
  readonly provider: "GOOGLE" | "KAKAO" | "NAVER";
  authorizeUrl(state: string): string;          // provider 인증 페이지 URL
  exchange(code: string): Promise<OAuthUserInfo>; // code → 신원(userinfo)
}
export function getAdapter(provider: string): OAuthAdapter; // 미지원 provider → AppError 400
```

- `google.ts`: 키 3종 있으면 실제 — `authorizeUrl`은 accounts.google.com/o/oauth2/v2/auth (scope openid email), `exchange`는 token 엔드포인트 POST → id_token/userinfo에서 sub·email. 키 없으면 **목으로 폴백**(아래 목과 동일 동작).
- `kakao.ts`·`naver.ts`: 목만. `authorizeUrl`은 우리 콜백으로 바로 되돌리는 내부 URL(`{APP_BASE_URL}/api/auth/oauth/{provider}/callback?code=mock-{provider}-{state파생}&state=...`). `exchange(code)`는 code에서 결정적 `providerUserId`·`email`(`mock-{provider}-{hash}@example.com`) 산출. 실 네트워크 없음.
- 목 결정성: 같은 code → 같은 신원(테스트 재현). code에 유저 구분자를 넣어 여러 목 유저 생성 가능.

## D. State CSRF (`src/features/auth/oauth/state.ts`)

- `signState(payload: { nonce, mode, provider, userId? }): string` — `base64url(json).base64url(HMAC-SHA256(json, OAUTH_STATE_SECRET))`.
- `verifyState(raw, expectedProvider): payload | null` — 서명 검증 + provider 일치. 실패 null.
- `STATE_COOKIE = "oauth_state"` — `/start`가 서명된 state를 이 쿠키(HttpOnly, SameSite=Lax, Path=/, 10분, prod Secure)에도 심는다. `/callback`이 쿼리 state == 쿠키 state 확인(double-submit). 검증 후 쿠키 삭제.

## E. 연동 서비스 (`src/features/auth/oauth/link.ts`)

- `loginOrRegisterWithOAuth(db, provider, info, meta): Promise<IssuedSession & { userId }>`:
  1. `authIdentity.findUnique({provider, providerUserId})` 있으면 → 그 User 로그인. `deletedAt` 있으면 `authFailed`. `createSession` 발급. `OAUTH_LOGIN` 감사.
  2. 없으면 `user.findFirst({emailBlindIndex: emailIndex(info.email)})`:
     - 있으면 → **연동 안 함**. `AppError("OAUTH_EMAIL_EXISTS", "이 이메일은 이미 가입돼 있어요. 로그인 후 계정 설정에서 연동해 주세요.", 409)`. `OAUTH_FAIL` 감사.
     - 없으면 → 신규 User(passwordless): `nickname` 자동생성(아래), `emailCiphertext`=encryptPII(email), `emailBlindIndex`, `consentedAt`=now. `authIdentity.create`. `createSession`. `OAUTH_REGISTER` 감사.
- `linkIdentity(db, userId, provider, info, meta): Promise<void>` — 로그인 상태에서 연동:
  - `authIdentity.findUnique({provider, providerUserId})` 이미 있으면: 그게 이 userId면 멱등 no-op, 다른 User면 `AppError("IDENTITY_TAKEN", "다른 계정에 연동된 소셜 계정이에요.", 409)`.
  - 없으면 `authIdentity.create({userId, provider, providerUserId})`. `OAUTH_LINK` 감사. (P2002 경합은 register 패턴대로 409 매핑.)
- `unlinkIdentity(db, userId, provider, meta): Promise<void>`:
  - 대상 신원 조회. 없으면 `AppError("IDENTITY_NOT_FOUND", 404)`.
  - **마지막 자격증명 가드:** User의 `passwordHash`와 `identities` 개수 조회 → 비번 없고 신원 1개면 `AppError("LAST_CREDENTIAL", "마지막 로그인 수단이라 해제할 수 없어요. 비밀번호를 먼저 설정해 주세요.", 409)`.
  - 삭제. `OAUTH_UNLINK` 감사.
- `generateNickname(db): Promise<string>` — `이웃-XXXX`(랜덤 4~5자리) 형태, `user.findUnique({nickname})`로 충돌 확인·재시도(최대 N회). registerSchema의 2~20자 규칙 안에서.

## F. 엔드포인트 (`src/app/api/auth/oauth/[provider]/`)

- `GET .../start` — 쿼리 `?link=1` 옵션. mode=link면 **refresh 쿠키로 현재 유저 확인**(`currentUserFromRefresh` 신규 헬퍼, 회전 없이 세션→userId 조회; 없으면 401 리다이렉트). state 서명·쿠키 심고 `adapter.authorizeUrl(state)`로 302.
- `GET .../callback` — 쿼리 `code`·`state`. state 서명·쿠키 double-submit 검증(실패 시 로그인 페이지로 에러 리다이렉트). `adapter.exchange(code)` → mode에 따라 `loginOrRegisterWithOAuth` 또는 `linkIdentity`. 로그인/가입이면 refresh 쿠키 심고 `/`로 302. 연동이면 계정설정 페이지로 302. state 쿠키 삭제. 실패는 사용자 안내 쿼리로 리다이렉트(평문 PII·내부정보 없이).
- 모두 `withErrorHandling` 밖에서 리다이렉트를 다루므로, 라우트는 try/catch로 실패를 리다이렉트로 변환(에러 코드만, 메시지 카탈로그).

## G. UI (`src/i18n` 한/영 평어체)

- `/login`·`/signup`에 소셜 버튼 3개(구글/카카오/네이버) → `/api/auth/oauth/{provider}/start`로 이동(폼 아닌 링크/버튼 네비게이션).
- `/settings/connections`(신규, 최소) — 연동된 신원 목록 + 연동/해제 버튼. 해제 실패(마지막 자격증명) 시 카탈로그 안내. 이 페이지는 refresh 쿠키 기반 SSR로 현재 유저 신원 조회.
- 콜백 실패 리다이렉트가 실는 에러 코드 → 카탈로그 문자열 매핑(#1a SignupForm 패턴: 서버 원문 렌더 금지).
- 신규 카탈로그 키: `auth.oauth.google/kakao/naver`(버튼), `auth.oauth.connections`(제목), `auth.oauth.link/unlink`, `auth.oauth.emailExists/identityTaken/lastCredential/failed`(에러).

## H. 보안 규약 (전 경로)

- **PII 평문 금지:** 로그·감사행·에러·응답·리다이렉트 URL 어디에도 이메일 평문 금지. `emailAtProvider` 미기록. 목 이메일도 `emailCiphertext`로만 저장.
- **계정 존재 여부:** OAuth 이메일 충돌 시 `OAUTH_EMAIL_EXISTS` 안내는 불가피하게 존재를 드러냄(OAuth 플로우 본질 — 그 provider 이메일 통제를 증명). #1a 열거 트레이드오프 문서에 한 줄 추가.
- **state:** HMAC 서명 + 쿠키 double-submit로 CSRF 차단. 10분 만료. 콜백 후 쿠키 삭제.
- **세션:** 발급·쿠키·회전·감사 전부 #1a 재사용. OAuth 유저도 동일 refresh 회전·재사용 감지.
- **redirect 안전:** 콜백 리다이렉트 목적지는 내부 고정 경로만(open redirect 금지). state에서 온 값을 목적지로 쓰지 않는다.

## I. 재사용 (신규 코드 최소화)

`createSession`·`refreshCookie`/`clearRefreshCookie`·`emailIndex`/`encryptPII`·`logAuthEvent`/`requestMeta`·`AppError`/`withErrorHandling`·`getCurrentUser` 전부 #1a 것 그대로. 신규는 oauth/ 디렉터리(어댑터·state·link)와 콜백 라우트·소셜 버튼·연동 페이지뿐.

## J. 테스트

- **adapter(목):** 결정성(같은 code=같은 신원), Google 폴백(키 없으면 목 동작).
- **state:** 서명 왕복, 변조 거부, provider 불일치 거부, 만료.
- **link 서비스:** 최초 로그인=신규 User+신원+세션, 재로그인=기존 User, 이메일 충돌=OAUTH_EMAIL_EXISTS, 연동 멱등, 타 계정 신원=IDENTITY_TAKEN, 해제 정상, 마지막 자격증명 해제 거부, soft-delete 거부. 전부 목 AuthDb.
- **nickname 생성:** 충돌 시 재시도.
- **콜백 라우트/E2E:** 목 provider로 소셜 가입→로그아웃→소셜 재로그인→연동 페이지에서 해제 시도(마지막이라 거부)→로컬 비번 설정 없이 두번째 provider 연동→해제 성공. state 위조 콜백 거부. Playwright.
- 로그·응답·리다이렉트에 평문 이메일 없음 확인.

## K. 완료 기준 (DoD)

1. 목 Google/Kakao/Naver로 소셜 가입 → 새 User(비번 없음)+AuthIdentity 생성, refresh 쿠키 발급, `/api/auth/me` 동작
2. 소셜 재로그인 시 기존 User로 로그인(중복 User 생성 안 함)
3. OAuth 이메일이 기존 계정과 충돌 시 자동 연동 안 하고 안내
4. 로그인 상태에서 다른 provider 연동/해제 동작, 마지막 자격증명 해제 거부
5. state 위조·불일치 콜백 거부(CSRF)
6. GOOGLE_* env 있으면 실제 Google 플로우 동작(수동), 없으면 목으로 전 기능·테스트 통과
7. 로그·감사·응답·리다이렉트에 평문 이메일 없음, 전체 테스트 통과, 에러 마스킹 유지
8. 소셜 버튼·연동 페이지 한/영 동작(E2E)

## L. 범위 밖 (ext-1)

- 2FA(TOTP·이메일 OTP) 설정·강제, 민감작업 재인증(step-up) 강제 → ext-2
- 로컬 비번을 나중에 추가(계정설정 "비밀번호 설정") → 1c(단, 마지막 자격증명 안내에서 언급)
- 프로필/마이페이지/탈퇴 → 1c
- RBAC 강제 → #2

## 커밋/브랜치 (빠른-정확 워크플로우)

- 브랜치 `feat/oauth-login`(페이즈 하나=브랜치 하나, 태스크마다 아님).
- 보안 핵심 태스크(state·콜백·link 서비스·세션 발급)만 별도 적대적 리뷰+fix 루프. 기계적 태스크(목 어댑터·UI·카탈로그·env)는 구현 서브에이전트 1회+메인 diff 점검.
- 독립 태스크(목 Kakao/Naver, 카탈로그+버튼)는 병렬 디스패치.
- 최종 whole-branch opus 리뷰는 안전망 유지.
- 짧은 한글 커밋, Co-Authored-By 금지. 워크로그 `docs/worklog/`.
