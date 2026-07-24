# 워크로그 — #1c 프로필/계정관리(내·상대 프로필, 소개글, 비번/닉네임 변경, 탈퇴, step-up 게이팅)

기록 원칙: 시간순, 각 항목은 **무엇을 / 왜 / 결정 / 편차·이슈**. 결과보다 결정의 흐름을 남긴다.

---

## 0. 스코프

- **무엇:** #1a(인증 코어)+#1a-ext-1(OAuth)+#1a-ext-2(2FA·step-up) 위에, 내 프로필/상대 공개 프로필 조회, 소개글 편집, 비밀번호 설정(OAuth 전용 계정)/변경, 닉네임 변경, 회원 탈퇴(소프트 삭제)를 얹는다 — 비번 변경·닉네임 변경·탈퇴는 민감 작업이라 ext-2의 step-up 재인증을 강제한다. `/mypage`·`/u/[nickname]` 페이지 포함.
- **왜:** 중고거래 플랫폼에서 "상대 프로필"은 신뢰(동네·전화인증 배지)를 보여주되 이메일·전화번호·정확좌표 같은 PII는 절대 노출하면 안 되고, 비번/닉네임 변경·탈퇴 같은 계정 소유권이 걸린 작업은 세션 탈취만으로는 못 하게(재인증 필요) 막아야 한다. 이번 서브프로젝트의 검토 중점 자체가 "상대 프로필 PII 차단·비번변경 세션폐기·민감작업 step-up" 세 가지다.
- **결정:** 서브에이전트 구동(SDD), 태스크 5개, 브랜치 하나(`feat/profile-account`, 새 브랜치 생성/전환/머지 금지). 카덴스는 태스크 1~3 🔴(적대적 리뷰+fix루프 — PII 경계·세션폐기·step-up 게이트가 보안 핵심), 태스크 4~5 🟢(구현+메인 diff점검). 마이그레이션 없음(감사 이벤트 5종만 `audit.ts`에 추가) — 이번 서브프로젝트가 스키마를 건드리지 않은 유일한 사례.

## 1. 태스크 실행 로그

| # | 태스크 | 결과 | 편차·결정 |
|---|--------|------|-----------|
| 1 | `getMyProfile`/`getPublicProfile`/`updateBio`(`src/features/profile/service.ts`) + 감사 이벤트 5종 | ✅ 적대적 리뷰 clean (commit f704f39) | 난이도 중 — 상대 PII 차단이 핵심. `getPublicProfile`은 select에도 반환 리터럴에도 이메일/전화/식별정보/좌표를 아예 넣지 않는다(스프레드 없이 5필드 명시 리터럴). "leaky row"(모든 컬럼을 가진 목 객체)로 안전 부분집합만 새는지 증명하는 테스트를 추가. `getMyProfile`도 emailCiphertext/phoneCiphertext는 select 자체에서 뺀다. soft-delete 유저는 없는 유저와 동일한 404(존재 여부 미구분). 347/347. |
| 2 | `setPassword`/`changePassword`/`changeNickname`/`withdraw`(`account.ts`) + 탈퇴 가드 스텁(`withdrawable.ts`) | ✅ 적대적 리뷰 clean (commit 6dbbc6f) | 난이도 중상. `setPassword`는 이미 비번이 있으면 409로 거부(변경은 change 전용) — **ext-1의 "마지막 인증수단" 갭을 여기서 닫는다**: OAuth 전용 계정이 비번을 세팅하면 이후 소셜 연동 해제 시 last-credential 가드를 안전하게 통과할 길이 생긴다. `changePassword`는 성공 시 현재 세션만 남기고 나머지 세션 전부 폐기, 틀린 구비번은 계정 존재/비번유무를 구분 못 하는 일반 401(`dummyVerify`로 같은 bcrypt 비용). `withdraw`는 가드(`assertWithdrawable`)를 먼저 통과해야 `deletedAt`을 찍고, 통과 시 전 세션 폐기. `withdrawable.ts`는 지금은 무조건 통과(no-op)하는 스텁 인터페이스로 남기고 #3/#5/#7이 실제 규칙(거래중·에스크로·예약중)을 주입하도록 설계. 369/369. Minor(setPassword의 TOCTOU — 두 탭에서 동시 첫 설정) 이관. |
| 3 | 라우트 7개(`profile/{me,[nickname],bio,nickname}`, `auth/password/{set,change}`, `auth/withdraw`) + step-up 게이팅 | ✅ 적대적 리뷰 clean after 1 fix (commits 09894fa+880eabc) | 난이도 상 — 민감 라우트 4개(`password/set`·`password/change`·`profile/nickname`·`auth/withdraw`) 전부 `requireRecentAuth`로 step_up 쿠키를 확인하고, **step_up의 userId가 refresh 세션의 userId와 다르면 여전히 401 STEP_UP_REQUIRED**(다른 유저의 재인증을 빌려 쓸 수 없음)를 정확히 확인. `changePassword` 라우트는 refresh 쿠키로 현재 세션 row를 다시 찾아 `currentSessionId`를 넘겨 "현재 세션만 살리고 나머지 폐기"를 정확히 구현. `withdraw` 라우트는 성공 시 `clearRefreshCookie()`도 같이 내려 클라이언트 쿠키까지 지운다. fix(Important): `GET /api/profile/[nickname]`이 Next.js가 이미 디코드한 `nickname` 파라미터를 다시 `decodeURIComponent`해 `%` 포함 닉네임에서 500이 나던 버그 → 이중 디코드 제거로 수정. profile 라우트 12/12. |
| 4 | UI(`MyPage`/`PublicProfile`/`PasswordForm`/`NicknameForm`/`WithdrawForm`) + `/mypage`·`/u/[nickname]` 페이지 + 한/영 카탈로그 | ✅ 메인 diff점검 통과 (commit 8963dda) | 난이도 중. 민감 작업 폼(비번/닉네임/탈퇴) 전부 ext-2의 `StepUpPrompt`를 재사용 — 401 STEP_UP_REQUIRED를 받으면 재인증 프롬프트를 띄우고 성공 시 같은 제출을 재시도한다(새 UI 패턴을 만들지 않음). `PublicProfile`은 `phoneVerified` 배지만 표시(전화번호 자체는 타입에도 없음). 413/413, build green. |
| 5 | E2E(`e2e/profile.spec.ts`) + PII 점검 + 워크로그(본 문서) | ✅ (본 문서, **실 버그 1건 발견·리포트**) | 아래 2~8절 참고. |

