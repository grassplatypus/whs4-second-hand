# 워크로그 — #1a-ext-1 소셜 OAuth 로그인

기록 원칙: 시간순, 각 항목은 **무엇을 / 왜 / 결정 / 편차·이슈**. 결과보다 결정의 흐름을 남긴다.

---

## 0. 스코프

- **무엇:** #1a 인증 코어 위에 소셜 OAuth 로그인·가입·연동/해제를 얹는다 — Google(실제 어댑터+키 없으면 목 폴백)·Kakao/Naver(항상 목) 3사, CSRF 방어된 state, passwordless OAuth 가입, 계정 연동(link)/해제(unlink), 마지막 자격증명 보호, `/settings/connections` 페이지.
- **왜:** #1a는 로컬 이메일·비번 인증까지만 다뤘다. `AuthIdentity` 모델은 #1a에서 이미 확장 가능 형태로 만들어 두었으므로, 이번 ext-1이 리모델링 없이 그 위에 실제 소셜 로그인 플로우를 구현한다.
- **결정:** 서브에이전트 구동(SDD), 태스크 6개로 분해, 브랜치 하나(`feat/oauth-login`, 새 브랜치 생성/전환/머지 금지). 카덴스는 태스크별 🔴(적대적 리뷰+fix루프)/🟢(구현+메인 diff점검) 혼합, 전 태스크 완료 후 별도 최종 opus 리뷰(이 워크로그 범위 밖 — 아직 수행 안 됨).

## 1. 태스크 실행 로그

| # | 태스크 | 결과 | 편차·결정 |
|---|--------|------|-----------|
| 1 | env(`OAUTH_STATE_SECRET`/`GOOGLE_*`/`APP_BASE_URL`)+`AuthDb`+감사이벤트+OAuth 어댑터(Google 실제/Kakao·Naver 목) | ✅ | `OAUTH_STATE_SECRET`이 필수(min 16)로 추가되며 `vitest.setup.ts`/`env.test.ts` fixture/`.env`/`.env.example`에 기계적으로 파급. `google.ts`에서 미사용 `getEnv` import 제거(동작 동일). Google은 `GOOGLE_CLIENT_ID`/`SECRET`/`REDIRECT_URI` 셋 다 있어야 실제 어댑터, 하나라도 없으면 목 — 이 저장소는 세 키 모두 미설정이라 Google도 항상 목으로 동작(DoD 6). |
| 2 | OAuth state CSRF(서명/검증/쿠키) | ✅ **1 fix loop 아님, 자발 보강** | HMAC 서명 위에서 검증, `timingSafeEqual` 앞에 length-guard(짧은 위조 서명이 크래시 없이 바로 거부되도록). 구현자가 브리프의 검증 테스트에 만료(exp) 케이스가 빠져 있음을 스스로 발견해 `vi.useFakeTimers`로 보강 테스트 추가 + mutation-check로 실제로 그 분기를 검증함을 확인. |
| 3 | OAuth 로그인/가입/연동/해제 서비스(`link.ts`)+`currentUserFromRefresh` | ✅ **1 fix loop** | 정책: 이메일 충돌 시 자동 연동 금지(`OAUTH_EMAIL_EXISTS`), passwordless 가입, 연동 소유권 충돌(`IDENTITY_TAKEN`), 마지막 자격증명 가드(`(passwordHash?1:0)+identities.length<=1`). **fix(Important):** 최초 구현은 읽기 후 `delete`라 서로 다른 provider에 대한 동시 unlink 2건이 둘 다 사전 읽기 검사를 통과할 수 있는 TOCTOU 경합 → 가드 조건을 `deleteMany`의 WHERE 절에 인코딩(`user.OR: [passwordHash not null, 다른 identity 존재]`)해 DB에서 원자적으로 강제, `count===0`이면 `LAST_CREDENTIAL`. P2002 동시경합 테스트, 멱등 링크의 감사로그 미호출 단언 추가. **KNOWN-GAP(잔존, 문서화):** READ COMMITTED 하에서 서로 다른 provider에 대한 완전 동시(진짜 동시) unlink 2건은 각 `deleteMany`의 관계 서브쿼리가 상대방 커밋 이전 스냅샷을 볼 수 있어 이 가드를 여전히 통과할 이론적 가능성이 있다 — 완전 차단에는 SERIALIZABLE+행잠금(`$transaction`)이 필요하나 `AuthDb`가 이를 노출하지 않음. 코드 주석·이번 워크로그·설계문서에 명시만 하고 이번 태스크에서는 해결하지 않음(passwordless 자해 엣지, 저빈도). |
| 4 | OAuth 라우트(start/callback/unlink) | ✅ | double-submit(쿼리 state == 쿠키 state, 둘 다 있어야 함) 후 `verifyState`. link 모드의 `userId`는 오직 서명된 state에서만 가져옴(쿼리·요청 바디 신뢰 안 함). 모든 리다이렉트 목적지는 `APP_BASE_URL` 기반 내부 고정 경로(`/login`, `/settings/connections`, `/`)뿐이라 open redirect 없음. 에러는 항상 코드만 쿼리에 실림(`error=oauth_failed` 등), 원문 메시지·토큰 노출 없음. state 쿠키는 성공·실패 모두 콜백에서 지움(1회용). 수동 검증(curl+psql)으로 위조 state 거부, link가 실제 세션 userId를 씀, 언인증 unlink 401을 확인. |
| 5 | UI(`SocialButtons`/`ConnectionsManager`/`/settings/connections`)+카탈로그(ko/en) | ✅ | 소셜 버튼은 순수 `<a>` 네비게이션 링크(클라이언트 상태 없음). 연동 페이지는 SSR에서 refresh 쿠키로 가드(서버 컴포넌트), 해제/에러 상호작용만 클라이언트 컴포넌트로 분리. unlink 실패는 서버 원문 `message`가 아니라 `code`→카탈로그 매핑만 렌더(`LAST_CREDENTIAL`/`IDENTITY_TAKEN`/그 외 `failed`). **편차(정당, 자체 테스트 기준):** 브리프의 `ConnectionsManager` 참조 JSX는 미연동 행을 `<span>{닉}</span> ... <a>{연결하기}</a>`로 그려 링크의 접근성 이름이 "연결하기"가 되는데, 브리프가 준 자기 테스트는 정확히 그 링크를 `getByRole("link", { name: "카카오로 계속하기" })`로 찾는다 — 참조 JSX가 자기 테스트를 통과하지 못함을 실측 확인 후, JSX를 미연동 행도 단일 `<a>`가 provider 라벨 자체를 텍스트로 갖도록 수정(카탈로그 문구·엔드포인트·에러매핑 로직은 불변, DOM 구조만 조정). Task 6 E2E가 바로 이 접근성 이름으로 요소를 찾으므로 이 수정이 필수였음. |
| 6 | E2E+PII 점검+준수 노트+워크로그 | ✅ (본 문서) | 아래 2절 참고 — E2E 실행 중 Playwright 픽스처 관련 편차 2건 발견, 전부 `e2e/oauth.spec.ts` 내에서만 처리(`src/` 미변경). |

