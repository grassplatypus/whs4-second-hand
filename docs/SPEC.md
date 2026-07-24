# 동네 중고거래 플랫폼 — 전체 프로그램 명세서

작성일: 2026-07-24
상태: #0~#7 전 서브프로젝트 완료(master), 통합 검증 통과.

이 문서는 플랫폼 전체를 한 곳에서 조망한다. 세부 설계·결정 근거는 각 `docs/superpowers/specs/*`, 구현 흐름은 `docs/worklog/*`, 구동은 `docs/DEMO.md` 참조.

---

## 1. 개요

지역(동네) 기반 중고거래 플랫폼. 사용자는 자기 동네를 설정하고 반경 내 상품을 검색·거래한다. 판매자↔구매자는 1:1 채팅으로 조율하고, **안전거래(에스크로)**로 대금을 플랫폼이 잠깐 보관했다가 거래 확정 시 정산한다. 관리자는 신고·분쟁·제재를 처리한다.

**설계 관통 원칙:**
- **프라이버시 우선** — 위치는 동네 수준 거친 좌표만(소수 2자리), 이미지 EXIF/GPS 제거, PII(이메일·전화)는 암호화 저장·응답 구조적 배제.
- **DB-fresh 권한** — 토큰의 role을 신뢰하지 않고 매 요청 DB에서 계정 상태(정지/탈퇴)를 재확인.
- **상태 무결성** — 상품·에스크로 상태 전이는 머신으로 강제, 에스크로는 조건부 쓰기로 동시성 안전.
- **관심사 분리** — 라우트(인증·입력 게이트)·서비스(비즈니스 규칙)·저장소(조회) 계층 분리, 저장소 이원화(관계형=Postgres, 채팅=Mongo).

---

## 2. 아키텍처 · 기술 스택

| 층 | 기술 |
|---|---|
| 프론트/백 | Next.js 16 (App Router, RSC + Route Handlers), React 19 |
| 언어 | TypeScript strict |
| 관계형 DB | PostgreSQL 16 + Prisma 7 (driver adapter `@prisma/adapter-pg`, 런타임 쿼리엔진 바이너리 불요) |
| 문서 DB | MongoDB 7 (채팅 대화·메시지·차단·신고) |
| 실시간 | socket.io (별도 `ws` 컨테이너, 실 JWT 인증) |
| 국제화 | next-intl (ko/en, 평어체) |
| 검증 | zod 4 |
| 인증 | jose(JWT HS256 access + refresh 세션), bcryptjs, otplib(TOTP) |
| 이미지 | sharp (EXIF/GPS strip + 1600px 다운사이징 + webp) |
| 테스트 | Vitest(유닛 885), Playwright(E2E 50) |
| 배포 | Docker Compose (db·mongo·web·ws) |

**서비스 구성(compose):** `db`(Postgres, 127.0.0.1:5432)·`mongo`(127.0.0.1:27017)·`web`(Next standalone, :3000)·`ws`(socket.io, :4000). web·ws는 db·mongo healthcheck 통과 후 기동.

**공통 유틸(`src/features/_shared`):** `AppError`+`withErrorHandling`(코드·상태 매핑, 원문 유출 차단), `prisma`, `env`(zod 검증), `crypto`(AES-256-GCM PII 암호화 + HMAC blind index), `prisma-error`(P2002 실 어댑터 shape 감지).

---

## 3. 데이터 모델 (Postgres)

- **User** — nickname(unique), passwordHash?(OAuth-only는 null), emailCiphertext/emailBlindIndex(unique), phoneCiphertext/phoneBlindIndex, bio, **role**(USER|SUSPENDED|ADMIN), lat/lng(거친 좌표), regionCiphertext, twoFactorMethod/totpSecret, phoneVerifiedAt, consentedAt, deletedAt(soft delete).
- **AuthIdentity** — OAuth 연동(provider+providerUserId unique). **Session** — refresh 세션(회전·재사용 감지·폐기). **EmailOtp/PhoneOtp** — OTP. **AuthAuditLog** — 인증·관리자 액션 감사.
- **Product** — sellerId, title/titleChoseong(초성 검색), description, price(0=나눔), category(enum), **status**(SELLING|RESERVED|SOLD), lat/lng(등록 시 판매자 좌표 스냅샷), regionLabel/directPlace, deletedAt. **ProductImage** — 순서 있는 경로.
- **Escrow** — productId, buyerId, sellerId(요청 시점 스냅샷), amount, **status**(REQUESTED|ACCEPTED|FUNDED|RELEASED|REFUNDED|CANCELLED|DISPUTED), lastProposerId, fundedAt/releasedAt/refundedAt. **EscrowEvent** — 전이 감사(actor·from·to·amount·note).
- **채팅(Mongo):** `conversations`(productId·buyer·seller·lastMessageAt), `messages`(conversationId·senderId·kind·text·**rawText**[관리자용 원문]·masked), `blocks`, `reports`(reporter·target·reason·snapshot·**status** open|resolved|dismissed).

