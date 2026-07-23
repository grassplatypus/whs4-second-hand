# #1a 인증 코어 설계

작성일: 2026-07-18
상태: 승인됨 (구현 대기)
상위: #1 인증+회원+위치 (1a→1b→1c 분할). 선행: #0 인프라 뼈대(완료).

## 목적

회원 신원 기반을 구축: 가입/중복체크/로그인, JWT access/refresh 회전 세션(재사용 감지),
PII(이메일·전화) 유출 대비 암호화(AES-256-GCM) + 검색용 blind index(HMAC), PIPA 준수 baseline.

**범위 원칙:** 유저가 가입하고 로그인해서 인증된 세션을 갖는 것까지. 위치 지오코딩·전화검증(1b),
프로필/마이페이지/탈퇴(1c), RBAC 강제(#2)는 제외.

## #1 분할 (참고)

- **1a 인증 코어** (이 문서): 암호화, User 모델(OAuth·2FA 확장 가능 형태), 로컬 가입·중복체크·로그인, JWT 회전 세션, 인증 컨텍스트, 재인증 원칙, PIPA baseline
- **1a-ext 소셜+2FA**: Google/Kakao/Naver OAuth(어댑터 목/실제), 계정 연동/해제, TOTP·이메일 2차 인증 설정·강제
- **1b 위치+전화인증 어댑터**: Geocoder(주소→좌표)·PhoneVerifier(Octomo) 어댑터(목/실제 토글), 가입 플로우 통합
- **1c 프로필/마이페이지**: 프로필(나/상대), 소개글·비번변경·탈퇴, 탈퇴 제한 규칙(#3/#5 스텁 인터페이스), 민감작업 재인증 강제

## 확정 결정 (브레인스토밍)

- 외부 연동: **어댑터 + 목/실제 토글**(1b에서 구현). 키 없어도 목으로 전 기능·테스트 동작.
- PII 암호화: **AES-256-GCM**(랜덤 IV, authTag, 놀러블별) + **HMAC-SHA256 blind index**(유니크·조회). 암호키·HMAC키 env 분리.
- 세션: **DB(Postgres) 저장 refresh + 회전 + 재사용 감지**. Redis 미도입(대규모/이미 운용 시 값어치, 첫 도입은 #4 채팅 presence가 적합).
- 비밀번호: bcrypt(salt 포함).
- **소셜 로그인 passwordless**: OAuth 가입은 비번 없이 생성(비번 강제 안 함 — 업계 표준·보안·UX). 로컬 비번은 계정설정에서 선택적 추가. 한 User = [로컬 비번 0~1] + [OAuth 신원 0~N] 조합, 연동/해제 가능.
- **2차 인증**: TOTP(Google OTP 등) 또는 이메일 OTP를 유저별 옵션으로. (설정·강제는 1a-ext)
- **민감작업 재인증(step-up)**: 개인정보 변경·비번 설정/변경·탈퇴 등은 재인증 필요. 수단은 보유 자격증명에 따라 — 비번 유저=비번 확인, OAuth-only 유저=연동 OAuth 중 하나로 재인증, 2FA 켠 유저=2FA. (강제 구현은 1a-ext/1c, 원칙은 1a 모델·설계에 반영)
- 모델은 1a에서 확장 가능 형태로 완성(리모델링 방지), OAuth·2FA **구현**은 1a-ext.
- **주소/위치 프라이버시**: 상세주소(건물·호·층) **미수집** — 동/읍/면 **동네 수준만**(수집최소화). 동네주소 문자열은 `regionCiphertext`로 AES-GCM 암호화. 반경검색(#3)은 원본 주소가 아닌 **동네 중심 좌표(lat/lng, 거칠게)** 로 haversine 계산 → 집 특정 불가하면서 반경필터 충족. 정확좌표 별도 저장 안 함(YAGNI). 실제 지오코딩·좌표 산출은 1b.

## A. 데이터 모델 (Prisma)

```prisma
enum Role { USER SUSPENDED ADMIN }        // RBAC 강제는 #2, 여기선 컬럼만
enum OAuthProvider { GOOGLE KAKAO NAVER } // LOCAL 자격증명은 User.passwordHash로 표현
enum TwoFactorMethod { NONE TOTP EMAIL }

model User {
  id             String    @id @default(cuid())
  nickname       String    @unique
  passwordHash   String?                        // nullable: OAuth-only 유저는 없음(passwordless)
  emailCiphertext String                        // AES-256-GCM (OAuth는 제공자 이메일 사용)
  emailBlindIndex String   @unique              // HMAC-SHA256(정규화 이메일)
  phoneCiphertext String?                        // nullable: OAuth 가입 시 없을 수 있음
  phoneBlindIndex String?                        // 전화(있으면 1a 미검증 저장, 검증 1b)
  bio            String?
  role           Role      @default(USER)
  lat            Float?                          // 동네 중심 좌표(거칠게), 반경검색용. 지오코딩은 1b
  lng            Float?                          // haversine 검색·인덱싱 대상(#3)
  regionCiphertext String?                       // 동네주소(동/읍/면 수준)만, AES-GCM 암호화. 상세주소 미수집
  twoFactorMethod TwoFactorMethod @default(NONE) // 2FA 옵션(설정·강제는 1a-ext)
  totpSecret     String?                          // TOTP 시크릿(AES-GCM 암호화 저장)
  consentedAt    DateTime                         // 개인정보 수집 동의
  deletedAt      DateTime?                        // soft delete(파기)
  createdAt      DateTime  @default(now())
  updatedAt      DateTime  @updatedAt
  sessions       Session[]
  identities     AuthIdentity[]
}

model AuthIdentity {                              // 소셜 신원 연동(구현 1a-ext, 모델은 1a)
  id             String        @id @default(cuid())
  userId         String
  user           User          @relation(fields: [userId], references: [id], onDelete: Cascade)
  provider       OAuthProvider
  providerUserId String                          // 제공자측 고유 id
  emailAtProvider String?
  linkedAt       DateTime      @default(now())
  @@unique([provider, providerUserId])           // 한 소셜 계정은 한 User에만
  @@index([userId])
}

model Session {                                  // refresh 회전
  id           String    @id @default(cuid())
  userId       String
  user         User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  familyId     String                            // 회전 체인(재사용 감지 단위)
  tokenHash    String    @unique                 // refresh 토큰 SHA-256 해시
  expiresAt    DateTime
  revokedAt    DateTime?
  replacedById String?                           // 회전 시 다음 세션 id
  createdAt    DateTime  @default(now())
  @@index([userId])
  @@index([familyId])
}

model AuthAuditLog {                             // PIPA 접근로그
  id        String   @id @default(cuid())
  userId    String?
  event     String                              // REGISTER|LOGIN|LOGIN_FAIL|REFRESH|REUSE_DETECTED|LOGOUT
  ip        String?
  ua        String?
  createdAt DateTime @default(now())
  @@index([userId])
}
```

- 기존 #0 `User`(id/email/lat/lng/createdAt 스텁)를 이 모델로 대체. 마이그레이션으로 컬럼 전환.
- 로그·에러에 PII 평문 저장 금지(userId만).

## B. 암호화 유틸 (`src/features/_shared/crypto.ts`)

- `encryptPII(plain: string): string` — AES-256-GCM. 출력 포맷 `base64(iv).base64(authTag).base64(ciphertext)`. 랜덤 IV 매회.
- `decryptPII(payload: string): string` — 역변환, authTag 검증(변조 감지).
- `blindIndex(plain: string): string` — HMAC-SHA256(normalize(plain)). 이메일은 lowercase+trim, 전화는 숫자만. 결정성 → 유니크·조회.
- 키: `AES_KEY`(기존 32바이트) + `BLIND_INDEX_KEY`(신규, env 추가). `env.ts` 스키마에 `BLIND_INDEX_KEY`(min 32) 추가. `.env`/`.env.example` 갱신.
- 키는 데이터와 분리(env 주입), 로그에 노출 금지.

## C. 세션/JWT (`src/features/auth/`)

- **access**: JWT(HS256, `JWT_ACCESS_SECRET`), TTL 15분, payload `{ sub: userId, role }`. 무상태 검증.
- **refresh**: 암호학적 랜덤 토큰(예: 32바이트 base64url). 원본은 클라이언트 HttpOnly+Secure+SameSite=Lax 쿠키에만, DB엔 SHA-256 해시(`tokenHash`)만. TTL 14일.
- **회전**: `/api/auth/refresh` 호출 시 — 쿠키 refresh 해시로 Session 조회 → 유효(미폐기·미만료)면 새 access+refresh 발급, 구 세션 `revokedAt`+`replacedById` 기록(rotation), sliding(만료 연장).
- **재사용 감지**: 조회된 세션이 이미 `revokedAt` 있음(이미 회전된 토큰 재사용) → 해당 `familyId` 전체 세션 폐기 + `REUSE_DETECTED` 감사로그 + 401.
- **인증 컨텍스트**: `getCurrentUser(req)` — access 검증 → `{ userId, role }` 또는 null. RBAC 강제(SUSPENDED 차단 등)는 #2; 1a는 컨텍스트 제공까지.

## D. 엔드포인트 (`src/app/api/auth/*`, 로직은 `features/auth`)

모두 `withErrorHandling` 래핑, 응답 `{code,message}`(에러) 또는 안전 페이로드, PII 평문 미노출.

- `POST /api/auth/register` — body: email, phone, nickname, password, passwordConfirm, consent(bool). 검증: zod, 비번확인 일치, 동의 필수, 중복(nickname/emailBlindIndex). 처리: bcrypt 해시, PII 암호화+blind index, User 생성, `consentedAt` 기록, REGISTER 로그. (주소·좌표는 1b)
- `GET /api/auth/check-availability?nickname=|email=` — blind index/닉네임 유니크 조회 → `{ available: boolean }`.
- `POST /api/auth/login` — body: email, password. emailBlindIndex 조회 → bcrypt 비교 → 성공 시 세션 생성+토큰 발급+쿠키, LOGIN 로그. 실패 시 LOGIN_FAIL 로그 + 일반화된 401(계정존재 여부 미누출).
- `POST /api/auth/refresh` — 쿠키 refresh → 회전 or 재사용감지. 성공 REFRESH 로그.
- `POST /api/auth/logout` — 현재 세션 폐기 + 쿠키 삭제 + LOGOUT 로그.

## E. 페이지 (`src/app`, i18n 한/영 평어체)

- `/signup` — 가입 폼(이메일·전화·닉네임·비번·비번확인·동의 체크). 실시간 중복체크. 성공 시 로그인 페이지/자동로그인.
- `/login` — 로그인 폼. 실패 시 친근한 안내("이메일이나 비밀번호를 다시 확인해 주세요").
- 텍스트는 메시지 카탈로그(ko/en). 프로필·마이페이지는 1c.

## F. PIPA 준수 baseline (비례적 — demo/소규모 기준)

**방침:** demo·소규모는 PIPA 무거운 의무의 **규모 문턱**(유출신고 1천명, 내역통지 100만명·민감 5만명, 강화 안전조치 대규모) **전부 미달**. 문턱 없는 코드레벨 기본만 비례적으로 구현. 나머지는 실런칭 이관.

**Keep (1a에서 구현 — 싸고 유출 시 실효):**
- **수집최소화**: 명세 필수 필드만(이메일·전화·닉네임·비번·동네주소·동의). 상세주소 미수집, 동/읍/면 수준까지만. 그 외 수집 안 함.
- **동의**: 가입 시 필수 동의 캡처(`consentedAt`), 미동의 가입 차단.
- **암호화**: 이메일·전화 AES-GCM at-rest, 비번 bcrypt(일방향), 키 분리. (안전성 확보조치 고시 최소요건 충족)
- **접근로그**: 인증 이벤트 `AuthAuditLog` 기록(userId·event·ip·ua). 평문 PII 미기록.
- **파기**: soft delete(`deletedAt`) 기반(실 파기 플로우·탈퇴는 1c).
- **경량 준수 리뷰**: 각 태스크 리뷰에 PII 로그 누출·암호화·에러 마스킹 점검 포함(무거운 감사 아님, 체크리스트 대조).

**Defer (실런칭 전 이관 — demo 불필요):**
- 개인정보 처리방침 법무문서 공개(30조), 보호책임자(CPO) 지정(31조)
- 유출 통지·신고 절차(34조) — 코드 아닌 운영 프로세스. 감사로그로 근거만 확보.
- 수집·이용 내역 통지(20조의2, 100만명↑ 대상)
- 접속기록 법정 보관기간(6개월~2년) 인프라
- 국외 유저 대상 시 GDPR(72h 통지·portability)·CCPA(판매 opt-out)
- 상세 조문 비교는 `docs/compliance/` 레퍼런스 참조(작성 시).

## G. 범위 밖 (1a, 명시)

- **소셜 OAuth 로그인·연동 구현**(Google/Kakao/Naver 어댑터, 콜백, 연동/해제), **2FA 설정·강제**(TOTP·이메일), 민감작업 재인증 강제 → **1a-ext**. (모델·원칙만 1a)
- 주소→좌표 지오코딩, Daum 우편번호, Octomo 전화검증 → 1b
- 프로필/마이페이지(소개글·비번변경·탈퇴), 탈퇴 제한 규칙 → 1c
- RBAC 권한 게이트 강제(SUSPENDED 전면차단 등) → #2
- 상품/거래 의존 탈퇴 가드(거래중·예약중·판매완료7일) → #3/#5 (1c에서 스텁 인터페이스)

## 참고: 1a 모델은 확장 완성, 구현은 로컬 인증만

1a에서 `AuthIdentity`·`TwoFactor`(User.twoFactorMethod/totpSecret) 테이블·컬럼을 **마이그레이션에 포함**해 이후 1a-ext가 리모델링 없이 얹힘. 단 1a의 **구현·엔드포인트·테스트는 로컬 인증**(이메일+비번)만 다룸. `totpSecret`은 `encryptPII`로 암호화 저장(구현은 1a-ext).

## H. 테스트

- **crypto**: 암복호화 왕복, authTag 변조 감지, blind index 결정성(같은 입력=같은 출력)·정규화(대소문자/공백/전화 포맷).
- **register**: 정상, 비번 불일치, 미동의, 닉네임/이메일 중복.
- **login**: 성공, 잘못된 비번, 없는 계정(둘 다 일반화 401).
- **session**: refresh 회전(새 토큰·구 폐기), 재사용 감지(family 폐기), 만료 거부.
- **통합/E2E**: 가입→로그인→인증필요 동작→로그아웃 (Playwright). 
- 테스트·로그 출력에 PII 평문 없음 확인.

## 완료 기준 (DoD)

1. 가입 → DB에 이메일/전화 암호문+blind index 저장(평문 없음), 비번 bcrypt
2. 중복 이메일/닉네임 가입 차단, 중복체크 API 동작
3. 로그인 성공 시 access JWT + HttpOnly refresh 쿠키 발급
4. refresh 회전 동작, 회전된 토큰 재사용 시 family 폐기 + 401
5. 인증 이벤트 감사로그 기록, 로그/에러에 PII 평문 없음
6. `/signup` `/login` 페이지 한/영 동작(E2E)
7. 전체 테스트 통과, prod 에러 마스킹 유지
8. PIPA 준수 체크리스트 대조 통과

## 커밋/브랜치 (준수)
- 브랜치 `feat/auth-core`, 짧고 간결한 한글 커밋, Co-Authored-By 금지
- 워크로그 `docs/worklog/`에 결정 흐름 기록

## 알려진 갭 / 수용한 트레이드오프

(최종 브랜치 리뷰(opus), 2026-07-24, `feat/auth-core-final-fixes`에서 추가. 태스크 단위 리뷰로는
보이지 않던 브랜치 전체 관점의 결정 기록.)

1. **계정 존재 여부 공개.** 로그인 실패는 계정 존재 여부를 숨기지만(§D, 일반화된 401),
   `check-availability`와 가입 409 `EMAIL_TAKEN`은 같은 사실(이 이메일로 가입된 계정이 있다/없다)을
   무인증·무제한으로 알려준다. 이는 §D가 요구하는 기능(실시간 중복체크)의 본질적 특성이라 유지하되,
   **의도적으로 수용한 트레이드오프**임을 여기 명시한다.
2. **레이트리밋 없음.** 로그인·가입·중복체크 어디에도 요청 제한이 없다. 현재 브루트포스 비용은
   bcrypt cost 10(~60ms/회)뿐이고 중복체크는 그마저도 없다(공짜). 위 1번과 결합되면 계정 열거가
   실용적인 공격이 된다. **소유자: #2(RBAC) 또는 1a-ext 후속**으로 이관한다.
3. **access 토큰 잔존 창.** `context.ts`(`getCurrentUser`)는 의도적으로 무상태 — access JWT만
   검증하고 DB를 보지 않는다. 따라서 로그아웃, family 폐기(재사용 감지), 소프트 삭제(탈퇴) 이후에도
   이미 발급된 access 토큰은 만료 시각(최대 15분)까지 계속 유효하다. 설계상 수용한 결과이지만,
   **#2 RBAC이 이 창을 닫을 책임을 질지(예: 토큰 버전/블랙리스트 도입)는 아직 결정되지 않았고
   여기 기록만 남긴다.**
4. **클라이언트 토큰 보관 미구현.** 로그인 응답의 access 토큰을 저장(localStorage/메모리 등)하거나
   이후 요청에 실어 보내는 코드가 `src/`에 없다. `/signup`·`/login` 페이지에서 서로에게, 혹은 홈으로
   가는 내비게이션 링크도 없다. 1a는 API 계층(가입/로그인/refresh/logout/me)까지가 범위이며,
   **클라이언트 세션 배선과 내비게이션은 1c 소유**임을 여기 명시한다.
5. **동시 refresh 2건이 family를 죽인다.** `rotateSession`의 CAS 클레임 덕분에 회전 자체는 원자적이라
   포크(같은 부모 아래 자식 2개)는 방지되지만, CAS에서 패배한 요청의 쿠키는 곧 "이미 폐기된 토큰"이
   되므로 그 클라이언트가 재시도하면 재사용 감지가 발동해 **승자까지 포함해 family 전체가 로그아웃**된다.
   유예 창(grace period)이 없다. 클라이언트에 refresh 스케줄러/동시성 제어가 생기는 시점(1c)에
   재검토 대상으로 기록한다.
6. **`JWT_REFRESH_SECRET` 미사용 — 제거함.** 1a는 refresh 토큰을 서명이 아니라 랜덤 바이트 +
   SHA-256 해시로 결정한다(`session.ts`/`tokens.ts`). 즉 어떤 코드도 `JWT_REFRESH_SECRET`을 읽지
   않았다. "예약됨" 주석으로 남기는 대신 **제거**를 택해 `src/features/_shared/env.ts`,
   `vitest.setup.ts`, `.env`, `.env.example`에서 함께 정리했다.
7. **마이그레이션 전제 — 빈 테이블.** `prisma/migrations/20260723151030_auth_core/migration.sql`은
   `DROP COLUMN "email"`과 여러 NOT NULL 컬럼 추가를 백필 없이 수행한다. `User` 테이블이 비어 있다는
   전제(이 프로젝트의 현재 단계)에서만 안전하며, SQL 파일 상단에 그 전제를 주석으로 남겼다.
8. **쿠키 `Secure` 조건부.** §C(세션/JWT)는 refresh 쿠키가 "무조건 Secure"라고 적었지만, 실제
   구현(`cookies.ts`)은 `NODE_ENV === "production"`일 때만 `Secure`를 붙인다(dev는 http라 Secure면
   쿠키 자체가 브라우저에서 버려지기 때문). 설계 문서 대비 구현 편차이며, 의도적이다.
- OAuth 이메일 충돌 시 `OAUTH_EMAIL_EXISTS` 안내는 계정 존재를 드러낸다(OAuth 플로우 본질 — 그 provider 이메일 통제 증명). 자동 연동을 막기 위한 의도적 노출. (ext-1)
