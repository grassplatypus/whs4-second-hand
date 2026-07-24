# 상품 + 거리검색(#3) 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]`.

**Goal:** 상품 CRUD·상태머신·haversine 거리검색·카테고리/가격/초성 필터·이미지·UI를 구현한다.

**Architecture:** `src/features/products/`에 서비스·상태머신·검색·초성유틸·이미지. 좌표는 등록 시 판매자 거친 좌표 스냅샷. 검색은 raw SQL haversine(`$queryRaw` 파라미터 바인딩). 브라우징 공개, 변경은 `requireActiveUser`+소유권. 마이그레이션 1개(Product/ProductImage/enums).

**Tech Stack:** Next.js 16, Prisma 7(`$queryRaw`), zod 4, Node fs(이미지), next-intl 4, Vitest + Playwright. 재사용: `requireActiveUser`(RBAC), `AppError`, `withErrorHandling`, `prisma`.

**설계:** `docs/superpowers/specs/2026-07-24-products-search-design.md`.

## Global Constraints
- **좌표 프라이버시:** 상품 좌표는 판매자 거친 좌표(소수 2자리) 스냅샷만. 응답·UI에 정확좌표·판매자 이메일/전화/상세주소 없음. 거리 km(거친 좌표 기반)는 표시 가능.
- **소유권:** 수정·삭제·상태변경은 `sellerId === userId`만(아니면 403 FORBIDDEN). 브라우징(목록·상세)은 GUEST 공개.
- **RBAC:** 변경 작업 `requireActiveUser`(SUSPENDED 차단). 등록 시 판매자 위치 없으면 `NO_LOCATION` 400.
- **상태머신:** SELLING→{RESERVED,SOLD}, RESERVED→{SELLING,SOLD}, SOLD→{} (종착). 유효 전이만(무효 409).
- **SQL 인젝션 금지:** 검색 raw SQL은 `$queryRaw` 태그드 템플릿 파라미터 바인딩만. 문자열 결합 금지.
- **이미지:** 확장자(이미지)·크기(≤5MB)·디렉터리 트래버설 검증. 업로드 active USER.
- soft-delete(`deletedAt`), 검색·조회는 deletedAt IS NULL. 클라 에러 코드→카탈로그. UI 한/영 평어체.
- TypeScript strict. 짧은 한글 커밋, Co-Authored-By 금지. 브랜치 `feat/products`. Node 빌트인 테스트 `// @vitest-environment node`. node PATH 없을 때 `/c/Program Files/nodejs` 프리펜드.

## 실행 카덴스
🔴 적대적 리뷰(서비스·상태머신·검색·소유권·이미지). 🟢 메인 점검(마이그레이션·UI·E2E). 최종 opus.

## File Structure
| 파일 | 책임 | 태스크 |
|---|---|---|
| `prisma/schema.prisma`+마이그레이션 | Product/ProductImage/enums | 1 |
| `src/features/products/db.ts`·`choseong.ts` | ProductDb·초성유틸 | 1 |
| `src/features/products/service.ts` | create/get/update/delete+소유권 | 2 |
| `src/features/products/status.ts` | 상태머신 | 3 |
| `src/features/products/search.ts` | haversine·필터·초성·페이지네이션 | 4 |
| `src/features/products/images.ts`+`/api/products/images` | 이미지 업로드 | 5 |
| `src/app/api/products/*` 라우트 | 얇은 라우트 | 2~5 분산(주로 6에서 배선) |
| `src/features/products/*.tsx`+페이지 | UI | 6 |
| `src/i18n/messages/*` | product 카탈로그 | 6 |
| `e2e/products.spec.ts`·워크로그 | E2E·기록 | 7 |

---

### Task 1 🟢: 마이그레이션 + ProductDb + 초성 유틸

**Files:** Modify schema.prisma(+migration), Create `src/features/products/db.ts`, `choseong.ts` + test.