---

## 4. 서브프로젝트별 기능 · 검토 중점

### #0 인프라
Docker Compose(Postgres·Mongo·web·ws), Next 16 스캐폴드, Prisma 7 driver-adapter, env 검증, 헬스체크, socket.io ws 컨테이너 골격, next-intl ko/en.

### #1 회원 (1a 인증 / ext1 OAuth / ext2 2FA / 1b 위치·전화 / 1c 프로필)
- **인증:** 이메일+비번 회원가입/로그인, 이메일 OTP 로그인 폴백, refresh 세션 회전·재사용 감지, access JWT.
- **OAuth:** Kakao(목) 연동·연결/해제(step-up 필요), 이메일 충돌 자동 링크 안 함(계정 탈취 방지).
- **2FA:** TOTP·이메일 OTP, 로컬·OAuth 로그인 모두 강제(우회 방지), 민감작업 step-up 재인증(userId 바인딩 — 교차 사용자 우회 차단).
- **위치:** 지오코딩(목) → **거친 좌표**(소수 2자리 ≈1.1km 격자)만 저장, 상세주소·정확좌표 미수집. 전화 인증(목).
- **프로필:** 소개글·닉네임(step-up)·비번 변경, 회원 탈퇴(soft delete·세션 폐기, 가드는 #7).
- **검토중점:** PII 암호화(AES-GCM)+blind index, 응답에서 이메일/전화 구조적 배제, DB-fresh 권한, step-up userId 바인딩, OAuth 자동링크 금지.

### #2 RBAC
`requireActiveUser`/`requireActiveBearer`/`requireAdmin` — 신원 확인 후 **항상 DB에서 role 재조회**(토큰 role은 stale 가능). SUSPENDED/탈퇴는 세션이 살아 있어도 즉시 차단. 교차사용자 2FA disable·로그인 우회 구멍 수정.

### #3 상품 · 거리검색
- CRUD + 상태머신(SELLING→{RESERVED,SOLD}, RESERVED→{SELLING,SOLD}, SOLD 종착, **소유자만**), soft-delete.
- **haversine 반경검색**(raw SQL, 전 값 `Prisma.sql` 바인딩 — SQL 인젝션 차단), 카테고리·가격·초성/제목 필터, keyset 페이지네이션.
- 등록 시 판매자 거친 좌표 스냅샷(이후 이사해도 게시 위치 불변), 위치 미설정 시 등록 차단.
- **이미지:** sharp로 EXIF/GPS 제거 + 1600px 다운사이징 + webp, uuid 파일명(경로 트래버설 차단).
- **검토중점:** 좌표 프라이버시(정확좌표·PII 응답 배제), 소유권, 유효 전이, SQL 인젝션 차단, 이미지 검증. #7용 `countActiveSales`·`hasRecentSold` 제공.

### #4 채팅
- 상품 기준 1:1 채팅, **Mongo 저장**(repo 추상화, 단위테스트는 인메모리 fake).
- **WS 실 JWT 인증**(미인증 거부), 룸 join은 참여자만(도청 불가), message는 `socket.data.userId`(스푸핑 불가), 브로드캐스트는 마스킹본.
- **한국어 비속어/우회 마스킹**(정규화로 ㅅㅂ/시 발/시1발 감지), 전달·표시는 마스킹본, **원문은 관리자용(rawText)으로만** 보존.
- **이미지는 상대가 답장한 후에만**(IMAGE_BEFORE_REPLY, 서비스 강제 — REST·WS 상속), 상품 이미지 상단·설명 평문 textarea.
- 차단(양방향)·신고(→#6 저장).
- **검토중점:** rawText 유출 없음(`toDelivered` 단일 choke point), 참여자 격리(REST+WS), 마스킹 완전성, PII 없음(상대=닉네임만).

### #5 에스크로 (안전거래)
- **송금 상태머신:** 요청(구매자 금액 제안)→조정(양측 금액 협상, 비제안자만 수락)→보관(입금)→정산(수령확인→판매자)/반환(→구매자), 분쟁(참여자)→조정(관리자).
- **행위자 인가:** request=구매자(자기거래 금지), fund/confirm=구매자, refund=판매자, resolve=관리자, 나머지=참여자. 제3자 403.
- **동시성 안전(핵심):** 모든 전이가 조건부 쓰기(`updateMany({where:{id,status:기대}})+count===1 else 409`)로 이중정산·이중보관·분쟁우회를 원자적으로 차단(적대적 리뷰가 발견·수정). 상품 연동(fund→RESERVED·confirm→SOLD·refund→SELLING)은 같은 `$transaction`.
- **금액 무결성:** 정산은 항상 서버 보관 금액, fund/confirm은 금액 입력 없음. 돈은 데모용 목 보관(실 PG 없음).
- **검토중점:** 행위자 인가, 상태 원자성, 이중보관 방지, 금액 무결성, PII 없음, 감사(EscrowEvent). #7용 `countActiveEscrows` 제공.

### #6 관리자
- **제재:** 정지/해제(자기·타관리자 정지 금지), DB-fresh RBAC로 즉시 실효.
- **신고 관리:** Mongo `reports` 목록(open 우선·aggregation 정렬)·원문 snapshot(관리자 전용)·처리(resolve/dismiss)·신고된 유저 정지.
- **강제 삭제:** 상품 soft-delete(소유권 무시), 감사.
- **분쟁 조정:** 분쟁 에스크로 목록 + #5 resolve(release/refund) 재사용.
- **대시보드:** 유저·정지·상품 상태별·open 신고·진행/분쟁 에스크로 집계(PII 없음, 수치만).
- **검토중점:** 전 라우트·페이지 requireAdmin, 권한 남용 방지, 모든 액션 AuthAuditLog 감사, 원문 격리, PII 최소(이메일/전화 복호화 안 함).

### #7 탈퇴/차단 규칙
`withdrawable` 가드에 #3·#5 조회를 합성 — **진행 에스크로 → 판매중/예약중 상품 → 최근 7일 판매완료** 순 검사, 하나라도면 탈퇴 차단(WITHDRAW_BLOCKED 409). 대금이 걸린 거래를 최우선 차단, 판매 직후 구매자 보호 쿨다운.

---

## 5. API 표면 (요약)

- **인증(`/api/auth/*`):** register·login·logout·refresh·email-otp·step-up·2fa/*·oauth/*·location·withdraw.
- **프로필(`/api/profile/*`):** bio·nickname·password.
- **상품(`/api/products*`):** GET 목록(검색)·GET [id]·POST·PATCH·DELETE·POST [id]/status·POST images·GET media.
- **채팅(`/api/chat/*`):** conversations(GET/POST)·[id]/messages(GET/POST)·block·unblock·report. + WS(join·message).
- **에스크로(`/api/escrow*`):** POST(요청)·GET 목록·GET [id]·[id]/{counter,accept,cancel,fund,confirm,refund,dispute,resolve}.
- **관리자(`/api/admin/*`):** dashboard·reports·reports/[id]/resolve·users/[id]/{suspend,lift}·products/[id]/force-delete·disputes.
- 전 라우트 `withErrorHandling`(코드→카탈로그, 서버 원문 미노출). 변경 작업은 `requireActiveUser`, 관리자 작업은 `requireAdmin`.

---

## 6. 보안 · 프라이버시 요약

| 위협 | 방어 |
|---|---|
| 위치로 집 특정 | 거친 좌표(소수 2자리)만 저장·노출, 이미지 EXIF/GPS 제거 |
| PII 유출 | AES-GCM 암호화 + blind index, 응답 구조적 배제(명시 select·리터럴, 스프레드 금지) |
| stale 권한 | 매 요청 DB-fresh role, SUSPENDED/탈퇴 즉시 차단 |
| SQL 인젝션 | raw SQL 전 값 `Prisma.sql` 바인딩 |
| 경로 트래버설 | uuid 파일명 + resolved-path 봉쇄 |
| 세션 탈취 | refresh 회전·재사용 감지·폐기, 민감작업 step-up(userId 바인딩) |
| 2FA 우회 | 로컬·OAuth 로그인 모두 강제 |
| 채팅 도청·원문 유출 | WS 실 인증·참여자 룸, 마스킹본 전달·원문 관리자용만 |
| 이중정산·이중보관 | 에스크로 조건부 쓰기(count 가드)·상품 $transaction |
| 관리자 권한 남용 | requireAdmin·자기/타관리자 정지 금지·전 액션 감사 |

---

## 7. 테스트 · 검증

- **유닛 885**(Vitest) — 순수 로직·서비스(목 DB/repo)·컴포넌트·라우트.
- **E2E 50**(Playwright, 실 Postgres+Mongo) — health·auth·2FA·oauth·location·profile·products·chat·escrow·admin 전 영역 + 크로스 기능 흐름(회원→상품→채팅→에스크로→관리자→탈퇴).
- **빌드** green(Next standalone), **tsc** clean.
- **워크플로우:** 서브에이전트 주도 SDD, 보안/프라이버시 핵심(🔴)은 적대적 리뷰+fix 루프, 최종 whole-branch opus 리뷰 후 `--no-ff` 머지. 적대적 리뷰가 실 결함 다수 발견·수정(에스크로 이중정산/이중보관/분쟁우회, 관리자 신고 정렬 누락, P2002 shape, 교차사용자 2FA 등).

---

## 8. 알려진 갭 · 향후

- **외부 연동 목(mock):** SMTP·Kakao·SMS·PG(에스크로 결제) — 어댑터 교체 지점 표시. 실서비스화 시 각 어댑터만 교체.
- **채팅 실시간:** 클라 액세스 토큰 미저장이라 브라우저가 WS 미연결 — 송수신은 REST 폴백. WS 서버(인증·룸·마스킹)는 동작·테스트됨. 후속: 클라 토큰 보관 배선.
- **관리 범위:** 강제 탈퇴(계정 파기)·채팅 메시지 강제삭제·역할 계층은 범위 밖(단일 ADMIN·정지/해제).
- **마이그레이션:** web 이미지는 자동 적용 안 함 — `migrate deploy` 최초 1회.

---

## 8-A. 프론트엔드 완성 단계 (2026-07-25 추가분)

초기 구현은 페이지별 기능은 갖췄지만 앱 셸·시각 완성도·클라이언트 런타임 품질이 부족했다. 두 차례 전면 검토(1차 36건, 2차 30건 확정 결함)를 거쳐 아래를 채웠다.

**앱 셸·디자인 기반**
- 전역 내비게이션(브랜드·주요 메뉴·판매하기·설정·아바타·로그아웃, 모바일 메뉴), 랜딩 홈(히어로·특징·최근 상품), 브랜드형 404/에러/로딩 화면.
- 공용 UI 키트(`shell/ui.tsx`: Card·PageContainer·PageHeader·Field·Input·Select·PasswordInput·Button·EmptyState·AuthShell)로 전 화면 통일. Geist 폰트 복구(전역 CSS가 Arial로 덮어쓰던 문제), 시간대 Asia/Seoul 고정, 날짜·숫자는 next-intl 포매터 사용(서버/클라이언트 표기 불일치 제거).

**신규 기능**
- 프로필 사진 업로드(`User.avatarPath`, 400px webp 재인코딩·EXIF 제거) — 내비·프로필·상품 판매자·채팅·거래 전반에 반영. 사진이 없으면 닉네임 기반 아바타.
- 상품: 가격 입력 세 자리 구분(붙여넣기·전송은 숫자만), 등록·수정 모두 이미지 관리, 숨기기/다시 보이기(보관 상태 활용), 내 상품 관리 화면, 상태 필터, 이미지 갤러리(다중·확대·키보드 접근).
- 채팅: 대화 목록은 상품명 중심 + 안 읽은 개수 뱃지, 읽음 표시, 방 나가기(내 목록에서만 사라지고 상대가 새 메시지를 보내면 재등장), 양쪽 다 나간 방은 휴면 처리 후 관리자가 정리, 사진 미리보기 확인 후 전송, 비속어 전송 전 확인, 신고 사유 선택식.
- 안전거래: 직거래 약속(장소·시간), 거래 후기(좋아요·보통·별로 + 한마디, 거래당 1회) — 공개 프로필에 받은 후기 요약·목록 표시. 내 페이지에 구매한 상품.
- 관리자: 정지 해제, 휴면 채팅방 개별·일괄 정리, 자동 감지 건 배지.

**안전 장치 강화**
- 서버 재검증: 채팅 사진 경로 형식·글자 수 상한·신고 사유 길이·신고자 참여 확인, 상품 이미지 경로 형식·개수 제한.
- 연락처·계좌 탐지: 숫자를 한글·알파벳으로 바꿔 쓴 표기까지 인식해 사용자에게는 표시로 알리고, 우회 흔적이나 사기 신고 이력이 있으면 관리자에게만 조용히 기록(같은 대상에 대한 사용자 신고와 자동 기록은 한 건으로 합침).
- 클라이언트에 내부 식별자·개인정보를 넘기지 않도록 내비·채팅·거래 DTO 정리.

## 9. 로드맵 대비 완료 현황

`#0 인프라 → #1 회원(1a·ext1·ext2·1b·1c) → #2 RBAC → #3 상품·거리검색 → #4 채팅 → #5 에스크로 → #6 관리자 → #7 탈퇴/차단 → 데모 → 명세서` — **전 단계 완료.** 각 단계 설계(`specs/`)·구현 흐름(`worklog/`)·검토 중점 문서화 완료.