## 2. E2E 테스트 목록과 결과 (`e2e/profile.spec.ts`, 6개 테스트)

1. **register→login→`/mypage` 소개글 편집·저장(페이지 레벨) → 공개 프로필에 반영, 이메일·전화 미노출** — ✅.
   - 페이지 레벨: `/mypage` 방문 시 "마이페이지" 제목·닉네임·"아직 소개글이 없어요"가 먼저 보이고, "수정하기"→소개글 입력→"저장" 클릭 시 "저장했어요"와 새 소개글이 실제 렌더로 반영됨을 확인.
   - 같은 세션으로 `/api/auth/location`을 호출해 동네를 하나 심어 둔 뒤 `/u/{nickname}` 방문: 닉네임 heading·소개글·동네 문자열이 보임.
   - PII 미노출(페이지): 등록 시 실제로 쓴 이메일 문자열과 전화번호(`010-1234-5678`) 정확한 값을 미리 알고 있는 채로 `page.content()` 전체에 그 문자열이 없는지 직접 단언(location.spec.ts의 "실제 유출 후보 값을 겨눈 검증" 선례와 동일 접근).
   - PII 미노출(API): `GET /api/profile/{nickname}` 응답의 키 집합이 정확히 `{nickname,bio,region,phoneVerified,createdAt}` 뿐임(`Object.keys(...).sort()` 단언)과, 직렬화된 응답 문자열에 이메일/전화가 없음을 확인.
