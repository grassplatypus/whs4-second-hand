# #0 인프라 + 뼈대 설계

작성일: 2026-07-18
상태: 승인됨 (구현 대기)

## 목적

중고거래 플랫폼(전체 명세 참조)을 8개 하위 프로젝트로 분해한 것의 **0번**.
이후 모든 기능(#1 인증, #2 RBAC, #3 상품/거리검색, #4 채팅, #5 에스크로, #6 관리자, #7 탈퇴/차단 규칙)이
올라탈 실행 가능한 뼈대와 공용 인프라를 만든다.

**범위 원칙:** 비즈니스 로직 없음. 컨테이너가 뜨고, DB가 붙고, WS가 응답하고, 에러/환경/테스트 공용 기반이
검증되는 것까지만. 그 이상은 전부 #1 이후.

## 전체 하위 프로젝트 분해 (참고용)

| # | 하위 프로젝트 | 핵심 난제 | 의존 |
|---|---|---|---|
| 0 | 인프라 + 뼈대 | Docker Compose, Prisma 기반, 기능폴더 구조, WS 스텁 | — |
| 1 | 인증 + 회원 + 위치 | JWT access/refresh 회전, sliding session, AES-256, bcrypt, 주소→좌표, Octomo | 0 |
| 2 | RBAC 미들웨어 | GUEST/USER/SUSPENDED/ADMIN 게이트, 정지회원 전면차단, 에러 마스킹 | 1 |
| 3 | 상품 + 거리검색 | haversine 반경필터, 초성검색, 카테고리/가격 필터, 직거래 장소, 상태머신 | 1,2 |
| 4 | 채팅 | WebSocket, 첫메시지 멀티미디어 차단, 우회/비속어 감지(KO NLP), 차단규칙, 신고 | 1,2,3 |
| 5 | 에스크로 | 송금 상태머신(요청→조정→보관→정산/반환) | 1,3 |
| 6 | 관리자 | 제재, 신고관리, 강제삭제, 대시보드 | 2 |
| 7 | 탈퇴/차단 규칙 | 횡단관심사: 예약중·판매완료 7일내·거래중 가드 | 1,3,5 |

빌드 순서: 0 → 1 → 2 → 3 → {4,5} → 6. #7 규칙은 1/3/4/5에 삽입.

## 기술 스택 (확정)

- Next.js (App Router), TypeScript, Tailwind CSS, shadcn/ui
- Node 22, pnpm
- PostgreSQL 16, Prisma ORM
- 위치: `lat`/`lng` float 저장 + raw SQL **haversine** 반경 쿼리 (PostGIS 미사용, 명세의 "위경도 인덱싱" 허용 범위). 규모 확장 시 cube/earthdistance 확장으로 GiST 인덱스 도입 여지 남김.
- 실시간: **독립 WS 컨테이너**, socket.io (룸/재연결/폴백)
- 테스트: Vitest + React Testing Library (단위/통합), Playwright (E2E)

## A. 컨테이너 구성 (Docker Compose)

```
db     : postgres:16
         - named volume `pgdata`
         - healthcheck: pg_isready
web    : Next.js (App Router)
         - depends_on: db (service_healthy)
         - media 볼륨 마운트
ws     : Node socket.io 서버
         - depends_on: db (service_healthy)
         - media 볼륨 마운트
volumes: pgdata, media   # media = 로컬 미디어 저장소, 외부 클라우드 미사용
```

- 단일 `.env`: `DATABASE_URL`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `AES_KEY`, `WEB_PORT`, `WS_PORT`, `NODE_ENV`
- 개발 기동: `docker compose up`
- web/ws는 멀티스테이지 Dockerfile 또는 공용 베이스 이미지 재사용

## B. 저장소 폴더 구조 (기능 중심 아키텍처, 명세 §4)

```
src/
  app/                      # App Router 라우트 (얇게 유지, 로직은 features로 위임)
    api/health/route.ts
    (health)/page.tsx       # 헬스 상태 표시 페이지
  features/
    _shared/
      error.ts              # AppError, { code, message } 포맷, 라우트 래퍼
      env.ts                # zod 검증 환경변수
      prisma.ts             # PrismaClient 싱글톤
      validation.ts         # zod 헬퍼
    # auth/ products/ chat/ escrow/ admin/ 등은 이후 단계에서 추가 (지금은 없음)
  server/
    ws/
      index.ts              # socket.io 엔트리
      Dockerfile 스테이지
prisma/
  schema.prisma
docker-compose.yml
package.json
```

각 feature 폴더는 `components/`, `hooks/`, `api/`(비즈니스 로직), `schema/`를 내부에 격리한다(이후 단계).
지금은 `_shared`만 실제 내용이 있고 나머지는 없음.

## C. 헬스 슬라이스 (전체 연결 end-to-end 증명)

- **Prisma 모델**: `User` 스텁 — `id`, `email`, `lat Float?`, `lng Float?`, `createdAt`. (PostGIS 아님, float만.) 최초 마이그레이션 1개.
- **`GET /api/health`**: DB `SELECT 1` 확인 → `{ status: "ok", db: true, ts }` 반환. 실패 시 공용 에러 포맷.
- **WS**: 클라이언트 연결 → `ping` 수신 시 `pong` 응답. JWT 검증 훅은 **스텁**(지금은 아무 토큰이나 통과, 실제 검증은 #1).
- **UI**: shadcn/ui 초기화. 헬스 페이지가 `/api/health` + WS ping 결과 표시. 라벨은 평어체 — 예: "잘 돌아가고 있어요" / "연결에 문제가 있어요".

## D. 공용 인프라 (한 번 구축, 전 단계 재사용)

- **에러 처리** (`_shared/error.ts`):
  - `AppError { code, message, httpStatus, cause? }` 클래스
  - 클라이언트 응답은 항상 `{ code: string, message: string }`만
  - Next 라우트 핸들러 래퍼: 예외 포착 → prod에서는 스택/DB 내부구조 마스킹, 서버 로그에는 전체 상세 기록 (명세 §2 보안)
- **환경변수** (`_shared/env.ts`): zod 스키마로 부팅 시 검증, 누락 시 즉시 실패(fail fast)
- **Prisma** (`_shared/prisma.ts`): 개발 핫리로드 안전 싱글톤
- **테스트 셋업**:
  - Vitest + RTL 구성 + 헬스 로직 단위 테스트 1개(통과)
  - Playwright 구성 + 헬스 페이지 로드 E2E 1개(통과)
  - 명세 §5의 "코드 생성과 동시 테스트 자동 생성" 파이프라인이 이 단계부터 살아있음을 증명

## E. #0 범위 밖 (명시적 YAGNI)

다음은 전부 제외, #1 이후에서 처리:
- 인증 로직, 실제 JWT 발급/검증/회전, sliding session
- AES-256 암호화, bcrypt 해시
- 상품/채팅/에스크로/신고/차단 테이블 및 로직
- 주소→좌표 지오코딩, Daum 우편번호, Octomo 전화인증
- RBAC 권한 게이트(스텁만)
- 관리자 대시보드

## 완료 기준 (Definition of Done)

1. `docker compose up` → db/web/ws 세 컨테이너 healthcheck 모두 green
2. `GET /api/health` → `{ status: "ok", db: true, ... }` 200 응답
3. WS `ping` → `pong` 왕복 성공
4. 헬스 페이지가 브라우저에서 상태를 평어체로 표시
5. `pnpm test`(Vitest) + `pnpm test:e2e`(Playwright) 모두 통과
6. prod 모드에서 강제 에러 발생 시 클라이언트에 `{ code, message }`만 노출, 스택 미노출
7. 누락 env로 부팅 시 명확한 메시지와 함께 실패

## 커밋/브랜치 원칙 (명세 §4 준수)

- Co-Authored-By 금지
- 독립 작업은 브랜치 생성 → 리뷰 → merge
- 커밋 메시지는 한글로 구체적으로 (이슈번호 단독 금지)
