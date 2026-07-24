# 프로필/계정관리(#1c) 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`).

**Goal:** 프로필(나/상대)·소개글·비번설정/변경·닉네임변경·탈퇴를 구현하고 민감작업에 step-up 재인증을 강제한다.

**Architecture:** `src/features/profile/`에 프로필·계정·탈퇴가드 서비스를 모으고 라우트는 얇게 위임. step-up(ext-2)·비번·세션폐기·crypto·감사 전부 재사용. **마이그레이션 없음**(감사 이벤트만 추가).

**Tech Stack:** Next.js 16, Prisma 7, zod 4, bcryptjs, next-intl 4, Vitest + Playwright.

**설계:** `docs/superpowers/specs/2026-07-24-profile-account-design.md`.

## Global Constraints

- **상대 프로필 PII 금지(중점):** `getPublicProfile`은 이메일·전화·연동신원상세·정확좌표 절대 미포함. 공개 subset(닉네임·소개글·동네문자열·전화인증배지·가입일)만.
- 내 프로필도 이메일·전화 **평문 미반환**(존재/검증 배지만).
- **민감작업 step-up:** 비번설정/변경·닉네임변경·탈퇴 라우트는 `requireRecentAuth`(ext-2) 먼저 + step_up userId == refresh userId.
- **비번변경 시 다른 세션 폐기**(현재 제외). **탈퇴 시 세션 전체 폐기**.
- **탈퇴 가드 스텁:** `assertWithdrawable` 인터페이스·게이트 실배선(지금 통과), #3/#5/#7이 실제 규칙 주입.
- 일반화 실패(비번 오류 일반 401). 로그·응답에 이메일·전화 평문 금지. 클라 에러 코드→카탈로그. UI 카탈로그 한/영 평어체.
- TypeScript strict. 짧은 한글 커밋, Co-Authored-By 금지. 브랜치 `feat/profile-account`. Node 빌트인 테스트 `// @vitest-environment node`.

## 실행 카덴스
🔴 적대적 리뷰(프로필·계정·탈퇴·라우트). 🟢 메인 점검(UI·E2E). 브랜치 하나, 최종 opus.

## File Structure
| 파일 | 책임 | 태스크 |
|---|---|---|
| `src/features/auth/audit.ts`(수정) | 5개 감사 이벤트 | 1 |
| `src/features/profile/service.ts` | getMy/getPublic/updateBio | 1 |
| `src/features/profile/account.ts` | setPassword/changePassword/changeNickname/withdraw | 2 |
| `src/features/profile/withdrawable.ts` | 탈퇴 가드 스텁 인터페이스 | 2 |
| `src/app/api/profile/*`·`auth/password/*`·`auth/withdraw` 라우트 | 얇은 라우트 | 3 |
| `src/features/profile/*.tsx` + `/mypage`·`/u/[nickname]` 페이지 | UI | 4 |
| `src/i18n/messages/*`(수정) | profile·account 카탈로그 | 4 |
| `e2e/profile.spec.ts`·워크로그 | E2E·기록 | 5 |

---

### Task 1 🔴: 프로필 서비스 + 감사 이벤트

**Files:** Modify `src/features/auth/audit.ts`; Create `src/features/profile/service.ts` + test.

**Interfaces:** `getMyProfile(db, userId)`, `getPublicProfile(db, nickname)`, `updateBio(db, userId, bio, meta)`, `bioSchema`(≤500).

- [ ] **Step 1: 감사 이벤트** — audit.ts AUTH_EVENTS에 `PROFILE_UPDATED`, `PASSWORD_SET`, `PASSWORD_CHANGED`, `NICKNAME_CHANGED`, `ACCOUNT_WITHDRAWN`.

- [ ] **Step 2: 테스트(RED)** `service.test.ts`(목 AuthDb):
  - `getMyProfile`: 반환에 `nickname/bio/region/phoneVerified/twoFactorMethod/identities(provider[])/hasPassword/createdAt`. **이메일·전화 평문 없음**(반환 JSON에 emailCiphertext/phoneCiphertext/평문 미포함), region은 regionCiphertext 복호화 결과.
  - `getPublicProfile`: 공개 subset만(`nickname/bio/region/phoneVerified/createdAt`), **이메일·전화·identities·lat/lng 없음**. 없거나 deletedAt→`AppError 404`.
  - `updateBio`: ≤500 검증(초과 400), 저장, PROFILE_UPDATED 감사.

- [ ] **Step 3: 구현** `service.ts` — getMyProfile은 select로 필요한 컬럼만 조회(emailCiphertext는 복호화 안 함, hasPassword=`passwordHash!=null`, phoneVerified=`phoneVerifiedAt!=null`, region=`regionCiphertext?decryptPII:null`, identities는 `authIdentity` 조회해 provider만). getPublicProfile은 nickname으로 조회, deletedAt 있으면 404, 공개 필드만 매핑. AuthDb에 authIdentity 이미 포함.

