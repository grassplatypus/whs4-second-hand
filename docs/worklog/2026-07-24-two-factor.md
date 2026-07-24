# 워크로그 — #1a-ext-2 2단계 인증(2FA)·민감작업 재인증

기록 원칙: 시간순, 각 항목은 **무엇을 / 왜 / 결정 / 편차·이슈**. 결과보다 결정의 흐름을 남긴다.

---

## 0. 스코프

- **무엇:** #1a(인증 코어) + #1a-ext-1(소셜 OAuth) 위에 2단계 인증(TOTP·이메일 OTP)과 민감작업(2FA 해제, 소셜 연동 해제) step-up 재인증을 얹는다 — 설정(시크릿/QR·이메일 코드)·로그인/OAuth 로그인 시 챌린지·재인증(비번/TOTP/이메일) 3수단·`/settings/security`·`/login/2fa` 페이지.
- **왜:** #1a-ext-1까지는 로그인이 이메일·비번 또는 OAuth 단일 요소였다. 이번 ext-2는 계정 탈취 방어를 위해 2번째 요소를 얹고, 2FA 해제·소셜 연동 해제 같은 민감작업 앞에 최근 재인증(step-up)을 강제한다.
- **결정:** 서브에이전트 구동(SDD), 태스크 8개로 분해, 브랜치 하나(`feat/two-factor`, 새 브랜치 생성/전환/머지 금지). 카덴스는 태스크 1·7·8 🟢(구현+메인 diff점검), 태스크 2~6 🔴(적대적 리뷰+fix루프) — 서비스·게이팅 로직이 보안 핵심이라 리뷰 비중을 높였다. 전 태스크 완료 후 별도 최종 opus 리뷰는 아직 수행되지 않음(이 워크로그 범위 밖).

## 1. 태스크 실행 로그