2. **비밀번호 변경: step-up 쿠키 없이 401 → step-up 후 성공, 새 비번으로만 재로그인된다** — ✅. `POST /api/auth/password/change`를 step_up 없이 호출 → `401 STEP_UP_REQUIRED`. `POST /api/auth/step-up {method:'password',password}` → `step_up` 쿠키 발급 → 변경 성공. 로그아웃 후 **옛 비번으로 로그인 시도는 401**, **새 비번으로만 로그인 성공** — 단순히 200을 확인하는 데 그치지 않고 실제로 비번이 바뀌었음을 재로그인으로 증명.
3. **닉네임 변경은 step-up이 필요하고, 성공 시 반영된다** — ✅. step-up 없이 `POST /api/profile/nickname` → 401. step-up 후 새 고유 닉네임으로 변경 → 200, `GET /api/profile/me`로 반영 확인.
4. **중복 닉네임으로 변경 시도 → 409여야 하지만, 확인된 버그로 500이 난다** — `test.fail()`로 표시(3절 참고). **이번 태스크에서 새로 발견한 실 버그**를 감추지 않고 그대로 단언(409를 기대)해 둔 테스트다.
5. **회원 탈퇴: step-up→withdraw→세션 폐기, 이후 로그인은 실패한다(소프트 삭제)** — ✅. step-up 없이 탈퇴 시도 → 401. step-up 후 탈퇴 → 200. **탈퇴 직후 같은 refresh 쿠키로 `/api/auth/refresh` 호출도 401**(세션이 실제로 죽었음 — 라우트가 내려주는 `clearRefreshCookie`뿐 아니라 서버 쪽 세션 자체도 폐기됐음을 별도로 증명). 이어서 같은 이메일/비번으로 재로그인 시도 → `401 AUTH_FAILED`(계정 없음과 구분 안 되는 일반 에러).
6. **cross-user step-up 거부: A의 step_up 쿠키로는 B의 민감 작업을 통과할 수 없다** — ✅. 독립된 쿠키 저장소가 필요해 `request.newContext()`로 별도 `APIRequestContext` 두 개(A/B)를 만들어, A의 `step_up` 쿠키 값과 B의 `refresh_token` 쿠키 값을 **한 요청에 수동으로 조합**(`headers: { cookie: "refresh_token=<B>; step_up=<A>" }` — e2e/auth.spec.ts의 "재사용된 refresh 토큰" 테스트가 쓰는 수동 쿠키 오버라이드 패턴과 동일 기법)해 B 계정으로 `password/change`를 호출. 라우트가 `step_up.sub(A) !== refresh.userId(B)`를 정확히 걸러내 여전히 `401 STEP_UP_REQUIRED`임을 확인 — 이 서브프로젝트 검토 중점("민감작업 step-up") 중 가장 직접적인 우회 시도를 막는 테스트다.

## 3. 발견한 실 버그 — 닉네임 중복 변경 시 409 대신 500 (수정하지 않음, 리포트만)

**증상:** 이미 다른 유저가 쓰고 있는 닉네임으로 `POST /api/profile/nickname`을 호출하면(step-up은 정상 통과한 상태) `409 NICKNAME_TAKEN`이 나와야 하는데 실제로는 `500 INTERNAL`이 난다.

**원인(직접 재현해 확인):** `src/features/profile/account.ts`의 `isUniqueConstraintViolationOn`(및 `src/features/auth/register.ts`의 동명 헬퍼)은 Prisma의 P2002 에러가 `err.meta.target`에 충돌한 컬럼명 배열을 담고 있다고 가정한다 — 두 파일의 유닛 테스트(`account.test.ts`/`register.test.ts` 계열)도 정확히 그 가정으로 `{ code: "P2002", meta: { target: ["nickname"] } }` 모양을 목킹해 통과시킨다. 그런데 이 저장소는 `@prisma/adapter-pg`(드라이버 어댑터) 경로로 Postgres에 접속하고, 이 경로에서 실제 Prisma 7.8이 던지는 P2002 에러의 `meta`는

```
meta: {
  modelName: 'User',
  driverAdapterError: DriverAdapterError {
    cause: { originalCode: '23505', kind: 'UniqueConstraintViolation', constraint: { fields: ['nickname'] }, ... }
  }
}
```

형태였다 — `meta.target` 배열 자체가 없다. 임시 스크립트(`node`+`@prisma/adapter-pg`+실 Postgres, 이번 태스크에서만 쓰고 커밋 전 삭제)로 직접 두 유저를 만들고 닉네임 충돌 update를 일으켜 `util.inspect`로 원본 에러 구조를 캡처해 확인했다(위 구조 그대로). 그 결과 `isUniqueConstraintViolationOn`의 `Array.isArray(target)` 체크가 항상 `false`가 되어 원본 `PrismaClientKnownRequestError`가 그대로 다시 던져지고, `withErrorHandling`의 캐치-올 분기가 이를 `500 INTERNAL`로 매핑한다.

