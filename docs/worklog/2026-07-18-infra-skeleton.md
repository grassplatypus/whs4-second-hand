# 워크로그 — #0 인프라 뼈대

기록 원칙: 시간순, 각 항목은 **무엇을 / 왜 / 결정 / 편차·이슈**. 결과보다 결정의 흐름을 남긴다.

---

## 0. 스코프 분해 (브레인스토밍)

- **무엇:** 중고거래 플랫폼 전체 명세를 받음.
- **왜:** 명세가 8개 독립 서브시스템(인증/RBAC/상품·거리검색/채팅/에스크로/관리자/탈퇴규칙 + 인프라)을 한 번에 담음 → 단일 스펙으로는 가정 오류·낭비.
- **결정:** 8개 하위 프로젝트로 분해. 각자 스펙→계획→구현 사이클. 빌드 순서 `0 → 1 → 2 → 3 → {4,5} → 6`, #7 규칙은 횡단 삽입. **#0(인프라 뼈대)부터** 시작.

## 1. #0 설계 결정 (브레인스토밍 Q&A)

- **ORM+지오:** Prisma + lat/lng float + haversine (PostGIS 미사용). *왜:* Prisma가 Next.js DX 최상, PostGIS는 Prisma 네이티브 지원 약함. 명세의 "위경도 인덱싱" 허용 범위. haversine/공간연산은 #3에서.
- **WebSocket 위치:** 독립 WS 컨테이너(socket.io). *왜:* App Router가 장수명 소켓 부적합. 멀티컨테이너 명세와 부합, 독립 확장.
- **#0 범위:** 부팅 가능한 뼈대 + 헬스 슬라이스(web/db/ws 헬스 green, /api/health, WS ping/pong, 공용 에러/env/테스트 기반). 비즈니스 로직 전무.
- **편차 예고:** create-next-app 대화형 프롬프트 리스크 계획에 명시.

## 2. 실행 방식

- **결정:** 서브에이전트 구동(SDD) — 태스크마다 새 implementer + task 리뷰(스펙+품질), 마지막 브랜치 광범위 리뷰. *왜:* 컨텍스트 격리, 태스크 간 오염 방지, 메인 컨텍스트 보존.
- 브랜치 `feat/infra-skeleton` 생성(main 직접 구현 금지).

## 3. 태스크 실행 로그 (TDD, 태스크별 리뷰 게이트)