| # | 태스크 | 결과 | 편차·결정 |
|---|--------|------|-----------|
| 1 | `EmailOtp` 모델+`OtpPurpose`(LOGIN_2FA/STEP_UP/SETUP)+`User` 역관계, 마이그레이션 `20260724011720_two_factor`, env(`TWO_FACTOR_ISSUER`/`SMTP_*`), `AuthDb`+`emailOtp`, 감사 8종, `otplib` 설치 | ✅ | 172/172, tsc clean, psql 검증. **KNOWN-ISSUE(이관, 이번 태스크까지 미해결):** ext-1 태스크10이 이미 적용한 `20260723151030_auth_core`의 SQL 파일에 (그 이후) 주석이 삽입돼 Prisma 마이그레이션 체크섬이 드리프트됐다 — `migrate deploy`는 체크섬을 재검증하지 않아 무해하지만 `migrate dev`는 이 드리프트에서 막힌다. 이번 태스크(8)에서도 `migrate deploy`만 썼으므로 재현·회피됐지만 근본 해결(`prisma migrate resolve` 등)은 아직 하지 않았다 — 아래 7절에 재이관. |
| 2 | TOTP·이메일 OTP 코어(`totp.ts`/`emailOtp.ts`)+목 메일러 | ✅ 적대적 리뷰 clean | 난이도 중상 — **otplib v13(설치)↔v12 `authenticator`(브리프 가정) API 불일치.** v13은 `authenticator` 싱글턴이 없는 완전 함수형 재작성판이라, 브리프 원문(`authenticator.options = { window: 1 }`)은 존재하지 않는 API였다. 동일한 의도(TOTP 30초 주기 기준 ±1스텝, 즉 클라이언트-서버 시계 오차 허용)를 `verifySync({ ..., epochTolerance: 30 })`로 구현·리뷰가 otplib 소스로 등가성 검증. bcrypt 저장·1회용·purpose 격리·레이트리밋·PII 미로그 테스트로 증명. 188/188. |
| 3 | 챌린지·step-up 토큰(`challenge.ts`/`stepup.ts`)+범용 쿠키 리더 | ✅ 적대적 리뷰 clean | 난이도 중 — access/challenge/step-up 3종 토큰이 같은 JWT 시크릿을 공유하므로 purpose 필드로 격리하는 게 핵심. 6방향(access↔challenge↔step-up 상호) cross-mint 테스트로 실토큰 검증. `requireRecentAuth`는 단일 `STEP_UP_REQUIRED` 에러로 통일. 214/214. |
| 4 | 2FA 설정·해제·step-up 재인증·로그인 완료 서비스(`service.ts`, 8개 함수) | ✅ **1 fix 루프 후 적대적 리뷰 clean** | 난이도 상 — step-up 3수단 디스패치와 로그인 완료의 수단별 분기가 위험지대. **fix(Important×2):** ① `completeLoginTwoFactor`가 fail-closed가 아니었다 — 알려지지 않은/조작된 `method` 값이 어떤 시크릿 상태와도 무관하게 실패해야 하는데 원 구현은 그렇지 않았다 → 수단을 `switch`+`default: ok=false`로 닫고, EMAIL로 전환 시 남을 수 있는 낡은 `totpSecret`을 지워 다운그레이드 경로를 막음(익스플로잇 재현 리그레션 테스트 추가). ② `sendLoginOtp`가 호출자의 `meta`(ip/ua)를 `issueEmailOtp`에 전달하지 않아 감사로그가 비어 있었다 → `meta`를 옵셔널 파라미터로 관통. step-up의 비번 수단은 OAuth-only(비번 없는) 계정에도 `dummyVerify`로 동일 bcrypt 비용을 치르게 해 타이밍 사이드채널을 막음. 243/243. |
| 5 | 로컬·OAuth 로그인에 2FA 챌린지 게이트+설정/검증 라우트 | ✅ 적대적 리뷰 clean | 난이도 상 — 이미 배포된 `login.ts`/`oauth callback`/`link.ts`를 수정하는 태스크라 2FA 우회 방지가 최중요. 로컬은 비번 통과 후에만 게이트(오비번은 여전히 일반 `AUTH_FAILED`), OAuth는 **기존 신원(재로그인) 분기에서만** 게이트(신규 가입은 아직 `twoFactorMethod=NONE`이라 무관 — 우회 아님). 챌린지 응답에는 세션 토큰이 절대 섞이지 않음(`accessToken` 필드 없음), OAuth 콜백 리다이렉트도 토큰·이메일 노출 없이 `/login/2fa`로만 보냄. 두 게이트 모두 `createSession` 미호출을 직접 단언하는 테스트로 검증. 247/247. |
| 6 | 민감작업(2FA 해제, 소셜 연동 해제) step-up 게이팅+재인증 라우트 | ✅ 적대적 리뷰 clean | 난이도 중상 — 교차 유저 `step_up` 쿠키 재사용 방지가 핵심. **소셜 연동 해제 라우트에 `requireRecentAuth`를 추가하고, step_up 토큰의 `userId`가 현재 refresh 세션의 `userId`와 일치하는지 검증**(불일치 시 401) — 이 변경이 이번 태스크(8)의 E2E 실행에서 `e2e/oauth.spec.ts`(ext-1) 2건을 깨뜨렸다(2절 참고). step-up은 인증된 사용자만 재인증하게 해 계정 존재 여부 오라클을 막고, disable은 `requireRecentAuth`를 서비스 호출보다 먼저 검사. 4개 테스트가 실제 stepup 모듈로 교차-유저 재사용을 검증. 251/251. |
| 7 | UI(`TwoFactorSettings`/`TwoFactorChallenge`/`StepUpPrompt`)+`/settings/security`·`/login/2fa` 페이지+`ConnectionsManager` 배선 | ✅ 메인 diff점검 통과 | 난이도 중 — 조립 결함 2건을 스스로 발견·수정. **fix ①** `LoginForm`이 로그인 응답의 `twoFactorRequired`를 무시하고 무조건 `/`로 이동시켜, 로컬 2FA 로그인 자체가 깨져 있었다 → 응답 바디를 파싱해 `twoFactorRequired`면 `/login/2fa`로 리다이렉트하도록 수정. **fix ②** step-up용 이메일 OTP 발송 라우트가 없어 비번 없는(OAuth-only) 계정이나 TOTP 미설정 계정은 step-up 자체가 불가능했다 → `sendStepUpOtp` 서비스 함수+`/api/auth/step-up/send-otp` 라우트 추가, `StepUpPrompt`에 이메일 옵션 배선. 271/271, build green, 한/영 카탈로그 키 양쪽 채움. |
| 8 | E2E(`e2e/twofactor.spec.ts`)+PII 점검+워크로그(본 문서) | ✅ (본 문서) | 아래 2·3·4절 참고. 새로 발견한 이슈 1건(오래된 `e2e/oauth.spec.ts`와의 통합 충돌, `src/` 미변경, `e2e/twofactor.spec.ts`만 추가) — 2절. |