**영향 범위:**
- `changeNickname`(`account.ts`) — 사전 조회 없이 이 catch에만 의존 → **닉네임 중복 변경은 지금 프로덕션에서도 500이 난다.** 이번 태스크가 새로 만든 결함이 아니라 태스크 2에서 이미 심어진 결함이며, 지금까지 E2E/수동 검증 어디서도 실 Postgres로 이 경로를 때린 적이 없어 이제야 드러났다.
- `registerUser`(`register.ts`)의 동일 catch 분기는 가입 전에 `findFirst`로 먼저 사전 확인을 하기 때문에(동시 가입 경합 때만 이 catch에 도달) 일반적인 순차 E2E/수동 테스트에서는 가려져 있다 — 하지만 **동시에 같은 닉네임/이메일로 두 가입 요청이 경합하면 똑같이 500이 날 잠재적 결함**이다.

**보안/PII 성격이 아니다(그래서 STOP 대신 리포트 후 계속):** 이 버그는 데이터 유출·인가 우회가 아니라 순수 에러-매핑 결함이다(step-up 게이트·PII 경계는 모두 정상 — 위 1·6 테스트로 별도 확인됨). 태스크 브리프의 "public profile leaks PII / route not step-up-gated면 STOP" 조건에는 해당하지 않아 계속 진행했다. 다만 src 수정은 이 태스크의 권한 밖(`e2e/profile.spec.ts`·워크로그만 생성/수정 허용)이라 **고치지 않았다** — `e2e/profile.spec.ts`의 4번 테스트가 `test.fail()`로 "지금은 이게 실패하는 게 맞다"만 표시해 두고 있으며, 실제로 고쳐지면(=409가 되면) 그 테스트가 오히려 실패로 잡혀 알려준다.

**제안(다음 유지보수 태스크로 이관):** `isUniqueConstraintViolationOn`을 드라이버 어댑터 에러 모양(`meta.driverAdapterError.cause.constraint.fields` 또는 `originalMessage` 문자열 매칭)까지 함께 보도록 고치거나, Prisma의 공식 헬퍼(`err instanceof Prisma.PrismaClientKnownRequestError && err.code==='P2002'`로 감지하되 컬럼 판별은 `constraint.fields`/`originalMessage`로 대체)로 교체해야 한다. `account.ts`·`register.ts` 두 곳 다 고쳐야 하고, 두 파일의 유닛 테스트가 목킹하는 P2002 모양도 실측값으로 갱신해야 한다.

## 4. E2E 커버리지의 의도적 축소 — OAuth-only 비번설정 후 연동해제 (브리프 대비 편차)

초기 브리프(`.superpowers/sdd/task-5-brief.md`)의 시나리오 목록에는 "OAuth-only 유저 비번 설정 후 소셜 연동해제 가능(ext-1 갭 해소, API 레벨)"이 있었지만, 이번 태스크를 실제로 지시한 작업 지시(6개 항목: 소개글 편집/공개프로필 PII/비번변경/닉네임변경·중복/탈퇴/cross-user step-up)에는 이 시나리오가 빠져 있었다. 지시가 더 구체적이고 최신이라 판단해 그쪽을 따랐고, 이 플로우는 **E2E로 새로 드라이빙하지 않았다** — 대신:
- `src/features/profile/account.test.ts`의 `setPassword` 테스트가 OAuth 전용(passwordHash null) 계정에 비번이 세팅되고 `PASSWORD_SET`이 감사되는지, 이미 비번이 있으면 409로 거부되는지(ext-1 갭이 실제로 닫혔는지)를 유닛 레벨로 증명한다.
- `src/app/api/auth/password/set/route.test.ts`가 라우트의 step-up 게이팅(같은 유저 일치까지)을 증명한다.
- `e2e/oauth.spec.ts`(1c 이전 태스크에서 이미 존재)의 "unlink without step-up is refused" 테스트가, last-credential 가드 이전에 step-up 게이트가 선다는 것을 API 레벨로 이미 커버하고 있다.

즉 "비번 세팅"과 "그 이후 연동 해제"라는 두 조각은 각각 유닛/기존 E2E로 커버되어 있지만, 이번 태스크가 **그 둘을 이어 붙인 end-to-end 흐름을 새로 E2E화하지는 않았다** — 이는 새로 발견한 갭이 아니라 이번 태스크의 실제 작업 지시를 따른 결과다.

## 5. DoD 8개 항목 검증 결과

