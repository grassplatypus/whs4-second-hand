# 워크로그 — #3 상품 등록·거리검색(products-search)

기록 원칙: 시간순, 각 항목은 **무엇을 / 왜 / 결정 / 편차·이슈**. 결과보다 결정의 흐름을 남긴다.

---

## 0. 스코프

- **무엇:** 중고거래 상품 도메인 전체 — 모델/마이그레이션, 상품 CRUD(소유권 검사·NO_LOCATION 게이트), 판매 상태머신(SELLING/RESERVED/SOLD), haversine 반경검색(초성검색·카테고리/가격 필터·키셋 페이지네이션), 이미지 업로드(EXIF/GPS 제거·다운사이징·경로 트래버설 방어), 전 라우트·UI. 본 문서(태스크 7)는 이 전체를 실 DB로 관통하는 E2E, #7(회원탈퇴 가드)이 가져다 쓸 판매 상태 조회 함수, 그리고 서브프로젝트 워크로그.
- **왜:** #2(RBAC)가 "누가 로그인했는가/정지됐는가"를 봤다면, #3은 이 플랫폼의 핵심 자산인 "상품"을 다룬다 — 판매자의 집 위치를 특정할 수 있는 정확좌표를 절대 저장/노출하지 않으면서도(coarse 스냅샷 설계), 검색·소유권·상태전이가 실제 공격(SQL 인젝션, 경로 트래버설, 타인 상품 수정)에 견뎌야 한다. #7의 탈퇴 가드는 "진행 중인 거래가 있으면 탈퇴를 막는다"는 규칙을 세울 텐데, 그 규칙이 딛고 설 조회 함수(`countActiveSales`/`hasRecentSold`)를 미리 마련해 둔다.
- **결정:** 서브에이전트 구동(SDD), 태스크 7개, 브랜치 하나(`feat/products`, 새 브랜치 생성/전환/머지 금지). 카덴스: 소유권·SQL인젝션·좌표프라이버시·경로트래버설이 걸린 태스크(2·4·5)는 🔴 적대적 리뷰+fix루프, 나머지(1·3·6·7, 본 문서)는 🟢. 검토중점은 처음부터 4가지로 고정: 좌표 프라이버시(거친 스냅샷), 소유권, SQL인젝션(바인딩), 상태머신 유효전이 — 여기에 태스크 5에서 경로 트래버설·EXIF 제거가 추가됐다.

## 1. 태스크 실행 로그