## 2. 태스크 8에서 드러난 이슈: `e2e/oauth.spec.ts`(ext-1) 2건이 이 브랜치의 변경으로 깨져 있음

**갱신(최종 브랜치 리뷰 이후, 커밋 `1e552cf`로 고침):** 아래 서술과 "처리" 항목의 3번(후속 조치로 이관)은 당시 상태의 기록이다. 실제로는 이 브랜치 안에서 두 테스트를 갱신했다 — ①`social signup → relogin same user → link second → unlink`는 네이버 해제 전에 alice(OAuth 전용 계정이라 비번 step-up 불가)가 TOTP를 새로 켜고 그 코드로 `/api/auth/step-up`을 통과한 뒤 해제를 재시도하도록 바꿨고, ②`last-credential unlink is refused`는 `unlink without step-up is refused (step-up gate)`로 이름과 취지를 다시 써서 — bob이 step_up 쿠키 없이 해제를 호출하면 last-credential(409) 체크에 도달하기도 전에 401 `STEP_UP_REQUIRED`가 나는, 이 브랜치가 실제로 추가한 게이트 자체를 검증하게 했다(원래 테스트가 겨냥하던 last-credential 409는 `unlinkIdentity`가 손대지 않은 별개의 가드라 이 테스트의 범위에서 제외 — 새 테스트 안의 주석에 그 근거를 남겼다). 둘 다 `pnpm exec playwright test e2e/oauth.spec.ts`로 그린 확인(4절·§7 참고).

전체 검증 커맨드(`pnpm test:e2e`)를 돌리자 기존 `e2e/oauth.spec.ts`의 두 테스트가 실패한다:

- `social signup → relogin same user → link second → unlink` — 네이버 해제 후 "연결 해제" 버튼이 1개로 줄 것을 기대하지만 2개로 남는다.
- `last-credential unlink is refused` — 해제 클릭 후 "마지막 로그인 수단이라 해제할 수 없어요" 알럿을 기대하지만 나타나지 않는다.

**원인(코드로 확인):** 이번 브랜치의 태스크 6(`6016b9f 민감작업 step-up 게이팅과 재인증 라우트 추가`)이 `src/app/api/auth/oauth/[provider]/unlink/route.ts`에 `requireRecentAuth`(step-up 재인증)를 추가했고, 태스크 7(`ec14d94`)이 `ConnectionsManager`를 "해제 클릭 → 401 STEP_UP_REQUIRED → `StepUpPrompt` 표시 → 재인증 성공 후 같은 provider로 재시도" 흐름으로 바꿨다. 즉 **연동 해제는 이제 설계대로 재인증 없이는 완료되지 않는다** — 이는 버그가 아니라 이번 ext-2가 의도한 동작(DoD 6: "2FA 해제·소셜 연동해제가 step-up 필요, 미통과 401")이다. 문제는 `e2e/oauth.spec.ts`가 ext-1(2FA·step-up이 존재하기 전) 시점에 쓰여 있어, 해제 버튼 클릭이 바로 완료된다고 가정한다는 점이다 — 클릭하면 이제 "연결 해제" 대신 "본인 확인"(`StepUpPrompt`) 화면이 뜨고 멈춘다.

**처리:** 이번 태스크의 파일 변경 범위는 `e2e/twofactor.spec.ts`와 본 워크로그로 한정돼 있어 `e2e/oauth.spec.ts`는 손대지 않았다(범위 밖 변경 금지). 대신:
1. 이 이슈가 새로 생긴 게 아니라 태스크 6에서 유입돼 태스크 7~8 사이 미검출 상태로 남아 있었음을 `git log --oneline -- e2e/oauth.spec.ts`로 확인(마지막 수정이 ext-1의 `99613fa`, 이번 브랜치 커밋 어느 것도 건드리지 않음).
2. `e2e/twofactor.spec.ts`의 3개 테스트는 모두 통과(아래 4절) — 이번 태스크가 커버해야 할 2FA 시나리오 자체는 증명됐다.
3. **후속 조치로 이관**: `e2e/oauth.spec.ts`의 두 테스트를 `StepUpPrompt` 흐름(비번 재입력 후 해제 재시도)에 맞게 갱신해야 한다. 이번 태스크에서 하지 않은 이유는 (a) 허용된 파일 범위 밖이고 (b) 이 저장소의 다음 단계(최종 브랜치 리뷰 또는 1b/1c)에서 통합 테스트 스위트 전체를 한 번에 정리하는 편이 낫다고 판단했기 때문. 아래 7절에도 기록.

