# #3 상품 + 거리검색 설계

작성일: 2026-07-24
상태: 승인됨 (자율 결정)
선행: #1(회원·위치)·#2(RBAC) 완료. 문서화 방침(goal): 주요내용·검토중점 기록.

## 목적

상품 등록/조회/수정/삭제, 상태머신(판매중→예약중→판매완료), **haversine 반경 거리검색**(1b 거친 좌표), 카테고리·가격 필터, 초성/제목 검색. 첫 실도메인.

**범위 원칙:** 상품 CRUD + 상태머신 + 거리·필터·초성 검색 + 이미지 + UI까지. 채팅·거래(에스크로)는 #4/#5. 탈퇴 가드 실규칙은 #7(#3은 데이터 제공).

## 확정 결정 (자율 — 근거)

- **위치 스냅샷(중점):** 등록 시 판매자의 거친 좌표(`User.lat/lng`, 1b에서 소수 2자리)를 상품에 복제 저장. 판매자가 이후 이사해도 게시 위치 불변, 검색은 상품 좌표로. **판매자가 위치 미설정이면 등록 차단**(`NO_LOCATION` 400). 상세좌표·주소 없음 — 거친 좌표만(프라이버시 계승).
- **거리검색:** raw SQL haversine(`$queryRaw`), PostGIS 미사용(#0 결정). 반경(km) 필터. 상품 거친 좌표끼리 계산 → 집 특정 불가하면서 반경 충족.
- **상태머신:** `SELLING → RESERVED → SOLD`, `RESERVED → SELLING`(예약취소). SOLD는 종착(되돌리기 없음). 유효 전이만·**소유자만**. soft-delete(`deletedAt`).
- **브라우징 공개:** 목록·상세 조회는 GUEST 허용(마켓 특성). 등록·수정·삭제·상태변경은 **active USER + 소유권**(RBAC `requireActiveUser` + sellerId 일치). SUSPENDED 차단.
- **초성검색:** 등록/수정 시 제목의 초성 문자열(`titleChoseong`)을 선계산 저장. 검색 `q`가 초성만이면 초성 LIKE, 아니면 제목 부분일치(+초성 보조). 한글 초성 추출 유틸.
- **카테고리·가격:** `Category` enum, `price` Int(원, 0=나눔). 필터.
- **이미지:** `ProductImage`(순서 있는 경로 목록). 업로드 `POST /api/products/images`(multipart→media 볼륨→경로 반환), best-effort(fs 실패 시 에러). 상세좌표 아님. 이미지 없이도 등록 가능(0장 허용? 최소 1장 권장 — MVP는 0~N 허용).
- **페이지네이션:** keyset(cursor, createdAt+id), 페이지당 20.
- **탈퇴 가드 데이터(#7용):** `countActiveSalesForSeller(userId)`(SELLING/RESERVED) + `hasRecentSoldWithin(userId, days)` 같은 조회를 제공. #7이 `withdrawable` 가드에 주입. #3은 함수만.

## A. 데이터 모델 — 마이그레이션 1개

```prisma
enum ProductStatus { SELLING RESERVED SOLD }
enum Category { DIGITAL APPLIANCE FURNITURE CLOTHING BOOK BEAUTY SPORTS ETC }

model Product {
  id             String        @id @default(cuid())
  sellerId       String
  seller         User          @relation(fields: [sellerId], references: [id], onDelete: Cascade)
  title          String
  titleChoseong  String        // 초성 선계산(검색용)
  description    String
  price          Int           // 원, 0=나눔
  category       Category
  status         ProductStatus @default(SELLING)
  lat            Float         // 등록 시 판매자 거친 좌표 스냅샷
  lng            Float
  regionLabel    String?       // 표시용 동네 문자열(선택, 판매자 region 복제 — PII 아님, 동네수준)
  directPlace    String?       // 직거래 희망 장소(자유텍스트, 동네수준)
  images         ProductImage[]
  deletedAt      DateTime?
  createdAt      DateTime      @default(now())
  updatedAt      DateTime      @updatedAt
  @@index([status, category, createdAt])
  @@index([sellerId])
  @@index([lat, lng])
}

model ProductImage {
  id        String  @id @default(cuid())
  productId String
  product   Product @relation(fields: [productId], references: [id], onDelete: Cascade)
  path      String
  order     Int
  @@index([productId])
}
```
- `User`에 back-relation `products Product[]`.
- 감사/로그 대신 도메인 이벤트는 최소(상품은 PII 아님). 필요 시 `AuthAuditLog` 재사용(PRODUCT_CREATED 등)은 선택.
- `ProductDb = Pick<PrismaClient, "product" | "productImage" | "user" | "$queryRaw">`(별도 `src/features/products/db.ts`).

## B. 초성 유틸 (`src/features/products/choseong.ts`)

- `toChoseong(text): string` — 한글 음절→초성(ㄱㄴㄷ…), 비한글은 그대로. 검색 인덱스·쿼리에 동일 적용.
- `isChoseongQuery(q): boolean` — q가 초성 문자만인지.

## C. 상품 서비스 (`src/features/products/service.ts`)

- `createProduct(db, sellerId, input)` — 판매자 좌표 로드(없으면 `NO_LOCATION` 400), zod 검증, `titleChoseong=toChoseong(title)`, 좌표·regionLabel 스냅샷, 이미지 연결, Product 생성. 반환 `{id}`.
- `getProduct(db, id)` — 상세(판매자 닉네임·동네·상태·이미지 등, 공개 정보만; 판매자 이메일/전화/정확좌표 없음). 없거나 deletedAt→404.
- `updateProduct(db, sellerId, id, input)` — 소유권 확인(아니면 403 FORBIDDEN), 필드 수정(제목 변경 시 titleChoseong 재계산), SOLD면 수정 제한(선택).
- `deleteProduct(db, sellerId, id)` — 소유권, soft-delete.
- 소유권 헬퍼: 대상 로드→`sellerId !== userId`면 `AppError("FORBIDDEN", 403)`, 없으면 404.

## D. 상태머신 (`src/features/products/status.ts`)

- `TRANSITIONS: Record<ProductStatus, ProductStatus[]>` = `{ SELLING:[RESERVED,SOLD], RESERVED:[SELLING,SOLD], SOLD:[] }`.
- `changeStatus(db, sellerId, id, next)` — 소유권 확인, 현재 상태에서 `next`가 유효 전이인지(`TRANSITIONS[cur].includes(next)`, 아니면 `INVALID_TRANSITION` 409), 갱신.

## E. 검색 (`src/features/products/search.ts`)

- `searchProducts(db, params)` — params `{ lat?, lng?, radiusKm?, category?, minPrice?, maxPrice?, q?, cursor?, limit=20 }`.
- **haversine raw SQL:** lat/lng+radius 있으면 `$queryRaw`로 `6371 * acos(...)` 거리 계산·`<= radius` 필터·거리순 정렬. 없으면 최신순.
- 필터: `status='SELLING'`(기본 판매중만? 또는 전체 — 기본 미판매완료), `deletedAt IS NULL`, category, price 범위.
- `q`: 초성 쿼리면 `titleChoseong LIKE %q%`, 아니면 `title LIKE %q%`(+초성 보조).
- keyset pagination(cursor=createdAt|distance+id). SQL 인젝션 방지: 파라미터 바인딩(`$queryRaw` 태그드 템플릿).
- 반환: 카드용 subset(id, title, price, category, status, thumbnail, regionLabel, distanceKm?, createdAt) — **판매자 PII·정확좌표 없음**.

## F. 이미지 업로드 (`src/features/products/images.ts` + route)

- `POST /api/products/images`(active USER) — multipart 파일 → `/app/media/products/<uuid>.<ext>` 저장 → `{ path }` 반환. 크기·확장자 검증(이미지만, ≤5MB). fs 실패→503. best-effort.
- 정적 서빙: media 볼륨 경로를 Next가 서빙하거나 별도 라우트(`GET /api/media/[...path]`)로 스트림(디렉터리 트래버설 방지). 최소 구현.

## G. 엔드포인트 (`src/app/api/products/*`)

- `GET /api/products` — 공개, searchProducts(쿼리 파라미터). GUEST 허용.
- `GET /api/products/[id]` — 공개, getProduct(404).
- `POST /api/products` — active USER, createProduct.
- `PATCH /api/products/[id]` — active USER+소유권, updateProduct.
- `DELETE /api/products/[id]` — active USER+소유권, deleteProduct(soft).
- `POST /api/products/[id]/status` — active USER+소유권, changeStatus(body `{status}`).
- `POST /api/products/images` — active USER, 업로드.
- 얇은 라우트, `withErrorHandling`. 소유권/RBAC은 서비스+`requireActiveUser`.

## H. UI (한/영 평어체)

- `/products`(목록·검색: 카테고리·가격·반경·검색어, 카드 그리드, 무한스크롤/더보기).
- `/products/[id]`(상세: 이미지·제목·가격·설명·동네·상태·판매자 닉네임 링크. 소유자면 수정/삭제/상태변경, 비소유자면 채팅 버튼[#4 스텁]).
- `/products/new`·`/products/[id]/edit`(등록/수정 폼: 제목·가격·카테고리·설명·직거래장소·이미지, active USER, 위치 미설정 시 안내).
- 서버 원문 렌더 금지(코드→카탈로그). 신규 카탈로그 `product.*`. 위치는 동네 문자열만 표시(좌표·거리 km는 표시하되 정확좌표 없음).

## I. 보안·프라이버시 규약 (검토 중점)

- **좌표 프라이버시 계승:** 상품 좌표는 거친 스냅샷만. 상세/검색 응답·UI에 정확좌표·판매자 상세주소·이메일·전화 없음. 거리 km는 계산·표시 가능(거친 좌표 기반).
- **소유권:** 수정·삭제·상태변경은 sellerId==userId만. 타인 상품 변경 403.
- **RBAC:** 변경 작업 active USER(SUSPENDED 차단). 브라우징 공개.
- **상태 전이:** 유효 전이만(머신), SOLD 종착.
- **SQL 인젝션:** 검색 raw SQL은 파라미터 바인딩만(문자열 결합 금지).
- **이미지:** 확장자·크기·디렉터리 트래버설 검증. 업로드 active USER.
- 에러 마스킹 유지.

## J. 테스트

- choseong: 한글 초성 추출, 혼합 텍스트, 초성쿼리 판별.
- service: create(좌표 스냅샷·titleChoseong·위치없으면 400), get(404·PII 없음), update(소유권 403·초성 재계산), delete(soft·소유권).
- status: 유효 전이 통과·무효 409·SOLD 종착·소유권 403.
- search: haversine 반경 필터(경계), 카테고리·가격 필터, 초성/제목 q, 페이지네이션, 응답 PII 없음. (raw SQL은 실 DB 통합 테스트 또는 목 $queryRaw.)
- 라우트/E2E: 등록→목록/상세 조회→검색(반경·카테고리)→상태변경→타인 수정 403→GUEST 등록 401. 이미지 업로드.
- 응답·UI에 정확좌표·판매자 PII 없음.

## K. 완료 기준 (DoD)

1. 상품 등록(좌표 스냅샷·초성 계산·위치없으면 차단), 조회(공개), 수정/삭제(소유권)
2. 상태머신 유효 전이만·소유자만, SOLD 종착
3. haversine 반경검색 + 카테고리·가격·초성/제목 필터, 페이지네이션
4. 브라우징 공개(GUEST), 변경은 active USER+소유권(SUSPENDED 차단)
5. 이미지 업로드(검증)·표시
6. 응답·UI에 정확좌표·판매자 PII 없음, SQL 인젝션 없음
7. 전체 테스트 통과, UI 한/영
8. #7용 판매 상태 조회 함수 제공

## L. 범위 밖
- 채팅·거래 버튼 실동작 → #4. 에스크로 → #5. 탈퇴 가드 실규칙 → #7. 관리자 강제삭제 → #6. 신고 → #4/#6.

## 커밋/브랜치
- `feat/products`. 🔴(서비스·상태머신·검색·소유권·이미지검증)=적대적 리뷰. 🟢(마이그레이션·UI·E2E)=메인 점검. 최종 opus. 짧은 한글 커밋.
