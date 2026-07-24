# #1b 위치(지오코딩) + 전화인증 설계

작성일: 2026-07-24
상태: 승인됨 (자율 결정 — 아래 결정 근거 문서화)
상위: #1 인증+회원+위치. 선행: #1a/ext-1/ext-2(완료, master).
문서화 방침(goal): 이 대단계의 주요 내용·검토/중점을 스펙(결정)·워크로그(진행·리뷰)로 남긴다.

## 목적

가입/회원의 **위치**(동네 수준 좌표)와 **전화 신뢰**(SMS 인증)를 어댑터(목/실제 토글)로 붙인다.
좌표는 #3 거리검색(haversine)의 입력, 전화인증은 신뢰·중복가입 억제 기반.

**범위 원칙:** 주소→동네 좌표 지오코딩 + 전화 SMS 인증 + 서비스·라우트·가입/설정 통합까지. 거리검색 쿼리는 #3, 프로필 UI 고도화는 1c.

## 확정 결정 (자율 — 근거)

- **어댑터 목/실제 토글**(#1a 원칙 계승): 키 없으면 목으로 전 기능·테스트 동작. Geocoder 실제 = Kakao Local API(주소검색), PhoneVerifier 실제 = Octomo SMS. 키(`KAKAO_LOCAL_API_KEY`, `OCTOMO_*`) 없으면 목.
- **주소 프라이버시(1a 계승, 최중점):** 상세주소 미수집. 동네 수준(시/도 + 시/군/구 + 동/읍/면)만 수집. 지오코딩 결과 좌표는 **동네 중심으로 거칠게 반올림**(예: 소수 2자리 ≈ 1.1km 격자)해 집 특정 불가. 원본 동네 문자열은 `regionCiphertext`(AES-GCM). 정확좌표 저장 안 함(YAGNI).
  - *검토 중점:* 지오코더가 반환한 상세좌표를 그대로 저장하면 프라이버시 붕괴 → 서비스 계층에서 **저장 직전 반올림**을 강제하고, 상세주소 문자열이 어디에도 안 남는지 리뷰.
- **전화 코드 저장:** SMS 6자리 코드는 bcrypt 해시로 `PhoneOtp` 테이블에 저장(EmailOtp 패턴 계승), 5분 만료, 1회용(`consumedAt`), 재발송 레이트리밋. 평문 코드는 SMS 본문에만.
- **전화 검증 상태:** `User.phoneVerifiedAt` 컬럼 추가. 검증 성공 시 기록. `phoneBlindIndex`로 이미 검증된 다른 계정과 중복 확인(한 전화 = 한 검증계정, 선택적 강제).
- **가입 통합:** 전화는 1a처럼 미검증 저장 → 1b가 인증 플로우(send/verify) 제공. 동네 주소는 **로그인 후 설정에서 등록**(가입 폼 비대화 유지, 1c 프로필과 충돌 최소화) + 가입 폼에 선택적 동네 입력은 하지 않음(범위 최소). 지오코딩·좌표는 위치 설정 시.
- **목 결정성:** 목 Geocoder는 동네 문자열 해시로 결정적 좌표. 목 PhoneVerifier는 코드를 `PhoneOtp`에 저장(실 SMS 없음, dev 콘솔 목).

## A. 데이터 모델 — 마이그레이션 1개

```prisma
model PhoneOtp {
  id         String    @id @default(cuid())
  userId     String
  user       User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  phoneBlindIndex String                 // 어느 번호로 보냈는지(평문 아님, 해시)
  codeHash   String                       // bcrypt(코드)
  expiresAt  DateTime
  consumedAt DateTime?
  createdAt  DateTime  @default(now())
  @@index([userId])
}
```
- `User`에 `phoneVerifiedAt DateTime?` + back-relation `phoneOtps PhoneOtp[]`.
- `lat`/`lng`/`regionCiphertext`/`phoneCiphertext`/`phoneBlindIndex`는 기존 컬럼 재사용.
- 감사 이벤트(String) 추가: `PHONE_OTP_SENT | PHONE_VERIFIED | PHONE_VERIFY_FAIL | LOCATION_SET`.
- `AuthDb`에 `phoneOtp` 표면 추가.

## B. 환경변수

`KAKAO_LOCAL_API_KEY?`, `OCTOMO_API_KEY?`·`OCTOMO_SENDER?`(전부 optional → 없으면 목). 있으면 실제 어댑터.

## C. Geocoder 어댑터 (`src/features/location/geocoder/`)

- `interface RegionInput { sido: string; sigungu: string; dong: string }`
- `interface GeoResult { lat: number; lng: number; region: string }` — region은 정규화된 동네 문자열.
- `interface Geocoder { geocode(input: RegionInput): Promise<GeoResult> }`, `getGeocoder()`(키 있으면 Kakao, 없으면 목).
- **좌표 반올림은 어댑터가 아니라 서비스(E)가 강제** — 어댑터는 원시 결과, 서비스가 `coarsen(lat,lng)`(소수 2자리)로 깎아 저장.
- 목: 동네 문자열 해시 → 한국 위경도 범위(위 33~38, 경 126~130) 내 결정적 좌표.
- 실제(Kakao): 주소검색 API 호출, 첫 결과 좌표. 실패 시 `AppError("GEOCODE_FAILED", 502)`.

## D. PhoneVerifier 어댑터 (`src/features/location/phone/`)

- `interface Sms { send(toBlindIndexSafe: string, phonePlaintext: string, code: string): Promise<void> }` — 목/실제. 실제=Octomo. 평문 전화는 발송에만.
- `getSms()`(키 있으면 Octomo, 없으면 콘솔 목).
- `issuePhoneOtp(db, userId, phonePlaintext, sms, meta)` — 6자리 코드→bcrypt 저장(phoneBlindIndex 포함), 기존 미소비 무효화, 레이트리밋(30초), SMS 발송, `PHONE_OTP_SENT` 감사(평문 전화·코드 미기록).
- `verifyPhoneOtp(db, userId, code): Promise<boolean>` — 미소비·미만료 조회→bcrypt 비교→consumedAt.

## E. 서비스 (`src/features/location/service.ts`)

- `setLocation(db, userId, input: RegionInput, geocoder, meta)` — geocode → `coarsen` → `lat/lng` + `regionCiphertext = encryptPII(result.region)` 저장. `LOCATION_SET` 감사. 상세주소·정확좌표 미저장.
- `coarsen(lat, lng): {lat, lng}` — 소수 2자리 반올림(약 1.1km).
- `startPhoneVerification(db, userId, sms, meta)` — 유저의 저장된 전화(복호화) 로드 → `issuePhoneOtp`.
- `confirmPhoneVerification(db, userId, code, meta)` — `verifyPhoneOtp` 성공 → `phoneVerifiedAt=now`. (선택) 같은 phoneBlindIndex의 다른 검증계정 있으면 `AppError("PHONE_TAKEN", 409)`. `PHONE_VERIFIED`/`PHONE_VERIFY_FAIL` 감사.

## F. 엔드포인트 (`src/app/api/`)

- `POST /api/auth/location` — 로그인 필요(currentUserFromRefresh). body RegionInput(zod). setLocation. `{ok, region}` (좌표는 반환 안 함 — 프라이버시).
- `POST /api/auth/phone/send` — 로그인 필요. startPhoneVerification. `{ok}`.
- `POST /api/auth/phone/verify` — 로그인 필요. body `{code}`. confirmPhoneVerification. `{ok}` / 일반 401·409.
- 얇은 JSON 라우트, `withErrorHandling`.

## G. UI (`src/i18n` 한/영 평어체)

- `/settings/location`(신규) — 시/도·시/군/구·동 입력 → 저장. 현재 동네 표시(정확좌표·상세주소 미표시).
- `/settings/phone`(신규 또는 security 페이지 확장) — 전화 인증(코드 발송→입력). 검증됨 배지.
- 서버 원문 렌더 금지(코드→카탈로그). 신규 카탈로그 `location.*`, `phone.*`.

## H. 보안·프라이버시 규약 (검토 중점)

- **좌표 거칠게:** 저장 좌표는 반올림된 동네 중심만. 상세주소·정확좌표 어디에도 저장·로그·응답 금지. (리뷰 필수 확인 항목)
- **전화 코드:** bcrypt 저장, 1회용·만료·레이트리밋, 평문 코드·전화는 SMS 발송에만.
- **PII:** 동네 문자열 `regionCiphertext`(AES-GCM), 전화 `phoneCiphertext`(기존). 로그·감사에 평문 금지.
- **일반화 실패:** 전화 코드 실패 일반 401.
- 위치·전화 설정은 로그인 필요(민감작업 재인증 step-up은 1c 범위 — 여기선 로그인 확인까지).

## I. 재사용

`encryptPII`/`decryptPII`·`currentUserFromRefresh`·`readRefreshCookie`·`logAuthEvent`/`requestMeta`·`withErrorHandling`·bcrypt·목/실제 어댑터 패턴(oauth) 전부 재사용.

## J. 테스트

- geocoder(목): 결정적 좌표, 한국 범위 내. coarsen: 소수 2자리. 실제 어댑터 폴백(키 없으면 목).
- phone otp: bcrypt 저장(평문 없음)·발송, 검증(정상/오코드/만료/소비/레이트리밋).
- service: setLocation이 반올림 좌표+regionCiphertext 저장(상세좌표 미저장 단언), phone 검증→phoneVerifiedAt, phone 중복 409.
- 라우트/E2E: 위치 설정→저장 확인(응답에 정확좌표 없음), 전화 인증(목 코드)→검증 배지.
- 로그·응답에 상세주소·정확좌표·평문 전화·코드 없음 확인.

## K. 완료 기준 (DoD)

1. 동네 주소 입력→지오코딩(목/실제)→**반올림 좌표**+regionCiphertext 저장, 상세좌표 미저장
2. 전화 SMS 인증(목 코드 발송→검증)→phoneVerifiedAt, 오코드·만료·재사용 거부
3. 전화 코드 bcrypt·1회용·레이트리밋, 좌표 반올림, 로그·응답에 평문/정확좌표 없음
4. 위치·전화 설정 UI 한/영, 로그인 필요
5. 키 있으면 실제(Kakao/Octomo) 동작(수동), 없으면 목으로 전 기능·테스트
6. 전체 테스트 통과

## L. 범위 밖

- 거리검색 쿼리(haversine) → #3
- 프로필 통합·마이페이지 → 1c
- 민감작업 step-up 게이팅(위치·전화 변경) → 1c
- 실 Kakao/Octomo 프로덕션 키·요금 → 이후

## 커밋/브랜치

- 브랜치 `feat/location-phone`. 🔴(geocoder 프라이버시·phone otp·서비스)는 적대적 리뷰, 🟢(마이그레이션·UI·E2E)는 메인 점검. 최종 opus 리뷰. 짧은 한글 커밋, Co-Authored-By 금지.