## 2. 태스크 6: E2E에서 드러난 편차 2건 (모두 `e2e/oauth.spec.ts` 내에서 처리, `src/` 미변경)

1. **Playwright 최상위 `request` 픽스처는 브라우저 `context`의 쿠키 저장소와 별개다.** 브리프 원문은 `test("...", async ({ page, context, request }) => { ... await request.post("/api/auth/refresh") ... })` 형태로, `page.goto`(브라우저 내비게이션)로 발급받은 `refresh_token` 쿠키를 그대로 `request.post`가 실어 보낼 것을 전제한다. 실측 결과 이 전제는 틀렸다 — 디버그 스펙으로 직접 확인(`docker compose up -d db` 상태에서 같은 refresh_token 쿠키로 plain `request.post("/api/auth/refresh")` → 401, 같은 시점 `context.request.post(...)` → 200). Playwright 1.61에서 최상위 `request` 픽스처는 독립된 `APIRequestContext`(자체 쿠키 저장소)이고, `context.request`만 그 브라우저 컨텍스트와 쿠키를 공유한다. `src/`의 인증 로직 문제가 아니라 순수 테스트 픽스처 배선 문제이므로, 쿠키를 태워야 하는 유일한 호출(`me1 = ... refresh`)만 `context.request.post(...)`로 교체했다. Authorization 헤더만 쓰는 `/me` 호출과, 아직 아무 쿠키도 없는 시점의 `register` 호출은 브리프 원문대로 `request`를 그대로 썼다.
2. **Next.js route-announcer의 `role="alert"` 충돌 (#1a 태스크 10에서 이미 한 번 발견된 것과 동일 클래스).** "last-credential unlink is refused" 테스트가 `page.getByRole("alert")`로 에러 배너를 찾는데, Next가 접근성용으로 심어두는 `__next-route-announcer__` div도 `role="alert"`라 strict-mode에서 2개 요소와 충돌(`getByRole('alert') resolved to 2 elements`). `e2e/auth.spec.ts`가 이미 쓰고 있는 것과 동일한 패턴(`.filter({ hasText: ... })`)으로 우리 배너만 좁혀 해결.

두 가지 모두 (a) 테스트 실행 환경(Playwright 픽스처의 쿠키 격리 정책)과 브리프 리터럴 코드 간의 전제 불일치, (b) 프레임워크가 심는 접근성 엘리먼트와의 셀렉터 충돌 — 이므로 `e2e/oauth.spec.ts` 안에서만 수정했고 `src/`는 손대지 않았다.

## 3. DoD 8개 항목 검증 결과

1. **목 3사로 소셜 가입 → passwordless User + AuthIdentity, refresh 쿠키, `/me` 동작** — ✅. E2E 테스트 1(카카오)·2(구글)에서 가입 직후 `refresh_token` 쿠키 확인, `context.request.post("/api/auth/refresh")`로 access 토큰 취득, `/api/auth/me`가 Bearer 토큰으로 200. psql로 해당 유저의 `passwordHash IS NULL`(아래 4절) 확인.
2. **소셜 재로그인 시 기존 User(중복 생성 없음)** — ✅. 같은 `mock_as=alice`로 가입 1회 후, 테스트 흐름상 `/settings/connections`에서 "연결 해제" 버튼이 정확히 1개(카카오만)임을 확인 — 만약 재로그인이 새 User를 만들었다면 이 페이지는 카카오 신원이 다른 User에 붙어 보이지 않거나 세션 자체가 꼬였을 것. `mock.ts`의 결정적 파생(`providerUserId = "{slug}-{handle}"`)과 `loginOrRegisterWithOAuth`의 `authIdentity.findUnique` 우선 조회가 이를 보장.
3. **OAuth 이메일 충돌 시 자동 연동 안 함** — ✅. E2E 4번째 테스트: 로컬 가입으로 `kakao.{carol}@example.com`을 먼저 선점 → 같은 이메일을 만드는 카카오 mock으로 OAuth 시도 → `/login?error=email_exists`로 리다이렉트(자동 연동도, 로그인도 되지 않음).
4. **연동/해제 동작, 마지막 자격증명 해제 거부** — ✅. E2E 1번째 테스트에서 네이버 연동(`?link=1`) 후 "연결 해제" 버튼 2개, 네이버 해제 후 1개로 감소. 2번째 테스트("last-credential unlink is refused")에서 구글 1개만 연동된 유저가 해제 시도 → 409 + `role="alert"` 배너 "마지막 로그인 수단이라 해제할 수 없어요".
5. **state 위조·불일치 콜백 거부** — ✅. E2E 3번째 테스트: state 쿠키 없이(따라서 쿠키-쿼리 double-submit 불일치) 콜백 직접 호출 → `/login?error=oauth_failed`.
6. **`GOOGLE_*` 있으면 실제 Google(수동), 없으면 목으로 전 기능·테스트** — ✅ (Task 1에서 구현·검증, 이 저장소는 `GOOGLE_*` 셋 다 미설정이라 Google도 항상 목 경로로 E2E·유닛 전부 통과). 실제 Google 어댑터 코드 경로는 이번 태스크에서 재검증하지 않음(네트워크 필요, 범위 밖).
7. **로그·감사·응답·리다이렉트에 평문 이메일 없음, 전체 테스트 통과** — ✅. 아래 4절의 psql·grep 실제 출력, `pnpm test`/`tsc`/`build`/`test:e2e` 전부 green.
8. **소셜 버튼·연동 페이지 한/영 동작** — ✅. E2E가 `test.use({ locale: "ko-KR" })`로 한국어 렌더를 검증("카카오로 계속하기", "연결 해제", 에러 카탈로그 문구). 영어 카탈로그는 Task 5에서 `en.json`에 동일 키로 이미 채워졌고 `NEXT_LOCALE` 쿠키 스위칭은 `/login`·`/signup`과 동일한 기존 i18n 배선을 그대로 재사용하므로 별도 E2E 없이 코드로 확인(연동 페이지·소셜 버튼 컴포넌트 둘 다 `useTranslations("auth.oauth")`/`getTranslations("auth.oauth")`만 쓰고 한국어 문자열을 하드코딩하지 않음).

## 4. 실행한 검증 명령과 실제 출력 요약

```
docker compose up -d db                 → Running (기존 컨테이너 재사용)
DATABASE_URL=postgresql://app:app@localhost:5432/app pnpm exec prisma migrate deploy
                                         → 2 migrations found, No pending migrations to apply.
pnpm test:e2e                           → 13 passed (재실행 2회 모두 13/13: health 2 + auth 7 + oauth 4)
pnpm test                               → Test Files 25 passed / Tests 170 passed
pnpm exec tsc --noEmit                  → 출력 없음(클린)
pnpm build                              → 최초 1회 EPERM(.next 캐시, OneDrive/Windows 파일락 — #1a 태스크 5·10과 동일한
                                           기존 이슈, src와 무관) → rm -rf .next 후 재빌드 성공, /api/auth/oauth/[provider]/*
                                           3개 + /settings/connections 포함 전 라우트 동적(ƒ)으로 나열
```

**PII 점검 1 — OAuth 유저(passwordHash NULL)의 이메일 컬럼:**
```
docker compose exec -T db psql -U app -d app -c 'SELECT "emailCiphertext","emailBlindIndex","passwordHash" FROM "User" WHERE "passwordHash" IS NULL LIMIT 3;'
```
```
                                        emailCiphertext                                         |                         emailBlindIndex                          | passwordHash
--------------------------------------------------------------------------------------------------+--------------------------------------------------------------------+--------------
 zZjjDJe9K/kFgwvc.us91AXkm5EHLhXElm1HTFA==.mHPEy6Fa0A2Mp/URlZxY5LKRhP/w16k=                       | cc3aef147d4dcc6428467dd5b5e5171aef8f6abe26fd3ba17ab0731a4d30c5ae  |
 Uw30+USwDJQFNOSy.+M4B7V58kh71MKJaB2VOjw==.SeN2Wwy3S2K5neiyTUh0vAhxc4X9dZA=                       | 6cb3b80f135ecca784cfb166467be282ecf04600d393c8d555123312813c6eee  |
 LBjsfI8tLATrTxoU.+mPSn7ocMY59+FeV2XaO/g==.c4PoR1nuo5mKEVdiU1euzlaAeeWxVweNqdd/99+FF2cWiQVgFw==   | 614bd2639f31919aafce6af760bf4ff82cd4a537638926d7fb9d8a3e4d658a81  |
(3 rows)
```
세 행 모두 이번 E2E 실행이 만든 OAuth 유저(alice/bob 등)다. `emailCiphertext`는 `iv.tag.ciphertext`(AES-GCM) 형태, `emailBlindIndex`는 HMAC 다이제스트, `passwordHash`는 빈 값(NULL, passwordless) — 평문 이메일 전무.

**PII 점검 2 — 로그 grep:**
```
grep -rn "console.log" src/features/auth/oauth src/app/api/auth/oauth
```
출력 없음(exit 1, 매치 없음).

## 5. 파일 변경 (이 태스크)

- 생성: `e2e/oauth.spec.ts`, `docs/worklog/2026-07-24-oauth-login.md`(본 문서)
- 수정: `docs/superpowers/specs/2026-07-18-auth-core-design.md`("알려진 갭 / 수용한 트레이드오프" 절에 OAuth 이메일 존재 노출 트레이드오프 한 줄 추가)

`src/`, `prisma/schema.prisma`, `docker-compose.yml`은 이 태스크에서 손대지 않았다.

## 6. 이번 태스크에서 새로 발견/처리한 리뷰 지적

이번 태스크는 Task 1~5처럼 코드 리뷰 게이트가 있는 태스크가 아니라 E2E+문서화 태스크였다. E2E 실행 자체가 드러낸 이슈는 2절에 정리한 2건(둘 다 테스트 픽스처/프레임워크 상호작용, `src/` 결함 아님)이 전부다. Task 1~5에서 이미 기록된 리뷰 지적(구현 편차)은 위 1절 표에 요약해 옮겼으며, 자체 새 발견은 없었다.

## 7. 남은 알려진 갭 (다음 단계로 이관)

- **Task 3의 unlink 잔존 경합** — READ COMMITTED 하 완전 동시 서로 다른-provider unlink 2건. `$transaction` 노출이 필요해 `AuthDb` 확장이 선행돼야 함. 이번 태스크의 E2E는 순차적 unlink만 검증(동시성 침투 테스트는 범위 밖) — 잔존 갭 그대로 유지, 위 1절·설계문서에 기록.
- **OAuth 이메일 존재 노출** — `OAUTH_EMAIL_EXISTS`는 §F(계정 존재 여부 공개, #1a에서 이미 트레이드오프로 수용한 것)의 연장선. 이번 태스크에서 설계문서에 한 줄 추가로 명시(본 문서 5절, `docs/superpowers/specs/2026-07-18-auth-core-design.md`).
- **최종 브랜치 opus 리뷰** — #1a의 선례(`feat/auth-core-final-fixes`)처럼 6개 태스크 전체를 가로지르는 교차 리뷰는 아직 수행되지 않았다. 이 워크로그는 태스크 6(E2E)까지의 기록이며, 최종 리뷰는 별도 단계로 남아 있다.