## 3. DoD 9개 항목 검증 결과

1. **TOTP 설정(QR/시크릿)·확인·활성, 잘못된 코드 거부** — ✅. 유닛(`totp.test.ts`, `service.test.ts`)이 잘못된/오탈자 코드 거부를 증명. E2E `enableTotp` 헬퍼가 `/totp/start`→`/totp/confirm` 왕복을 실제 서버로 3개 테스트 모두에서 수행.
2. **이메일 2FA 설정·활성, 목 메일러로 코드 발송·검증** — ✅(유닛 레벨). `emailOtp.test.ts`/`service.test.ts`가 발송·해시·검증·1회용·레이트리밋을 `MemoryMailer`로 증명. **E2E는 커버하지 않음** — 4절의 한계 참고.
3. **2FA 유저 로컬 로그인 시 세션 없이 챌린지 → verify-login 후 세션** — ✅. `e2e/twofactor.spec.ts` 테스트 1: 재로그인 응답이 `{twoFactorRequired:true, method:"TOTP"}`(세션 토큰 없음)이고, `/login/2fa`에서 코드 제출 후에만 `/api/auth/refresh`가 성공.
4. **OAuth 로그인도 2FA 유저면 챌린지(우회 불가)** — ✅. 테스트 3: 로컬 계정에 카카오를 연동한 뒤 TOTP를 켜고 로그아웃, 같은 `mock_as`로 OAuth 로그인 시도 → `/login/2fa`로 리다이렉트되고 `refresh_token` 쿠키는 없고 `2fa_challenge` 쿠키만 있음을 직접 단언.
5. **이메일 OTP 폴백(TOTP 유저가 이메일로 통과)** — ✅. 최종 브랜치 리뷰에서 이 폴백이 로그인 계층에 실제로 배선돼 있지 않다는 지적을 받아 수정: `/api/auth/2fa/resend`가 챌린지의 `method`(EMAIL/TOTP 무관)와 상관없이 항상 `LOGIN_2FA` 이메일 코드를 발송하도록 고쳤고, `completeLoginTwoFactor`의 TOTP 분기를 "TOTP 코드 또는 유효한 LOGIN_2FA 이메일 코드"로 바꿨다(`verifyTotpFor(...) || verifyEmailOtp(...)`, fail-closed `default`는 그대로) — 이제 인증기를 잃은 TOTP 유저도 이메일로 로그인 챌린지를 통과하는 유일한 계정 복구 경로가 실제로 동작한다. `service.test.ts`에 TOTP 챌린지를 이메일 코드로 통과시키는 테스트와, 어느 쪽도 맞지 않으면 여전히 실패하는 테스트를 추가해 유닛 레벨로 증명했다. **E2E는 여전히 다루지 않음** — 4절에 적힌 대로 dev 메일러가 콘솔 목이라 발송된 코드 값을 Playwright가 읽어낼 방법이 없기 때문이며(실 SMTP는 범위 밖), 이 갭은 새로 생긴 게 아니라 그대로 남아 있다.
6. **2FA 해제·소셜 연동해제가 step-up 필요, 미통과 401** — ✅. 테스트 2: step_up 쿠키 없이 `/2fa/disable` → 401 `STEP_UP_REQUIRED`, `/step-up`(비번)로 재인증 후 `/2fa/disable` → 200. 소셜 연동해제 쪽은 유닛(`unlink/route.test.ts`)+이번 태스크가 실행 중 발견한 2절의 통합 이슈로 실제 동작(교차)이 재확인됨(단, 그 라우트 자체를 겨냥한 신규 E2E는 범위 밖이라 추가하지 않음 — 이미 유닛으로 커버됨).
7. **step-up 재인증(비번/TOTP/이메일) → step_up 쿠키 → 작업 통과** — ✅ 비번 경로는 E2E(테스트 2), TOTP·이메일 경로는 유닛(`service.test.ts`의 `checkStepUp` 3분기 테스트)으로 커버.
8. **OTP 1회용·만료·레이트리밋, 시크릿 암호화·코드 해시 저장, 로그·응답에 평문 없음, 전체 테스트 통과** — ✅. 4절의 psql·grep 실제 출력, `pnpm test`/`tsc`/`build`/`test:e2e`(2절의 알려진 예외 제외) 결과.
9. **2FA 설정·챌린지·재인증 UI 한/영 동작(E2E)** — ✅(한국어). `test.use({ locale: "ko-KR" })`로 `/login/2fa`의 한국어 제목·설명·"확인" 버튼을 실제 렌더로 검증(테스트 1). 영어 카탈로그는 태스크 7에서 `en.json`에 동일 키로 이미 채워졌고 두 페이지 모두 `useTranslations`/`getTranslations`만 쓰고 한국어를 하드코딩하지 않으므로 별도 E2E 없이 코드로 확인(oauth 워크로그의 전례와 동일한 근거).