- [ ] **Step 1: 스키마** — 설계 A절의 `Product`·`ProductImage`·`ProductStatus`·`Category` + `User.products Product[]` back-relation 추가.
- [ ] **Step 2: 마이그레이션** — `docker compose up -d db` → `migrate diff`+`migrate deploy` 폴백(체크섬 드리프트 회피, 폴더 `YYYYMMDDHHMMSS_products`). psql로 `Product`·`ProductImage` 테이블·인덱스 확인.
- [ ] **Step 3: db.ts** — `export type ProductDb = Pick<PrismaClient, "product" | "productImage" | "user" | "$queryRaw" | "$queryRawUnsafe">;` (Unsafe는 안 쓰되 타입만; 실제는 태그드 `$queryRaw`).
- [ ] **Step 4: choseong 유틸(TDD)** `choseong.ts`:
```ts
const CHO = ["ㄱ","ㄲ","ㄴ","ㄷ","ㄸ","ㄹ","ㅁ","ㅂ","ㅃ","ㅅ","ㅆ","ㅇ","ㅈ","ㅉ","ㅊ","ㅋ","ㅌ","ㅍ","ㅎ"];
export function toChoseong(text: string): string {
  let out = "";
  for (const ch of text) {
    const code = ch.charCodeAt(0);
    if (code >= 0xac00 && code <= 0xd7a3) out += CHO[Math.floor((code - 0xac00) / 588)];
    else out += ch;
  }
  return out;
}
export function isChoseongQuery(q: string): boolean {
  return q.length > 0 && [...q].every((c) => CHO.includes(c));
}
```
테스트: `toChoseong("사과")==="ㅅㄱ"`, 혼합("아이폰12"→"ㅇㅇㅍ12"), `isChoseongQuery("ㅅㄱ")===true`, `isChoseongQuery("사과")===false`.
- [ ] **Step 5: 검증·커밋**
```bash
export PATH="/c/Program Files/nodejs:$PATH"
node node_modules/vitest/vitest.mjs run src/features/products && node node_modules/typescript/bin/tsc --noEmit
git add prisma src/features/products
git commit -m "상품 모델 마이그레이션과 ProductDb·초성 유틸 추가"
```

---

### Task 2 🔴: 상품 서비스 (CRUD + 소유권)

**Files:** Create `src/features/products/service.ts` + test.

**Interfaces:** `createProduct(db, sellerId, raw)`, `getProduct(db, id)`, `updateProduct(db, sellerId, id, raw)`, `deleteProduct(db, sellerId, id)`, `productInputSchema`(zod).

- [ ] **Step 1: 테스트(RED)** — 목 ProductDb:
  - create: 판매자 좌표(user.findUnique) 로드 → 없으면 `NO_LOCATION` 400. zod(title 1~40, description ≤2000, price ≥0 int, category enum, images 경로배열). `product.create` data에 `titleChoseong=toChoseong(title)`, `lat/lng`=판매자 좌표 스냅샷, images 연결. 반환 `{id}`.
  - get: 상세 반환(판매자 닉네임·regionLabel·상태·이미지). **응답에 판매자 email/phone/정확주소 없음**(판매자 select는 nickname·regionLabel만). 없거나 deletedAt→404.
  - update: 대상 로드→`sellerId !== userId`→`FORBIDDEN` 403. 제목 변경 시 titleChoseong 재계산. 없으면 404.
  - delete: 소유권→soft-delete(deletedAt). 타인→403.
- [ ] **Step 2: 구현** — 소유권 헬퍼 `assertOwner(db, id, userId)`(로드→404/403→반환). createProduct는 판매자 좌표+regionLabel 스냅샷. get은 공개 subset(seller select `{nickname, regionLabel}` 수준 — 단 regionLabel은 상품에 이미 복제됨). PII 미포함 단언.
- [ ] **Step 3: 통과·커밋**
```bash
node node_modules/vitest/vitest.mjs run src/features/products && node node_modules/typescript/bin/tsc --noEmit
git add src/features/products/service.ts src/features/products/service.test.ts
git commit -m "상품 등록·조회·수정·삭제 서비스와 소유권 검사 추가"
```

---

### Task 3 🔴: 상태머신

**Files:** Create `src/features/products/status.ts` + test.

