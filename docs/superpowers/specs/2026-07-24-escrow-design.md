# #5 에스크로(안전거래) 설계

작성일: 2026-07-24
상태: 승인됨 (자율 결정)
선행: #1(회원)·#2(RBAC)·#3(상품)·#4(채팅) 완료. 문서화 방침(goal): 주요내용·검토중점 기록.

## 목적

중고거래 안전거래(에스크로) — 구매자↔판매자 대금을 플랫폼이 잠깐 보관했다가 거래가 확정되면 판매자에게 정산, 틀어지면 구매자에게 반환하는 **송금 상태머신**. 로드맵 문구: `요청→조정→보관→정산/반환`.

**범위 원칙:** 에스크로 상태머신 + 금액 조정(협상) + 대금 보관/정산/반환 + 분쟁 접수 + 상품 상태 연동 + REST + UI까지. 실 PG(결제대행)·실 정산이체는 범위 밖(데모: 목 보관 — 실 SMTP/Kakao가 목인 것과 동일 관례). 분쟁 **처리 UI·대시보드**는 #6. 탈퇴 가드 실규칙은 #7(#5는 `countActiveEscrows` 데이터 제공).

## 확정 결정 (자율 — 근거)

- **저장소:** Postgres(관계형 — 상품·유저와 강결합, 트랜잭션 필요). 새 마이그레이션 1개. (채팅만 Mongo, 나머지 Postgres 계승.)
- **돈은 목 보관(중점·정직성):** 실 PG 없음. `fund`는 "입금 완료"를 상태로 표현(보관 중), `release`는 "판매자 정산", `refund`는 "구매자 반환"을 상태·타임스탬프·금액으로 기록한다. 지갑 잔액 모델은 도입하지 않음(YAGNI — 상태머신이 핵심 비즈니스 로직이고, 잔액 충전 흐름은 데모 가치 대비 복잡도 과함). 문서에 "목 보관(실 이체 아님)"을 명시.
- **상태머신(핵심):** `REQUESTED → ACCEPTED → FUNDED → {RELEASED | REFUNDED | DISPUTED→{RELEASED|REFUNDED}}`, 입금 전 파기 `CANCELLED`. 각 전이는 **행위자 규칙**(누가 그 전이를 할 수 있는가)이 상태 규칙만큼 중요 — 상품 상태머신(#3)을 계승하되 행위자 인가를 추가.
- **조정(협상):** `REQUESTED` 안에서 금액 왕복. `lastProposerId`(마지막 금액 제안자)를 두어, **상대만 수락**(`accept`) 가능(자기 제안 자기 수락 금지). 상대는 `counter(새 금액)`으로 재제안(상태는 REQUESTED 유지, `amount`·`lastProposerId` 갱신) 하거나 `cancel`. 합의되면 `accept`→`ACCEPTED`.
- **상품 연동(트랜잭션 필수·중점):** `fund` 시 상품 `SELLING→RESERVED`, `release` 시 `RESERVED→SOLD`, `refund/cancel`(FUNDED에서) 시 `RESERVED→SELLING`. **에스크로 상태 갱신 + 상품 상태 갱신은 한 `$transaction`** — 둘이 갈라지면 "돈은 보관됐는데 상품은 판매중" 같은 불일치가 난다. `fund` 시 상품이 SELLING이 아니면(다른 거래가 선점) `PRODUCT_UNAVAILABLE` 409 — **같은 상품 이중 보관 방지**.
- **행위자 인가(중점):** 참여자(에스크로 buyer/seller)만 접근(제3자 403). 전이별 행위자: `request`=구매자(active USER, 판매자 본인 금지), `counter/accept/cancel`=참여자(수락은 비제안자), `fund`=구매자, `release`(수령확인)=구매자, `refund`=판매자, `dispute`=참여자, `resolveDispute`=관리자(ADMIN). SUSPENDED는 `requireActiveUser`가 차단.
- **금액 무결성:** 금액은 서버 보관(`escrow.amount`). `fund`·`release`는 클라가 금액을 못 바꾼다(서버의 합의 금액만 정산). 제안 금액은 양수·상한(sanity, ≤ 1e9) 검증. 상품 가격은 참고값(협상 자유).
- **감사 로그:** `EscrowEvent`(actor·from·to·amount·note)로 전 전이 기록 — 분쟁 조정(#6) 근거·데모 타임라인. `AuthAuditLog` 패턴 계승.
- **#7용 데이터:** `countActiveEscrows(userId)`(참여 중 미종착 에스크로 — ACCEPTED/FUNDED/DISPUTED) 제공. #7이 `withdrawable` 가드에 주입(#3 `sales-status`와 함께).

## A. 데이터 모델 — 마이그레이션 1개

```prisma
enum EscrowStatus {
  REQUESTED   // 요청·조정(금액 제안 왕복)
  ACCEPTED    // 조정 완료(양측 금액 합의)
  FUNDED      // 보관(구매자 입금, 에스크로 보관 중)
  RELEASED    // 정산(판매자에게 대금 지급 — 거래 완료)
  REFUNDED    // 반환(구매자에게 대금 반환)
  CANCELLED   // 취소(입금 전 파기)
  DISPUTED    // 분쟁(관리자 조정 대기 — 처리 UI는 #6)
}

model Escrow {
  id             String       @id @default(cuid())
  productId      String
  product        Product      @relation(fields: [productId], references: [id], onDelete: Cascade)
  buyerId        String
  buyer          User         @relation("EscrowBuyer", fields: [buyerId], references: [id], onDelete: Cascade)
  sellerId       String       // 요청 시점 상품 판매자 스냅샷
  seller         User         @relation("EscrowSeller", fields: [sellerId], references: [id], onDelete: Cascade)
  amount         Int          // 현재 제안/합의 금액(원)
  status         EscrowStatus @default(REQUESTED)
  lastProposerId String       // 조정: 마지막 금액 제안자(상대가 수락)
  fundedAt       DateTime?
  releasedAt     DateTime?
  refundedAt     DateTime?
  events         EscrowEvent[]
  createdAt      DateTime     @default(now())
  updatedAt      DateTime     @updatedAt

  @@index([buyerId])
  @@index([sellerId])
  @@index([productId, status])
}

model EscrowEvent {
  id        String        @id @default(cuid())
  escrowId  String
  escrow    Escrow        @relation(fields: [escrowId], references: [id], onDelete: Cascade)
  actorId   String        // 행위자(구매자/판매자/관리자)
  from      EscrowStatus?
  to        EscrowStatus
  amount    Int?          // 금액 조정·정산 시 기록
  note      String?
  createdAt DateTime      @default(now())

  @@index([escrowId])
}
```
- `User`에 back-relation `escrowsAsBuyer Escrow[] @relation("EscrowBuyer")`, `escrowsAsSeller Escrow[] @relation("EscrowSeller")`. `Product`에 `escrows Escrow[]`.
- `EscrowDb = Pick<PrismaClient, "escrow" | "escrowEvent" | "product" | "user" | "$transaction">`(`src/features/escrow/db.ts`).

## B. 상태머신 (`src/features/escrow/status.ts`)

- `TRANSITIONS: Record<EscrowStatus, EscrowStatus[]>`:
  ```
  REQUESTED: [ACCEPTED, CANCELLED],   // counter(금액 조정)는 REQUESTED 유지(전이 아님, amount만 갱신)
  ACCEPTED:  [FUNDED, CANCELLED],
  FUNDED:    [RELEASED, REFUNDED, DISPUTED],
  DISPUTED:  [RELEASED, REFUNDED],
  RELEASED:  [], REFUNDED: [], CANCELLED: [],
  ```
- `assertTransition(cur, next)` — 유효 전이 아니면 `INVALID_TRANSITION` 409.
- **행위자 규칙은 서비스에 둔다**(각 액션 함수가 자기 행위자를 강제) — 전이표는 상태만, 인가는 액션별. 이 분리를 문서화.

## C. 서비스 (`src/features/escrow/service.ts`)

각 함수: 대상 로드 → 참여자/행위자 확인 → 상태 전이 검증 → (상품 연동 시)`$transaction` → EscrowEvent 기록.

- `requestEscrow(db, buyerId, productId, amount)` — 상품 로드(deletedAt 제외), 판매자==buyer면 `SELF_TRADE` 400, 상품 SELLING 아니면 `PRODUCT_UNAVAILABLE` 409, amount 양수·상한. 판매자 스냅샷. `REQUESTED` 생성, `lastProposerId=buyer`. (기존 미종착 에스크로 같은 (product,buyer) 있으면 재사용? — 아니오, 매 요청 새 건. 단 동일 상품에 FUNDED 존재 시 요청은 허용하되 fund에서 막힘.) 반환 `{id}`.
- `counterEscrow(db, actorId, id, amount)` — 참여자, 상태 REQUESTED, `actorId != lastProposerId`(자기 차례 아님) 아니면 400, amount 검증. `amount`·`lastProposerId=actor` 갱신(상태 유지). Event(to=REQUESTED, amount).
- `acceptEscrow(db, actorId, id)` — 참여자, REQUESTED, `actorId != lastProposerId`(상대만 수락) 아니면 `CANNOT_ACCEPT_OWN` 400 → `ACCEPTED`.
- `cancelEscrow(db, actorId, id)` — 참여자, 상태 REQUESTED|ACCEPTED → `CANCELLED`. (FUNDED 이후는 refund/dispute로.)
- `fundEscrow(db, buyerId, id)` — **구매자만**, ACCEPTED → `$transaction`: 상품 재로드 SELLING 확인(아니면 `PRODUCT_UNAVAILABLE` 409) → 상품 RESERVED, 에스크로 FUNDED+fundedAt, Event.
- `confirmReceipt(db, buyerId, id)` — **구매자만**(수령확인=정산 트리거), FUNDED → `$transaction`: 상품 RESERVED→SOLD, 에스크로 RELEASED+releasedAt, Event.
- `refundEscrow(db, sellerId, id)` — **판매자만**, FUNDED → `$transaction`: 상품 RESERVED→SELLING, 에스크로 REFUNDED+refundedAt, Event.
- `disputeEscrow(db, actorId, id, note?)` — 참여자, FUNDED → `DISPUTED`, Event(note).
- `resolveDispute(db, adminId, id, resolution: 'release'|'refund')` — **ADMIN만**, DISPUTED → release면 상품 SOLD·RELEASED / refund면 상품 SELLING·REFUNDED, `$transaction`, Event(actor=admin). (라우트는 `requireAdmin`. 대시보드/UI는 #6.)
- `getEscrow(db, userId, id)` — 참여자만(아니면 403), 상세(상대 닉네임·상품 요약·금액·상태·이벤트 타임라인). **PII 없음**(이메일/전화/정확좌표 없음).
- `listEscrows(db, userId)` — 내가 buyer 또는 seller인 에스크로 목록(상대 닉네임·상품 제목·금액·상태·갱신시각).
- `countActiveEscrows(db, userId)` — ACCEPTED/FUNDED/DISPUTED 참여 건수(#7용).

## D. REST 엔드포인트 (`src/app/api/escrow/*`)

- `POST /api/escrow` — active USER, requestEscrow(body productId, amount).
- `GET /api/escrow` — active USER, listEscrows.
- `GET /api/escrow/[id]` — active USER+참여자, getEscrow.
- `POST /api/escrow/[id]/counter` — active USER+참여자, counterEscrow(body amount).
- `POST /api/escrow/[id]/accept` — active USER+참여자, acceptEscrow.
- `POST /api/escrow/[id]/cancel` — active USER+참여자, cancelEscrow.
- `POST /api/escrow/[id]/fund` — active USER(구매자), fundEscrow.
- `POST /api/escrow/[id]/confirm` — active USER(구매자), confirmReceipt.
- `POST /api/escrow/[id]/refund` — active USER(판매자), refundEscrow.
- `POST /api/escrow/[id]/dispute` — active USER+참여자, disputeEscrow(body note?).
- `POST /api/escrow/[id]/resolve` — **ADMIN**, resolveDispute(body resolution).
- 얇은 라우트, `requireActiveUser`(resolve만 `requireAdmin`), `withErrorHandling`. 행위자/전이 규칙은 서비스에.

## E. UI (한/영 평어체)

- `/escrow`(목록: 상대 닉네임·상품·금액·상태 배지·행동 버튼), `/escrow/[id]`(상세: 금액 조정 입력·상태별 액션 버튼[요청자/상대/구매자/판매자에 따라 다른 버튼]·이벤트 타임라인).
- 상품 상세(`ProductDetail`)에 비소유자용 "안전거래 요청" 버튼(가격 제안 입력)→requestEscrow→`/escrow/[id]`. (기존 "채팅하기"와 나란히.)
- 서버 원문 렌더 금지(코드→카탈로그). 신규 카탈로그 `escrow.*`. 상태 배지·전이 버튼은 상태+역할로 결정.

## F. 보안·프라이버시 규약 (검토 중점)

- **행위자 인가:** 전이별 행위자 강제(fund/confirm=구매자, refund=판매자, resolve=관리자, 나머지=참여자). 참여자 아닌 제3자는 조회·행동 전부 403.
- **상태머신:** 유효 전이만(머신), 종착 상태(RELEASED/REFUNDED/CANCELLED) 재전이 불가.
- **상품 연동 원자성:** 에스크로+상품 상태는 한 트랜잭션. `fund` 시 상품 SELLING 재확인(이중 보관 방지, 409).
- **금액 무결성:** 서버 보관 금액만 정산. fund/confirm은 금액 입력 없음. 제안 금액 양수·상한 검증. 협상 수락은 비제안자만(자기 제안 자기 수락 금지).
- **자기거래 금지:** 판매자 본인 상품 에스크로 요청 불가.
- **PII 없음:** 에스크로 조회·목록에 상대 이메일/전화/정확좌표 없음(닉네임·상품 요약만).
- **RBAC:** 변경 active USER(SUSPENDED 차단), resolve는 ADMIN. 에러 마스킹 유지.

## G. 테스트

- status: 유효 전이 통과·무효 409·종착 재전이 거부.
- service(핵심): request(자기거래 400·비판매중 409·양수·판매자스냅샷), counter/accept(비제안자만·자기수락 400), cancel(REQUESTED/ACCEPTED만), fund(구매자만·상품 RESERVED·이중보관 409·트랜잭션), confirm(구매자만·상품 SOLD), refund(판매자만·상품 SELLING 복귀), dispute/resolve(참여자·ADMIN만), get/list(참여자만·PII 없음), countActiveEscrows.
- 상품 연동: fund/confirm/refund의 상품 상태 전이를 목 `$transaction`으로 검증(실 DB E2E에서 재확인).
- 라우트: 각 라우트 requireActiveUser(GUEST 401), resolve requireAdmin(비관리자 403), 바디 금액 검증, 인증 userId만 행위자로 전달(바디 위조 무시).
- E2E: 요청→조정(counter/accept)→보관(fund, 상품 RESERVED)→정산(confirm, 상품 SOLD) 해피패스 + 반환(refund, 상품 SELLING 복귀) + 자기거래 400 + 제3자 403 + 이중보관 409 + GUEST 401 + 관리자 분쟁조정. 응답 PII 없음.

## H. 완료 기준 (DoD)

1. 에스크로 상태머신(요청→조정→보관→정산/반환) 유효 전이·행위자 인가
2. 금액 조정(협상, 비제안자 수락)·자기거래 금지
3. 보관/정산/반환 시 상품 상태 원자적 연동(fund→RESERVED, confirm→SOLD, refund→SELLING), 이중 보관 방지
4. 참여자 격리(제3자 403), PII 없음, 금액 무결성(서버 보관 금액만)
5. 분쟁 접수(참여자)·조정(ADMIN), 감사 로그(EscrowEvent)
6. REST + UI(한/영), 상품 상세 안전거래 요청 배선
7. 전체 테스트 통과
8. #7용 `countActiveEscrows` 제공

## I. 범위 밖
- 실 PG·실 이체·지갑 잔액 → 데모 목 보관. 분쟁 처리 UI·관리자 대시보드 → #6. 탈퇴 가드 실규칙 → #7. 배송추적·리뷰/평점 → YAGNI.

## 커밋/브랜치
- `feat/escrow`. 🔴(상태머신·서비스·행위자인가·상품연동 트랜잭션)=적대적 리뷰. 🟢(마이그레이션·라우트·UI·E2E)=메인 점검. 최종 opus. 짧은 한글 커밋.