## 4. 실행한 검증 명령과 실제 출력 요약

```
docker compose up -d db                 → Running (기존 컨테이너 재사용)
DATABASE_URL=postgresql://app:app@localhost:5432/app pnpm exec prisma migrate deploy
                                         → 3 migrations found, No pending migrations to apply.
pnpm exec tsc --noEmit                  → 출력 없음(클린)
pnpm test                               → Test Files 35 passed / Tests 271 passed
pnpm test:e2e                           → 16개 중 14 passed, 2 failed
                                           (e2e/twofactor.spec.ts 3/3 통과, e2e/health.spec.ts 2/2,
                                            e2e/auth.spec.ts 7/7 모두 통과 — 실패 2건은 e2e/oauth.spec.ts의
                                            unlink 관련 2건, 2절 참고. 단독 재실행(-g 없이 oauth.spec.ts만
                                            돌려도 동일하게 재현 — 병렬 실행 간섭이 아니라 결정적 실패)
pnpm exec playwright test e2e/twofactor.spec.ts (단독 재실행) → 3 passed (안정성 재확인)
pnpm build                               → 최초부터 성공(EPERM 없음). /api/auth/2fa/* 7개, /api/auth/step-up/*
                                            2개, /login/2fa, /settings/security 포함 전 라우트 동적(ƒ)으로 나열
```

**PII 점검 1 — EmailOtp.codeHash / User.totpSecret:**

`e2e/twofactor.spec.ts`는 브리프대로 TOTP·비번 step-up만 다루므로 실행 후 `EmailOtp` 테이블은 비어 있다(이메일 2FA 경로를 의도적으로 E2E에서 타지 않기 때문 — 4절 한계와 동일 이유). 이 컬럼이 실제로 bcrypt로 저장되는지 real row로 증명하기 위해, 로컬 dev 서버(`pnpm dev`, `docker compose`의 db 사용)를 잠깐 띄우고 `/api/auth/register`→`/api/auth/login`→`/api/auth/2fa/email/start`를 curl로 직접 호출해 실제 SETUP 목적 OTP 1건을 만들었다(이건 앱 자신의 API를 정상 호출한 것이지 DB에 손으로 쓴 게 아니다 — 이 태스크의 "read-only psql SELECT" 허용 범위 안에서, 검증 대상 행을 실제 프로덕션 코드 경로로 만들어낸 것):

```
docker compose exec -T db psql -U app -d app -c 'SELECT "codeHash", "purpose", "userId" FROM "EmailOtp" ORDER BY "createdAt" DESC LIMIT 3;'
```
```
                           codeHash                           | purpose |          userId
--------------------------------------------------------------+---------+---------------------------
 $2b$10$p9nZLCzIDCC7V7yKgPdUWe/sveEyh0AV8/S23u9S..kHpN/IZCa92 | SETUP   | cmrychkyf0000a4qitdq2y69r
(1 row)
```
`$2b$10$...` — bcrypt 해시(코드 평문 없음).

```
docker compose exec -T db psql -U app -d app -c 'SELECT "totpSecret" FROM "User" WHERE "totpSecret" IS NOT NULL LIMIT 3;'
```
```
                                       totpSecret
----------------------------------------------------------------------------------------
 K7C4qZnFjYncn/qS.j+kdP6K7wO7N/0SzAp6t5g==.bdS6qIH3EELLysLZ70MoLGc5lCDU5CcfmdIHgH1WjKk=
 5lv5KdOouZC+tILC.ODD8OgV6O7UCXK1kWUfnig==.eZnRQ2jdncA9EgzG5yLI8mLvJWOnty9mGCk+Q5xDaCs=
(2 rows)
```
`iv.tag.ciphertext`(AES-GCM) 형태 — 두 행 모두 `e2e/twofactor.spec.ts` 실행이 만든 TOTP 유저. 평문 base32 시크릿(예: `JBSWY3DPEHPK3PXP` 형태의 A-Z2-7 문자열)이 아니다.