- [ ] **Step 4: 통과·커밋**
```bash
node_modules/.bin/vitest run src/features/profile && node_modules/.bin/tsc --noEmit
git add src/features/auth/audit.ts src/features/profile/service.ts src/features/profile/service.test.ts
git commit -m "프로필 조회·소개글 편집 서비스와 감사 이벤트 추가"
```

---

### Task 2 🔴: 계정 서비스 + 탈퇴 가드 스텁

**Files:** Create `src/features/profile/account.ts`, `withdrawable.ts` + tests.

**Interfaces:** `setPassword`, `changePassword`, `changeNickname`, `withdraw`, `nicknameSchema`, `passwordSchema`; `WithdrawGuard`/`defaultWithdrawGuard`/`assertWithdrawable`.

- [ ] **Step 1: 테스트(RED)** `withdrawable.test.ts` + `account.test.ts`(목 AuthDb):
  - `assertWithdrawable`(defaultGuard): 통과(no-op). 커스텀 가드가 throw하면 전파.
  - `setPassword`: passwordHash null일 때만 설정(bcrypt `$2` 저장), 이미 있으면 `AppError` (변경으로 유도). PASSWORD_SET 감사.
  - `changePassword`: 구비번 검증 성공→새 해시 저장 + **다른 세션 폐기**(`session.updateMany({where:{userId, id:{not:currentSessionId}, revokedAt:null}, data:{revokedAt}})`), PASSWORD_CHANGED. 구비번 틀림→일반 401(변경 안 됨).
  - `changeNickname`: 2~20 trim, 유니크(P2002→409 NICKNAME_TAKEN), NICKNAME_CHANGED.
  - `withdraw`: assertWithdrawable 통과→`deletedAt=now`+세션 전체 폐기, ACCOUNT_WITHDRAWN. 가드 위반(커스텀)→409 전파, deletedAt 안 세움.

- [ ] **Step 2: 구현** `withdrawable.ts`:
```ts
import type { AuthDb } from "@/features/auth/db";
export interface WithdrawGuard { assert(db: AuthDb, userId: string): Promise<void> }
// 지금은 통과. #3(거래중·판매완료7일)·#5(에스크로)·#7(예약중)이 실제 가드를 이 인터페이스로 주입/합성한다.
export const defaultWithdrawGuard: WithdrawGuard = { async assert() { /* no-op */ } };
export async function assertWithdrawable(db: AuthDb, userId: string, guard: WithdrawGuard = defaultWithdrawGuard): Promise<void> {
  await guard.assert(db, userId);
}
```
`account.ts` — 서비스 4개. changePassword/withdraw의 세션 폐기는 session 델리게이트 `updateMany`. currentSessionId는 라우트가 refresh 쿠키의 세션 조회로 전달(또는 생략 시 전체 폐기 후 재로그인 — 단순화 위해 changePassword는 currentSessionId 전달).

- [ ] **Step 3: 통과·커밋**
```bash
node_modules/.bin/vitest run src/features/profile && node_modules/.bin/tsc --noEmit
git add src/features/profile/account.ts src/features/profile/account.test.ts src/features/profile/withdrawable.ts src/features/profile/withdrawable.test.ts
git commit -m "비번 설정/변경·닉네임변경·탈퇴 서비스와 탈퇴 가드 스텁 추가"
```

---

### Task 3 🔴: 라우트 (프로필·비번·닉네임·탈퇴) + step-up 게이팅

**Files:** Create `src/app/api/profile/{me,[nickname],bio,nickname}/route.ts`, `src/app/api/auth/password/{set,change}/route.ts`, `src/app/api/auth/withdraw/route.ts`.

- [ ] **Step 1: 라우트 구현**
  - `GET /api/profile/me` — currentUserFromRefresh(401)→getMyProfile.
  - `GET /api/profile/[nickname]` — 공개, getPublicProfile(404).
  - `PATCH /api/profile/bio` — 로그인→updateBio.
  - `POST /api/auth/password/set`·`change`·`POST /api/profile/nickname`·`POST /api/auth/withdraw` — **step-up 게이트 헬퍼**: currentUserFromRefresh(401 UNAUTHENTICATED) → requireRecentAuth(req)(401 STEP_UP_REQUIRED) → step_up userId == refresh userId 확인(불일치 401) → 서비스 호출. (ext-2 unlink 라우트 패턴 재사용 — 공통 헬퍼 `requireStepUpUser(req)` 만들어 두 곳 DRY 가능하나 이번엔 로컬로.)
  - changePassword 라우트는 refresh 쿠키의 현재 세션 id를 조회해 currentSessionId로 전달(다른 세션만 폐기).