1. **내/상대 프로필 조회, 상대에 PII 없음** — ✅. 유닛(getPublicProfile의 leaky-row 테스트, 태스크 1)+E2E(2절 테스트 1: 페이지·API 양쪽에서 실제 이메일/전화 문자열 부재를 직접 단언).
2. **소개글 편집(길이제한)** — ✅. 유닛(bioSchema 500자 제한, 태스크 1)+E2E(2절 테스트 1: 실제 편집→저장→반영).
3. **OAuth-only 유저 비번 설정 → 이후 소셜 연동해제 가능(ext-1 갭 해소)** — ✅(유닛+기존 E2E 조합, 4절에 명시한 편차대로 새 end-to-end E2E는 없음). `setPassword`가 이미 비번 있으면 거부·없으면만 설정(태스크 2), route 테스트가 step-up 게이팅 확인, `e2e/oauth.spec.ts`가 unlink의 step-up 게이트를 별도 커버.
4. **비번 변경(step-up, 다른세션 폐기), 닉네임 변경(유니크·step-up)** — 부분 ✅. 비번 변경은 E2E(2절 테스트 2)로 실제 재로그인까지 증명, 다른 세션 폐기는 유닛(`account.test.ts`, 태스크 2)으로 증명(이번 E2E는 세션 폐기까지 별도로 재증명하지 않음 — 단일 세션 시나리오만 사용). 닉네임 변경 자체(step-up)는 E2E(테스트 3)로 성공 경로 증명하지만, **유니크 위반의 409 매핑은 3절에 기록한 실 버그로 현재 500** — 이 서브항목은 코드 결함으로 미충족 상태이며 다음 유지보수 태스크로 이관.
5. **탈퇴(step-up, soft-delete, 세션 폐기, 이후 로그인 불가), 탈퇴 가드 스텁 인터페이스** — ✅. E2E(2절 테스트 5)로 step-up 게이트·탈퇴 후 즉시 세션 폐기(같은 쿠키로 refresh도 401)·재로그인 불가까지 전부 실증. psql로 `deletedAt`·`Session.revokedAt`도 직접 확인(6절). 탈퇴 가드 스텁은 태스크 2에서 인터페이스만(`defaultWithdrawGuard`가 no-op) 완료 — 실제 규칙은 범위 밖(#3/#5/#7).
6. **민감작업 전부 step-up 강제, 미통과 401** — ✅. E2E(2절 테스트 2·3·5가 각 라우트에서 step-up 없이 401 STEP_UP_REQUIRED를 확인)+**cross-user 우회 시도까지 막힘을 별도로 증명**(2절 테스트 6 — 이 서브프로젝트 검토 중점의 핵심 우회 시나리오).
7. **전체 테스트 통과, 로그·응답 PII 평문 없음** — 조건부 ✅. E2E 25/25(3절의 버그 테스트는 `test.fail()`로 "예상된 실패"로 명시적으로 분리돼 있어 전체 실행은 초록으로 끝나지만, 그 안에 실 버그 1건이 리포트돼 있음을 숨기지 않는다). 유닛 413/413, tsc clean, build green. grep으로 대상 경로에 `console.log` 없음 확인(7절).
8. **UI 한/영** — ✅(태스크 4에서 완료, 이번 태스크에서 별도 영어 E2E는 새로 만들지 않음 — location-phone 워크로그의 선례와 동일 근거: 두 페이지 모두 `useTranslations`/`getTranslations`만 쓰고 한국어를 하드코딩하지 않음).

## 6. 실행한 검증 명령과 실제 출력

pnpm이 이 환경 PATH에 없어(node만 `/c/Program Files/nodejs`에 존재) 브리프가 준 대체 명령을 그대로 썼다. Playwright 설정의 `webServer: { command: "pnpm dev" }`도 pnpm이 없으면 실행할 수 없어, `next dev`를 직접 백그라운드로 띄운 뒤(`reuseExistingServer: !process.env.CI`가 이미 떠 있는 서버를 그대로 씀) `playwright test`를 돌리고, 끝나면 그 서버를 내리고 `next build`를 별도로 실행했다.

```
docker compose up -d db
                                                          → Running (기존 컨테이너 재사용)
DATABASE_URL=postgresql://app:app@localhost:5432/app node node_modules/prisma/build/index.js migrate deploy
                                                          → 4 migrations found, No pending migrations to apply.
node node_modules/next/dist/bin/next dev                 → (백그라운드) Ready in 451ms — 이후 playwright가 재사용
DATABASE_URL=postgresql://app:app@localhost:5432/app node node_modules/@playwright/test/cli.js test --reporter=list
                                                          → 25 passed (0 failed)
                                                            (health 2/2, auth 7/7, location 3/3, twofactor 3/3,
                                                             oauth 4/4, profile 6/6 — profile의 "중복 닉네임" 테스트는
                                                             test.fail()로 표시된 예상된 실패, 통계상 passed로 집계)
node node_modules/vitest/vitest.mjs run                  → Test Files 59 passed / Tests 413 passed
node node_modules/typescript/bin/tsc --noEmit            → 출력 없음(클린)
(next dev 프로세스 종료 후)
node node_modules/next/dist/bin/next build               → 성공(Turbopack). 39개 라우트 전부 동적(ƒ),
                                                            profile 5라우트(`/api/profile/{me,bio,nickname,[nickname]}`,
                                                            `/mypage`)·계정 3라우트(`/api/auth/password/{set,change}`,
                                                            `/api/auth/withdraw`)·`/u/[nickname]` 포함
```

**PII 점검 — 로그 grep:**
```
grep -rn "console.log" src/features/profile src/app/api/profile src/app/api/auth/password src/app/api/auth/withdraw
```
```
(출력 없음 — 매치 0건)
```

**PII/탈퇴 점검 — psql:**
```
docker compose exec -T db psql -U app -d app -c 'SELECT nickname, "deletedAt" FROM "User" WHERE "deletedAt" IS NOT NULL ORDER BY "createdAt" DESC LIMIT 5;'
```
```
    nickname    |        deletedAt
----------------+-------------------------
 e2emryl7vel790 | 2026-07-24 06:57:03.036
 e2emryl1s4b511 | 2026-07-24 06:52:18.626
 taskC4205      | 2026-07-24 06:23:25.993
(3 rows)
```
(위 2개 행은 이번 `e2e/profile.spec.ts` 실행이 만든 탈퇴 유저 — `deletedAt`이 실제로 세워짐을 확인.)
```
docker compose exec -T db psql -U app -d app -c 'SELECT u.nickname, s."revokedAt" IS NOT NULL AS revoked FROM "Session" s JOIN "User" u ON u.id = s."userId" WHERE u.nickname = '\''e2emryl7vel790'\'';'
```
```
    nickname    | revoked
----------------+---------
 e2emryl7vel790 | t
(1 row)
```
탈퇴한 유저의 세션이 실제로 `revokedAt` 세팅돼 있음(soft-delete와 세션 폐기가 DB 레벨에서 실제로 일어났음을 직접 확인).

## 7. 파일 변경 (이 태스크)

- 생성: `e2e/profile.spec.ts`, `docs/worklog/2026-07-24-profile-account.md`(본 문서)
- `src/`, `prisma/schema.prisma`, `docker-compose.yml`, `playwright.config.ts`는 이 태스크에서 손대지 않았다. 3절의 실 버그 재현에 쓴 임시 디버그 스크립트(`debug-p2002.mjs`, 저장소 루트에 잠깐 생성)는 원인 확인 직후 삭제했고 커밋에 포함되지 않았다.

## 8. 남은 알려진 갭 (다음 단계로 이관)

- **닉네임 중복 변경 500 버그(3절, Important급)** — `isUniqueConstraintViolationOn`이 `@prisma/adapter-pg` 경로의 실제 P2002 에러 모양(`meta.driverAdapterError...`)을 인식하지 못해 `account.ts`(닉네임 변경)에서 409 대신 500이 난다. `register.ts`의 동일 헬퍼도 동시가입 경합에서 잠재적으로 같은 결함. 유닛 테스트의 P2002 목이 실측과 다르다는 것도 함께 갱신 필요.
- **마이그레이션 체크섬 드리프트(`20260723151030_auth_core`)** — ext-1 이후 계속 이관되던 항목. 이번 태스크는 `migrate deploy`만 썼고(무해) `migrate dev`를 시도하지 않아 재확인하지 않았다.
- **setPassword TOCTOU(태스크 2 Minor 이관, 미해결)** — 두 탭에서 동시에 첫 비번 설정을 시도하는 경합. 이번 태스크에서 새로 확인하거나 고치지 않았다.
- **OAuth-only 비번설정→연동해제 end-to-end E2E 부재(4절)** — 새 갭이 아니라 이번 태스크 지시를 따른 의도적 축소. 유닛+기존 `oauth.spec.ts`로 조각조각 커버돼 있다.
- **최종 브랜치 opus 리뷰** — #1a-ext-1·#1a-ext-2·#1b의 선례처럼 태스크 1~5 전체를 가로지르는 교차 리뷰는 아직 수행되지 않았다. 이 워크로그는 태스크 5(E2E)까지의 기록이며, 최종 리뷰는 별도 단계로 남아 있다.