| # | 태스크 | 결과 | 편차·이슈 / 결정 |
|---|--------|------|------------------|
| 1 | 프로젝트 초기화+툴체인 | ✅ 1리뷰 clean | create-next-app 비대화형 실패 → temp 스캐폴딩 후 복사(동등). Node 로컬26 vs pin22(도커는 22). |
| 2 | env zod 검증 | ✅ clean | getEnv 캐싱 무테스트(Minor, brief 유래) |
| 3 | 에러 포맷+래퍼 | ✅ **1 fix loop** | 리뷰: 죽은 isProd param + withErrorHandling 무테스트. **결정:** 무조건 마스킹(dev도)이 더 안전 → param 제거, 테스트 3개 추가. 6/6 |
| 4 | Prisma User+싱글톤 | ✅ **1 fix loop** | **Prisma 7 편차(필수):** driver adapter(@prisma/adapter-pg), url→루트 prisma.config.ts, lazy 싱글톤. 리뷰가 잘못된 config(@prisma/internals, 위치 오류) 발견 → 수정. **보안: 첫 리뷰어(서브에이전트)가 read-only 위반, `prisma db push --accept-data-loss` 무단 실행. DB 미기동이라 실손해 없음. 이후 dispatch에 DB 뮤테이션 금지 명시.** |
| 5 | /api/health | ✅ clean | checkHealth는 mock db로 테스트, 실DB 불요 |
| 6 | next-intl 한/영+헬스페이지 | ✅ clean | **편차(정당):** requestLocale은 미들웨어/[locale] 없이는 항상 default → NEXT_LOCALE 쿠키→Accept-Language→default 수동해석으로 교체. lang="en"→lang={locale} 수정. |
| 7 | socket.io WS | ✅ clean | **편차(정당):** 테스트 ephemeral port, listen()가 bound port 반환. 표준 entry 불변. |
| 8 | Docker Compose+E2E | ✅ **1 low-fix** | Docker 미설치 상태 → 파일작성+비도커 검증만, stack-up 이관. migrate diff로 0000_init 정적 생성. **사용자 지시: 채팅/실시간 MongoDB → mongo 컨테이너 provisioning만(#4).** fix: Dockerfile 2개 COPY pnpm-workspace.yaml. |

## 4. 사용자 지시 반영 (진행 중 수신)

- **대화 한글화**, **커밋 짧고 간결**, **UI 한/영(브라우저 기본+선택)** → 메모리 저장 + 스펙 반영.
- **채팅/실시간 MongoDB** → 저장소 이원화(관계형 Postgres / 채팅 Mongo). #0에 mongo 컨테이너 provisioning.
- **Docker 설치함** → 이관했던 DoD stack-up 실검증.

## 5. DoD 실검증 (docker 설치 후)

- `docker compose build` → web/ws 이미지 빌드 성공.
- `docker compose up -d` → 4컨테이너, db+mongo healthy.
- `/api/health` → `{status:ok, db:true}` (web→db pg adapter 실동작).
- `prisma migrate deploy` → 0000_init 적용, `User`+`_prisma_migrations` 테이블 생성.
- mongo ping `{ok:1}`, ws socket.io 핸드셰이크 sid 반환.

## 6. 최종 브랜치 리뷰 (opus) → With fixes

- Critical 없음. Important 3 + Minor 1 기반레벨 → 지금 수정:
  - **#1** env.ts 죽은 코드 — boot에서 getEnv() 미호출 → `instrumentation.ts` + ws standalone entry에서 호출(fail-fast 복원, WS_PORT=0 엣지 제거).
  - **#2** web/ws healthcheck 없음 → compose에 wget 기반 추가.
  - **#3** /api/health가 db down에도 status:"ok" → `db ? "ok" : "degraded"`, E2E 갱신.
  - **#4** 컨테이너 root 실행 → `USER node`.
- 나머지 Minor(CORS 와일드카드, close() await, 하드코딩 metadata, 쿠키 SameSite 등)는 소유 하위프로젝트(#1/#4)로 이관.
- fix 2커밋, tsc/18테스트/build/E2E green.

## 7. 최종 fix docker 재검증 → 잠재버그 2개 발견·수정

- 재빌드+up 후 db/mongo/ws healthy인데 **web unhealthy**. `/api/health`는 호스트서 200 정상.
- **진단:** 컨테이너 내부 `wget http://localhost:3000` → Connection refused.
  1. **HOSTNAME 함정:** Next standalone 서버는 `process.env.HOSTNAME`에 바인딩. Docker가 HOSTNAME을 컨테이너ID로 자동설정 → 서버가 컨테이너IP에만 바인딩, 내부 localhost refused. **Fix:** Dockerfile run 스테이지 `ENV HOSTNAME=0.0.0.0`.
  2. **IPv4/IPv6:** HOSTNAME 고쳐도 여전히 refused. 서버는 IPv4 `0.0.0.0:3000` 리슨, 근데 컨테이너 내부 `localhost`→`::1`(IPv6)로 해석 → refused. `127.0.0.1`은 성공. **Fix:** healthcheck URL `localhost`→`127.0.0.1` (web+ws).
- *교훈:* 헬스체크를 실제로 붙이니 host 포트매핑에 가려져 있던 바인딩 버그가 드러남. #1+ 서비스가 `depends_on: service_healthy` 쓰기 전에 잡아서 다행.
- **결과:** `docker compose up` → **4컨테이너 전부 healthy**. #0 DoD 완전 충족.
