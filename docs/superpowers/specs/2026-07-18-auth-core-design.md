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

- **1a 인증 코어** (이 문서): 암호화, User 모델, 가입·중복체크·로그인, JWT 회전 세션, 인증 컨텍스트, PIPA baseline
- **1b 위치+전화인증 어댑터**: Geocoder(주소→좌표)·PhoneVerifier(Octomo) 어댑터(목/실제 토글), 가입 플로우 통합
- **1c 프로필/마이페이지**: 프로필(나/상대), 소개글·비번변경·탈퇴, 탈퇴 제한 규칙(#3/#5 스텁 인터페이스)

## 확정 결정 (브레인스토밍)

- 외부 연동: **어댑터 + 목/실제 토글**(1b에서 구현). 키 없어도 목으로 전 기능·테스트 동작.
- PII 암호화: **AES-256-GCM**(랜덤 IV, authTag, 놀러블별) + **HMAC-SHA256 blind index**(유니크·조회). 암호키·HMAC키 env 분리.
- 세션: **DB(Postgres) 저장 refresh + 회전 + 재사용 감지**. Redis 미도입(대규모/이미 운용 시 값어치, 첫 도입은 #4 채팅 presence가 적합).
- 비밀번호: bcrypt(salt 포함).

## A. 데이터 모델 (Prisma)

```prisma
enum Role { USER SUSPENDED ADMIN }   // RBAC 강제는 #2, 여기선 컬럼만

model User {
  id             String    @id @default(cuid())
  nickname       String    @unique
  passwordHash   String
  emailCiphertext String                       // AES-256-GCM
  emailBlindIndex String   @unique             // HMAC-SHA256(정규화 이메일)
  phoneCiphertext String
  phoneBlindIndex String                       // 전화(1a 미검증 저장, 검증 1b)
  bio            String?
  role           Role      @default(USER)
  lat            Float?                          // 위치는 1b 지오코딩
  lng            Float?
  address        String?
  consentedAt    DateTime                        // 개인정보 수집 동의
  deletedAt      DateTime?                        // soft delete(파기)
  createdAt      DateTime  @default(now())
  updatedAt      DateTime  @updatedAt
  sessions       Session[]
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

## F. PIPA 준수 baseline

- **수집최소화**: 명세 필수 필드만(이메일·전화·닉네임·비번·주소·동의). 그 외 수집 안 함.
- **동의**: 가입 시 필수 동의 캡처(`consentedAt`), 미동의 가입 차단.
- **암호화**: 이메일·전화 GCM at-rest, 비번 bcrypt, 키 분리.
- **접근로그**: 인증 이벤트 `AuthAuditLog` 기록(userId·event·ip·ua). 평문 PII 미기록.
- **파기권**: soft delete(`deletedAt`) 기반(실 파기 플로우·탈퇴규칙은 1c).
- **적대적 준수 리뷰**: 각 태스크 리뷰에 PII 누출·암호화·로그 마스킹·에러 안전성 점검 포함 + 1a 종료 시 준수 감사(체크리스트 대조).

## G. 범위 밖 (1a, 명시)

- 주소→좌표 지오코딩, Daum 우편번호, Octomo 전화검증 → 1b
- 프로필/마이페이지(소개글·비번변경·탈퇴), 탈퇴 제한 규칙 → 1c
- RBAC 권한 게이트 강제(SUSPENDED 전면차단 등) → #2
- 상품/거래 의존 탈퇴 가드(거래중·예약중·판매완료7일) → #3/#5 (1c에서 스텁 인터페이스)

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