**PII 점검 2 — 로그 grep:**
```
grep -rn "console.log" src/features/auth/twofactor src/app/api/auth/2fa src/app/api/auth/step-up
```
```
src/features/auth/twofactor/mailer.ts:18:    console.log("[MAILER] OTP 메일 발송(목)");
```
`ConsoleMailer.send`가 인자를 받지 않고 고정 문자열만 찍는 목 로그 — 수신자 이메일도, 코드도 남기지 않는다. 그 외 매치 없음.

## 5. 이메일 OTP E2E 커버리지 한계 (명시)

dev 환경의 메일러는 콘솔에 `"[MAILER] OTP 메일 발송(목)"`만 찍는 `ConsoleMailer`이고(위 grep 결과 참고), 실제로 발송된 코드 값은 어디에도 노출되지 않는다(로그·응답 모두). 그래서 E2E(Playwright, 실 서버·실 DB로 동작)는 이메일로 발송된 OTP 코드를 어떤 경로로도 읽어낼 수 없다 — TOTP처럼 클라이언트가 시크릿으로 코드를 스스로 계산할 방법이 없기 때문이다. 이 저장소는 처음부터 `getMailer()`가 목 구현만 반환하도록 설계돼 있어(실 SMTP는 범위 밖, M절), 이 한계는 인프라 선택의 직접적 결과다.

따라서:
- **이메일 2FA 로그인 챌린지·이메일 step-up 재인증은 E2E가 아니라 유닛/서비스 테스트로만 커버된다** — `emailOtp.test.ts`(발송·해시·검증·1회용·레이트리밋·purpose 격리), `service.test.ts`(`completeLoginTwoFactor`의 EMAIL 분기, `checkStepUp`의 email 분기, `confirmEmailOtpSetup`).
- `e2e/twofactor.spec.ts`는 브리프 지시대로 TOTP(코드를 otplib로 직접 계산 가능)와 비번 step-up(코드가 아니라 비번이라 E2E가 알고 있음)에 집중했다.
- 이는 태스크 8 브리프에 이미 명시된 결정이며(`.superpowers/sdd/task-8-brief.md` "이메일 OTP" 절), 새로 발견한 갭이 아니라 계획대로 실행한 결과다.

## 6. 파일 변경 (이 태스크)

- 생성: `e2e/twofactor.spec.ts`, `docs/worklog/2026-07-24-two-factor.md`(본 문서)
- `src/`, `prisma/schema.prisma`, `docker-compose.yml`은 이 태스크에서 손대지 않았다.

## 7. 남은 알려진 갭 (다음 단계로 이관)

- ~~`e2e/oauth.spec.ts` 2건이 이번 브랜치(태스크 6)의 step-up 게이팅과 통합되지 않았다(2절).~~ **해결됨(최종 브랜치 리뷰, 커밋 `1e552cf`)**: 두 테스트를 TOTP 기반 step-up(다중 자격증명 해제)과 "step-up 없이 해제는 거부된다" 게이트 테스트로 갱신해 그린으로 통과한다. 자세한 내용은 2절 갱신 노트.
- **마이그레이션 체크섬 드리프트(`20260723151030_auth_core`)** — ext-1 태스크10이 적용 이후의 SQL 파일 편집으로 발생, `migrate deploy`는 무해하지만 `migrate dev`가 막힌다. 태스크 1에서 처음 발견된 이래 이번 태스크까지 diff+deploy 폴백만 써 왔고 근본 해결(`prisma migrate resolve --applied` 등)은 아직 없음 — 유지보수 항목으로 계속 이관.
- **Task 3(ext-1)의 unlink 잔존 경합(READ COMMITTED 하 완전 동시 이종-provider unlink)** — ext-1 워크로그에서 이미 문서화된 항목, 이번 태스크로 새로 발생하거나 악화되지 않았음을 확인(코드 변경 없음, `unlinkIdentity`의 원자 delete 가드는 이번 브랜치가 손대지 않음).
- **최종 브랜치 opus 리뷰** — #1a-ext-1의 선례처럼 8개 태스크 전체를 가로지르는 교차 리뷰는 아직 수행되지 않았다. 이 워크로그는 태스크 8(E2E)까지의 기록이며, 최종 리뷰는 별도 단계로 남아 있다.