- [ ] **Step 1: 테스트(RED)** — 전이표 검증: SELLING→RESERVED 통과, SELLING→SOLD 통과, RESERVED→SELLING 통과, RESERVED→SOLD 통과, SOLD→any → `INVALID_TRANSITION` 409, SELLING→SELLING(동일) → 무효 409(또는 no-op — 결정: 동일 상태는 INVALID_TRANSITION). 소유권: 타인→403. 없는 상품→404.
- [ ] **Step 2: 구현** `status.ts`:
```ts
import { AppError } from "@/features/_shared/error";
import type { ProductDb } from "./db";
import type { ProductStatus } from "@prisma/client";

export const TRANSITIONS: Record<ProductStatus, ProductStatus[]> = {
  SELLING: ["RESERVED", "SOLD"],
  RESERVED: ["SELLING", "SOLD"],
  SOLD: [],
};

export async function changeStatus(db: ProductDb, sellerId: string, id: string, next: ProductStatus): Promise<void> {
  const p = await db.product.findFirst({ where: { id, deletedAt: null }, select: { sellerId: true, status: true } });
  if (!p) throw new AppError("NOT_FOUND", "상품을 찾을 수 없어요.", 404);
  if (p.sellerId !== sellerId) throw new AppError("FORBIDDEN", "권한이 없어요.", 403);
  if (!TRANSITIONS[p.status].includes(next)) throw new AppError("INVALID_TRANSITION", "바꿀 수 없는 상태예요.", 409);
  await db.product.update({ where: { id }, data: { status: next } });
}
```
- [ ] **Step 3: 통과·커밋**
```bash
node node_modules/vitest/vitest.mjs run src/features/products && node node_modules/typescript/bin/tsc --noEmit
git add src/features/products/status.ts src/features/products/status.test.ts
git commit -m "상품 상태머신(판매중·예약중·판매완료) 추가"
```

---

### Task 4 🔴: 검색 (haversine + 필터 + 초성 + 페이지네이션)

**Files:** Create `src/features/products/search.ts` + test.

**Interfaces:** `searchProducts(db, params): Promise<{ items, nextCursor }>`, `searchSchema`(zod: lat/lng/radiusKm/category/minPrice/maxPrice/q/cursor/limit).

- [ ] **Step 1: 테스트(RED)** — 목 `$queryRaw`(호출 인자·바인딩 검증) + 로직:
  - lat/lng/radius 있으면 haversine 경로(거리 계산·반경 필터·거리순), 없으면 최신순.
  - category·price 범위 필터가 쿼리에 반영.
  - q 초성이면 titleChoseong, 아니면 title 매칭.
  - 기본 `deletedAt IS NULL`, status 필터(기본 SOLD 제외 or SELLING만 — 결정: 기본 판매완료 제외).
  - 응답 items는 카드 subset(판매자 PII·정확좌표 없음, distanceKm만).
  - **SQL 인젝션:** q에 `'; DROP` 같은 값 넣어도 파라미터 바인딩(문자열 미결합) 확인 — `$queryRaw` 태그드 템플릿 인자로만 전달.
  - 페이지네이션: limit+1 조회→nextCursor.
- [ ] **Step 2: 구현** — `Prisma.sql`/태그드 `$queryRaw`로 동적 WHERE 조립(조건별 `Prisma.sql` 조각 + `Prisma.join`), haversine `6371*acos(cos(radians(?))*cos(radians(lat))*cos(radians(lng)-radians(?))+sin(radians(?))*sin(radians(lat)))`. 모든 사용자 입력은 바인딩 파라미터. `@prisma/client`의 `Prisma.sql`, `Prisma.empty`, `Prisma.join` 사용. (raw SQL은 단위테스트에서 목으로 인자 검증 + Task 7 E2E 실 DB 검증.)
- [ ] **Step 3: 통과·커밋**
```bash
node node_modules/vitest/vitest.mjs run src/features/products && node node_modules/typescript/bin/tsc --noEmit
git add src/features/products/search.ts src/features/products/search.test.ts
git commit -m "상품 거리검색(haversine)·필터·초성·페이지네이션 추가"
```

---

### Task 5 🟢: 이미지 업로드 + 라우트 배선

**Files:** Create `src/features/products/images.ts`, `src/app/api/products/images/route.ts`, `src/app/api/products/route.ts`(GET list/POST create), `[id]/route.ts`(GET/PATCH/DELETE), `[id]/status/route.ts`, `src/app/api/media/[...path]/route.ts`(정적 서빙).