- [ ] **Step 2: 수동 검증** — dev에서: 비번 없는(OAuth) 유저 → step-up(이메일 OTP) → password/set → 이후 unlink 가능 확인. 비번 유저 password/change(step-up) → 다른 세션 폐기 확인. withdraw(step-up) → deletedAt + 로그인 불가. step-up 없이 각 라우트 401.

- [ ] **Step 3: 통과·커밋**
```bash
node_modules/.bin/vitest run && node_modules/.bin/tsc --noEmit
git add src/app/api/profile src/app/api/auth/password src/app/api/auth/withdraw
git commit -m "프로필·비번·닉네임·탈퇴 라우트와 step-up 게이팅 추가"
```

---

### Task 4 🟢: UI + 카탈로그

**Files:** Create `src/features/profile/{MyPage,PublicProfile,PasswordForm,NicknameForm,WithdrawForm}.tsx`(적절히 분할) + tests, `src/app/mypage/page.tsx`, `src/app/u/[nickname]/page.tsx`. Modify catalogs.

- [ ] **Step 1: 카탈로그** `profile.*`(마이페이지·소개글편집·저장·공개프로필·인증배지 등), `account.*`(비번설정/변경·현재비번·새비번·닉네임변경·탈퇴·탈퇴확인·에러 failed/taken/blocked/stepUpRequired). 양 로케일, 평어체.

- [ ] **Step 2: 컴포넌트(TDD)** — 기존 폼 패턴(fetch→코드→카탈로그, submitting, role=alert, StepUpPrompt 재사용):
  - MyPage: 내 프로필(GET /api/profile/me), 소개글 편집(PATCH bio), 계정관리 링크.
  - PublicProfile: 공개 subset 표시(좌표·PII 없음).
  - PasswordForm(설정/변경): step-up 401→StepUpPrompt→재시도. NicknameForm·WithdrawForm 동일 패턴. 탈퇴는 확인 프롬프트.
  - 테스트: 올바른 엔드포인트, 에러코드→카탈로그, 서버원문 미렌더, step-up 재시도.

- [ ] **Step 3: 페이지** — `/mypage`(SSR refresh 가드→getMyProfile), `/u/[nickname]`(공개, getPublicProfile 404). 서버 컴포넌트 얇게.

- [ ] **Step 4: 통과·빌드·커밋**
```bash
node_modules/.bin/vitest run && node_modules/.bin/tsc --noEmit && node_modules/.bin/next build
git add src/features/profile src/app/mypage src/app/u src/i18n/messages
git commit -m "마이페이지·공개프로필·계정관리 UI와 한/영 메시지 추가"
```

---

### Task 5 🟢: E2E + 워크로그

**Files:** Create `e2e/profile.spec.ts`, `docs/worklog/2026-07-24-profile-account.md`.

- [ ] **Step 1: E2E** — `test.use({locale:"ko-KR"})`, unique 유저:
  - 가입→로그인→/mypage 소개글 편집→저장 확인.
  - 공개 프로필 `/u/{nickname}` — 소개글·동네 표시, 이메일·전화 **없음**(페이지 HTML에 미포함 단언).
  - 비번 변경: step-up 없이 401 → /api/auth/step-up(비번)→step_up→password/change 성공.
  - 닉네임 변경(step-up), 중복 닉네임 409.
  - 탈퇴: step-up→withdraw→이후 로그인 401.
  - OAuth-only 유저 비번 설정 후 소셜 연동해제 가능(ext-1 갭 해소, API 레벨).

- [ ] **Step 2: 실행·PII 점검**
```bash
docker compose up -d db && node_modules/.bin/prisma migrate deploy && node_modules/.bin/playwright test
node_modules/.bin/tsc --noEmit && node_modules/.bin/vitest run && node_modules/.bin/next build
grep -rn "console.log" src/features/profile src/app/api/profile src/app/api/auth/password src/app/api/auth/withdraw
```
Expected: E2E green, grep 없음, 공개 프로필에 PII 없음.

- [ ] **Step 3: 워크로그·커밋** — 형식(무엇을/왜/결정/편차, 태스크 표, **검토 중점**(상대 PII 차단·세션 폐기·step-up), DoD 8항). 커밋:
```bash
git add e2e/profile.spec.ts docs/worklog/2026-07-24-profile-account.md
git commit -m "프로필·계정 E2E와 워크로그 추가"
```

---

## DoD — 설계 J절과 동일 (1~8)
## 범위 밖 — 실제 탈퇴 가드(#3/#5/#7), 상품·거래·채팅, RBAC(#2).