| # | 태스크 | 결과 | 편차·결정 |
|---|--------|------|-----------|
| 1 | Product/ProductImage/ProductStatus/Category 마이그레이션, `ProductDb`, 초성유틸(`toChoseong`/`isChoseongQuery`) | ✅ 메인점검 통과 (commit 5c3e51a) | 난이도 하. 485 unit, tsc clean. |
| 2 | 상품 등록·조회·수정·삭제 서비스(`service.ts`) + 소유권 검사(`assertOwner`) | ✅ 적대적 리뷰+fix (commits 7a8f156, a9c38f1) | 난이도 중상. PII(seller는 nickname만), 소유권(없거나 삭제됨→404, 남의 것→403), NO_LOCATION 게이트(판매자 좌표 미설정 시 등록 차단), coarse 스냅샷이 그대로 정확히 저장되는지 확인. fix: `updateProduct`가 `Record<string,unknown>`을 쓰던 걸 `Prisma.ProductUpdateInput`으로 타입화(strict tsc 통과), zod `.parse()`(예외 시 500 위험)를 `.safeParse()` + `AppError INVALID_INPUT`(400)으로 교체. |
| 3 | 판매 상태머신(`status.ts`, `TRANSITIONS`) | ✅ 메인점검 통과 (commit 73437cd, 인라인 검증) | 난이도 하. SELLING↔RESERVED↔SOLD 중 SOLD는 종착(빈 배열), 검사 순서는 404(없음/삭제됨)→403(소유권)→409(무효전이), 실패 시 update 미호출을 19개 테스트로 증명. |
| 4 | haversine 반경검색(`search.ts`) — raw SQL, 카테고리/가격 필터, 초성/제목 검색, 키셋 페이지네이션 | ✅ 적대적 리뷰+fix (commits 75b0144, 72d7a19) | 난이도 상. **전 사용자 입력값이 `Prisma.sql` 바인딩 파라미터로만 전달**(문자열 이어붙이기 없음) — `'; DROP TABLE "Product";--`를 `q`에 넣는 단위테스트로 `sql.values`엔 있고 `sql.text`엔 없음을 직접 증명. acos 인자를 `LEAST(1, GREATEST(-1, …))`로 클램프(부동소수 오차로 NaN 방지). fix: 커서 필드에 zod 검증 추가(깨진 커서가 500이 아니라 400), `LIKE`의 `%`/`_` 이스케이프. |
| 5 | 이미지 업로드(`images.ts`, sharp)·전 라우트(`/api/products`, `[id]`, `[id]/status`, `images`)·미디어 서빙(`/api/media/[...path]`) | ✅ 적대적 리뷰 clean, Critical/Important 0 (commits 6431ea4, cc43d4e) | 난이도 상. 미디어 서빙 3중 방어(join→resolve→prefix 봉쇄), uuid 파일명(원본 파일명은 저장 경로에 절대 안 씀). **사용자 요구로 추가**: 원본 업로드를 sharp로 재처리해 EXIF/GPS를 절대 출력에 복사하지 않음(`.withMetadata()` 호출 자체가 없음) — 상품 사진의 GPS EXIF가 그대로 남으면 coarse 좌표 설계 전체가 무의미해지기 때문. 최대 변 1600px 다운사이징, webp 재인코딩으로 폴리글롯 방어까지 겸함. |
| 6 | UI(`ProductCard`/`ProductList`/`ProductDetail`/`ProductForm` + 4개 페이지) | ✅ 메인점검 통과 (commit 0882604) | 난이도 중. 공개정보만 렌더(PII 없음), `ProductDetailView` 타입 자체에서 lat/lng를 빼서 구조적으로 화면에 못 옮기게 함. 비소유자에게는 disabled 채팅 버튼(#4 스텁). |
| 7 | E2E(`e2e/products.spec.ts`) + `#7`용 판매상태 조회(`sales-status.ts`) + 검증 + 워크로그(본 문서) | ✅ (본 문서) | 아래 2~7절 참고. 실 버그 없음 — 소유권·SQL인젝션·좌표 노출 전부 설계대로 방어됨을 실 DB로 재확인. |

## 2. `sales-status.ts` — #7용 판매 상태 조회

`src/features/products/sales-status.ts`, 단위테스트 `sales-status.test.ts`(5개). #7의 `withdrawable` 탈퇴 가드가 주입해 쓸 순수 조회 함수 두 개 — 어떤 조건이면 탈퇴를 막을지(임계값·정책)는 여기서 정하지 않는다(그건 #7의 스코프).

- **`countActiveSales(db, userId)`**: `Product`에서 `sellerId = userId AND status IN (SELLING, RESERVED) AND deletedAt IS NULL`인 행 개수. 진행 중인 거래 수.
- **`hasRecentSold(db, userId, days)`**: `sellerId = userId AND status = SOLD AND updatedAt >= now - days AND deletedAt IS NULL`인 행이 하나라도 있는지(`findFirst` + null 체크로 boolean화). 최근 판매완료 여부.

단위테스트는 `db.product.count`/`db.product.findFirst` 목으로: 정확한 `where` 절 구성(상태 배열, `deletedAt: null`), 0건/존재 두 경우, cutoff 계산이 `now - days*86400000`에 근접(5초 오차 허용)함을 확인한다.

## 3. E2E 테스트 목록과 결과 (`e2e/products.spec.ts`, 6개 테스트)

1. **register → 위치설정 → 상품등록 → 목록/상세 공개조회 → 반경검색(haversine 실쿼리) → 좌표·PII 없음** — ✅. 서울 강남구 역삼동으로 위치 설정 후 상품 등록(201). `GET /api/products?category=DIGITAL`에 방금 만든 상품이 나타나고, 목록 응답 전체(JSON)에 이메일/전화가 없음을 확인. `GET /api/products/[id]`는 공개(인증 없이 조회 가능), `seller`가 `{nickname}` 딱 한 키뿐임을 `Object.keys`로 직접 확인, 응답 JSON에 이메일/전화 문자열이 전혀 없음. 좌표는 `src/features/location/geocoder/mock.ts`+`geocoder.ts`의 `coarsen()`을 스펙 안에서 그대로 미러링해 "이 정확한 값"을 우리도 미리 계산해 두고 — 상세 응답의 `lat`/`lng`가 그 값과 정확히 일치하면서(판매자 스냅샷이 그대로 저장됐는지) 소수 2자리 격자를 벗어나지 않는지(`n*100`이 정수에 근접) 둘 다 단언한다. `/products/[id]` 페이지 HTML도 이메일/전화/`"lat":`/`"lng":` JSON 흔적이 전혀 없음을 확인(타입 자체가 좌표를 빼므로 구조적으로 보장되지만, 실제 렌더 결과로도 재확인). 반경검색은 판매자 좌표 근방(5km)이면 포함되고, 지구 반대편에 가까운 좌표(위도1·경도104)·반경 1km면 제외됨을 **실 haversine SQL**로 직접 증명(둘 다 실제 필터링이 동작함을 보여주는 양성/음성 쌍).
2. **상태머신: SELLING→RESERVED→SOLD 성공, SOLD→SELLING(무효전이) 409** — ✅. `POST .../status`로 두 단계 전이 후 상세 조회로 `status: "SOLD"` 확인, 이어서 종착 상태에서의 역행 시도가 `409 INVALID_TRANSITION`으로 막힘.
3. **소유권: 다른 유저의 PATCH는 403 FORBIDDEN** — ✅. 서로 다른 브라우저 컨텍스트(쿠키 격리) 두 개로 유저 A/B를 분리 로그인, B가 A의 상품을 `PATCH`하면 403, 이후 A 시점에서 재조회해 제목이 실제로 안 바뀌었음을 확인.
4. **GUEST(세션 없음): 상품 등록은 401 UNAUTHENTICATED** — ✅. 쿠키 없는 최상위 `request`로 `POST /api/products` → 401.
5. **검색어 SQL 인젝션 페이로드는 에러 없이 무해하게 처리된다** — ✅. `q=' OR 1=1;--`를 실 쿼리스트링으로 보내 200 + 정상 구조(`items`/`nextCursor`)를 확인하고, 뒤이은 평범한 검색 호출도 여전히 정상 응답 — `Product` 테이블 자체가 살아있음(DROP TABLE이 실행되지 않았음)을 실행으로 재확인. 파라미터 바인딩 자체의 증명은 태스크 4의 단위테스트(`sql.text`에 `DROP TABLE` 없음)가 이미 커버하고, 본 E2E는 "실 서버·실 DB에서도 그 방어가 실제로 적용돼 있다"는 통합 증거.
6. **이미지 업로드(멀티파트) → 201 {path}, `GET /api/media/{path}`가 실제로 서빙한다** — ✅(best-effort 우려했으나 문제없이 통과). Playwright `request.post`의 `multipart` 옵션으로 최소 PNG 버퍼를 실제 파일처럼 첨부해 업로드 → `{path: "products/<uuid>.webp"}`, 이어서 그 경로로 미디어 서빙 호출 → 200 + `content-type: image/webp` + 바이트 본문 확인. sharp 재처리(원본 PNG → webp 재인코딩)까지 실 파이프라인으로 통과.

## 4. 실행한 검증 명령과 실제 출력

pnpm이 이 환경 PATH에 없어(node만 `/c/Program Files/nodejs`에 존재) 이전 워크로그들과 동일한 대체 경로를 썼다: Playwright 설정의 `webServer.command`(`pnpm dev`)는 그대로 못 쓰므로 `next dev`를 백그라운드로 직접 띄운 뒤(`reuseExistingServer: !process.env.CI`가 이미 뜬 서버를 재사용) `playwright test`를 돌리고, 끝나면 그 서버를 내리고 `next build`를 별도로 실행했다.

```
docker compose up -d db                                   → Running(기존 컨테이너 재사용)
DATABASE_URL=postgresql://app:app@localhost:5432/app \
  node node_modules/prisma/build/index.js migrate deploy   → 5 migrations found, No pending migrations to apply.
node node_modules/next/dist/bin/next dev                   → (백그라운드) 기동 확인(curl 200)
node node_modules/@playwright/test/cli.js test --reporter=list
                                                            → 35 passed (0 failed)
                                                              (health 2, auth 7, location 3, twofactor 3, oauth 4,
                                                               profile 6, rbac 4, products 6 — 전부 그린)
node node_modules/vitest/vitest.mjs run                    → Test Files 80 passed / Tests 641 passed
node node_modules/typescript/bin/tsc --noEmit              → 출력 없음(클린)
(next dev 프로세스 종료 후)
node node_modules/next/dist/bin/next build                 → 성공(Turbopack). /api/products, /api/products/[id],
                                                              /api/products/[id]/status, /api/products/images,
                                                              /api/media/[...path], /products, /products/[id],
                                                              /products/new, /products/[id]/edit 전부 정상 빌드
```

**psql로 좌표 확인(coarse 여부):**
```
docker compose exec -T db psql -U app -d app -c 'SELECT "lat","lng" FROM "Product" ORDER BY "createdAt" DESC LIMIT 5;'
```
```
  lat  |  lng
-------+--------
 35.52 | 129.84
 33.64 | 128.81
 34.61 | 129.96
 34.17 |  125.6
(4 rows)
```
전부 소수 2자리(≈1.1km 격자) — 정확 주소가 아니라 거친 스냅샷이 저장되고 있음을 실 DB에서 직접 확인. 반경검색 쿼리가 실제로 행을 반환하는지는 4개 항목 위주로 psql `SELECT`만으로 보긴 어려워, E2E 테스트 1(위 3절)이 실 서버·실 haversine SQL로 "근접 좌표+반경 5km → 포함, 원거리 좌표+반경 1km → 제외"를 직접 증명하는 방식으로 커버했다.

## 5. 검토 중점(설계 대응)

1. **좌표 프라이버시(거친 스냅샷)** — ✅. 상품은 판매자의 이미 반올림된(`coarsen()`, 소수 2자리) 좌표를 그대로 스냅샷 저장할 뿐, 정확 주소는 애초에 시스템 어디에도 없다(태스크 2 단위 + 본 태스크 E2E가 실 DB 값으로 재확인). **이미지 EXIF/GPS 제거**(태스크 5)가 이 설계를 보완 — 사진의 GPS 메타데이터가 좌표 프라이버시의 우회 통로가 되는 걸 막는다.
2. **소유권** — ✅. `assertOwner`가 없거나 삭제된 상품은 404, 남의 것은 403으로 구분(태스크 2 단위). 본 E2E가 실 서버로 타인 PATCH 403 + 무변경을 재확인.
3. **SQL 인젝션(바인딩)** — ✅. `searchProducts`의 모든 사용자 입력값이 `Prisma.sql` 태그드 템플릿으로만 전달되고(태스크 4 단위: `DROP TABLE` 페이로드가 `values`엔 있고 `text`엔 없음), 본 E2E가 실 서버·실 DB에 동일 페이로드를 보내 200 + 테이블 생존을 확인.
4. **상태머신 유효전이** — ✅. `TRANSITIONS`가 SOLD를 종착으로 고정(태스크 3 단위 19개). 본 E2E가 SELLING→RESERVED→SOLD 성공 + SOLD→SELLING 409를 실 서버로 재현.
5. **경로 트래버설 방어(태스크 5에서 추가된 중점)** — ✅. `/api/media/[...path]`가 join→resolve→prefix 포함검사 3중 방어(태스크 5 단위, 실 형제디렉터리 탈출 시도 케이스 포함). 본 E2E는 정상 업로드→서빙 경로만 통과시켰고(공격 케이스 재현은 태스크 5 스코프), 업로드가 서버 uuid 파일명으로 저장되고 사용자 파일명이 경로에 전혀 안 쓰임을 실제 업로드로 재확인.

## 6. DoD 8개 항목 검증 결과

1. **상품 등록/조회/수정/삭제, 소유권 검사** — ✅. 태스크 2 단위(519 unit 시점) + 본 E2E(등록·조회·소유권 403).
2. **판매자 좌표 없이는 등록 불가(NO_LOCATION), coarse 스냅샷만 저장** — ✅. 태스크 2 단위(NO_LOCATION 400, 스냅샷 정확성) + 본 태스크 psql 확인(전부 소수 2자리).
3. **판매 상태머신(SELLING/RESERVED/SOLD), 유효전이만 허용** — ✅. 태스크 3 단위 19개 + 본 E2E(실 전이 + 무효전이 409).
4. **haversine 반경검색, SQL 인젝션 차단(전 값 바인딩)** — ✅. 태스크 4 단위(DROP TABLE 페이로드 테스트) + 본 E2E(실 서버 인젝션 무해 확인, 실 반경 필터링 양성/음성 확인).
5. **이미지 업로드: 경로 트래버설 방어, EXIF/GPS 제거, 용량 제한/다운사이징** — ✅. 태스크 5 단위(3중 방어, EXIF round-trip 증명, 폴리글롯 방어) + 본 E2E(실 업로드→sharp 재처리→서빙 end-to-end).
6. **공개 조회 응답/화면에 판매자 PII·정확좌표 없음** — ✅. 태스크 2/6 단위 + 본 E2E(seller가 nickname 한 키뿐, 이메일/전화 부재를 API·페이지 HTML 양쪽에서 직접 확인, 좌표는 노출되더라도 coarse임을 값 단위로 확인).
7. **#7용 판매 상태 조회(`countActiveSales`/`hasRecentSold`) 준비** — ✅. 본 태스크(2절), 단위 5개.
8. **전체 테스트 통과** — ✅. E2E 35/35(products 6개 포함), 유닛 641/641, tsc clean, build green(4절).

## 7. 파일 변경 (이 태스크)

- 생성: `src/features/products/sales-status.ts`, `src/features/products/sales-status.test.ts`, `e2e/products.spec.ts`, `docs/worklog/2026-07-24-products-search.md`(본 문서)
- `src/features/products/`의 기존 파일(`service.ts`/`search.ts`/`status.ts`/`images.ts`/`db.ts`/UI 등), `prisma/schema.prisma`, `docker-compose.yml`, `playwright.config.ts`는 이 태스크에서 손대지 않았다.

## 8. 남은 알려진 갭 (다음 단계로 이관)

- **탈퇴 가드 실규칙(#7 본체)** — `countActiveSales`/`hasRecentSold`는 조회만 제공한다. "몇 건 이상이면 막을지", "recent 기준 며칠인지" 같은 정책과 `withdrawable` 가드 자체의 배선은 #7 스코프.
- **채팅/거래 실동작(#4), 에스크로(#5), 강제삭제·관리자 상품 조치(#6)** — 설계상 이 서브프로젝트 범위 밖. 상세 페이지의 disabled 채팅 버튼(태스크 6)이 그 경계를 UI로도 명시.
- **최종 branch 전체 opus 리뷰** — 이 워크로그는 태스크 7(E2E+워크로그)까지의 기록이며, #1/#2 계열 선례처럼 태스크 1~7 전체를 가로지르는 교차 리뷰는 이후 별도 단계.

## 최종 whole-branch 리뷰(opus) → Ready to merge

Critical/Important 0. 검토 중점 전부 조립 확인:
- **좌표 프라이버시(구조적):** 상품 lat/lng=판매자 거친좌표 스냅샷, `getProduct` seller select=nickname만, 카드/상세 뷰 타입에 lat/lng·seller 필드 없음, `[id]/page`는 sellerId를 isOwner 계산에만 쓰고 미전달. **이미지 EXIF/GPS는 sharp 재인코딩으로 구조적 제거**(withMetadata 미호출)+webp 강제.
- **SQL 인젝션:** 검색 전 값 Prisma.sql 바인딩(DROP payload가 sql.values에·sql.text에 없음 단언), LIKE ESCAPE, acos LEAST/GREATEST 클램프, decodeCursor 완전 검증(잘못된 커서 400).
- **소유권+RBAC:** 전 mutating 라우트 requireActiveUser(GUEST401/SUSPENDED403 DB-fresh)+서비스 sellerId 재검증(404전403). 상태 변경은 changeStatus만(PATCH 스키마에 status 없음→우회 불가), SOLD 종착.
- **path traversal:** media 서빙 null-byte거부→join→resolve→sep봉쇄, 미지 확장자→octet-stream.

이관 Minor(비블로커): ①클라 제공 이미지 경로 무검증 저장(비익스플로잇 — media가 read시 트래버설 차단·webp강제·public, defense-in-depth로 `^products/<uuid>.webp$` 검증 권장) ②`hasRecentSold`가 soldAt 없어 updatedAt 프록시 → **#7이 sold-time 의미(soldAt 컬럼 or SOLD 수정차단) 정의** ③검색 q max 없음(`.max(100)` 권장). 하드닝 티켓.