- [ ] **Step 1: 이미지 업로드** `images.ts` — multipart File 검증(mime image/*, ≤5MB) → `media/products/<uuid>.<ext>` 저장(`MEDIA_DIR` env 또는 `/app/media`, dev는 로컬 `./media`) → `{ path }`. 확장자 화이트리스트, 파일명은 uuid(트래버설 방지). fs 실패→503.
- [ ] **Step 2: 라우트 배선** — 설계 G절 7개 라우트. 변경 작업(POST/PATCH/DELETE/status/images)은 `requireActiveUser(prisma, req)` → 서비스(소유권은 서비스 내). GET(목록·상세)은 무인증. media 서빙 라우트는 경로 정규화·`media/` 밖 접근 차단.
- [ ] **Step 3: 검증·커밋** — 라우트 단위 테스트(GUEST GET 200, GUEST POST 401, 타인 PATCH 403, 업로드 검증). 수동: 등록→검색→상세.
```bash
node node_modules/vitest/vitest.mjs run && node node_modules/typescript/bin/tsc --noEmit
git add src/features/products/images.ts src/app/api/products src/app/api/media
git commit -m "상품 라우트·이미지 업로드·미디어 서빙 추가"
```

---

### Task 6 🟢: UI + 카탈로그

**Files:** Create `src/features/products/*.tsx`(목록·상세·폼·검색바), `src/app/products/{page,new,[id]/page,[id]/edit/page}.tsx` + tests. Modify catalogs.

- [ ] **Step 1: 카탈로그** `product.*`(카테고리 라벨·상태 라벨·등록/수정·가격·나눔·검색·반경·거리·직거래장소·에러 등). 양 로케일 평어체.
- [ ] **Step 2: 컴포넌트(TDD)** — 목록(카드 그리드+검색바: 카테고리/가격/반경/q), 상세(이미지·정보·상태, 소유자면 수정/삭제/상태버튼·비소유자 채팅[#4 스텁 disabled]), 등록/수정 폼(active USER, 위치 미설정 안내). fetch→코드→카탈로그, 서버원문 미렌더.
- [ ] **Step 3: 페이지** — `/products`(SSR 초기 검색 또는 클라 fetch), `/products/[id]`(SSR getProduct 404), `/products/new`·`[id]/edit`(로그인 가드). 좌표·PII 미표시.
- [ ] **Step 4: 통과·빌드·커밋**
```bash
node node_modules/vitest/vitest.mjs run && node node_modules/typescript/bin/tsc --noEmit && node node_modules/next/dist/bin/next build
git add src/features/products src/app/products src/i18n/messages
git commit -m "상품 목록·상세·등록·검색 UI와 한/영 메시지 추가"
```

---

### Task 7 🟢: E2E + #7용 조회 + 워크로그

**Files:** Create `e2e/products.spec.ts`, `docs/worklog/2026-07-24-products-search.md`; add `src/features/products/sales-status.ts`(#7용 조회) + test.

- [ ] **Step 1: #7용 판매 상태 조회** `sales-status.ts` — `countActiveSales(db, userId)`(SELLING/RESERVED, deletedAt null), `hasRecentSold(db, userId, days)`(SOLD & updatedAt within days). #7 withdrawable 가드가 주입할 함수. 단위테스트.
- [ ] **Step 2: E2E**(`test.use({locale:"ko-KR"})`, unique 유저, 실 DB) — 위치 설정→상품 등록→목록/상세 조회→검색(카테고리·반경 haversine 실쿼리)→상태변경(SELLING→RESERVED→SOLD, 무효전이 409)→타인 수정 403→GUEST 등록 401→검색어 인젝션 무해. 응답·페이지에 정확좌표·판매자 PII 없음(assert). 이미지 업로드(best-effort).
- [ ] **Step 3: 실행·점검**
```bash
export PATH="/c/Program Files/nodejs:$PATH"
docker compose up -d db && node node_modules/prisma/build/index.js migrate deploy && node node_modules/@playwright/test/cli.js test
node node_modules/typescript/bin/tsc --noEmit && node node_modules/vitest/vitest.mjs run && node node_modules/next/dist/bin/next build
docker compose exec -T db psql -U app -d app -c 'SELECT "lat","lng" FROM "Product" LIMIT 3;'  # 거친 좌표(소수2) 확인
```
Expected: 전 스펙 green, 상품 좌표 소수 2자리, 응답 PII 없음.
- [ ] **Step 4: 워크로그·커밋** — 형식(무엇을/왜/결정/편차, 태스크표, **검토중점**(좌표 프라이버시·소유권·SQL인젝션·상태머신), DoD 8항). 커밋:
```bash
git add e2e/products.spec.ts src/features/products/sales-status.ts src/features/products/sales-status.test.ts docs/worklog/2026-07-24-products-search.md
git commit -m "상품 E2E·판매상태 조회(#7용)·워크로그 추가"
```

---

## DoD — 설계 K절과 동일 (1~8)
## 범위 밖 — 채팅/거래 실동작 #4, 에스크로 #5, 탈퇴가드 실규칙 #7, 강제삭제 #6.
