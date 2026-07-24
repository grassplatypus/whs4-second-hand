# 데모 구동 가이드

동네 중고거래 플랫폼 데모를 실행하는 두 가지 방법. 둘 다 Postgres(회원·상품·에스크로·감사)와 MongoDB(채팅·신고) 두 저장소를 쓴다.

---

## 사전 준비

- Docker + Docker Compose
- (개발 모드만) Node 22+, pnpm
- `.env`는 이미 컨테이너 네트워크 기준(`DATABASE_URL`은 compose가 `db:5432`로, `MONGO_URL=mongodb://mongo:27017/chat`)으로 맞춰져 있다.

---

## 방법 A — 전체 컨테이너 (권장, 운영에 가까움)

```bash
# 1) DB·Mongo 기동
docker compose up -d db mongo

# 2) 마이그레이션 적용(최초 1회, 또는 스키마 변경 시)
#    web 이미지는 마이그레이션을 자동 실행하지 않는다 — 호스트에서 한 번 적용한다.
export DATABASE_URL="postgresql://app:app@localhost:5432/app"
pnpm exec prisma migrate deploy      # node PATH 없으면: node node_modules/prisma/build/index.js migrate deploy

# 3) 웹(Next)·WS(socket.io) 컨테이너 빌드·기동
docker compose up -d --build web ws

# 4) 확인
curl http://localhost:3000/api/health          # {"status":"ok"} 류
# 브라우저: http://localhost:3000
```

- `web`(3000)·`ws`(4000) 모두 `db`·`mongo` healthcheck 통과 후 시작한다.
- 상품 이미지는 `media` 볼륨에 저장(EXIF/GPS 제거·다운사이징된 webp).

## 방법 B — 개발 모드 (빠른 반복)

```bash
# 1) DB·Mongo 기동 (mongo도 호스트 127.0.0.1:27017로 발행됨 — 별도 릴레이 불필요)
docker compose up -d db mongo

# 2) 마이그레이션
export DATABASE_URL="postgresql://app:app@localhost:5432/app"
pnpm exec prisma migrate deploy

# 3) 개발 서버(호스트에서 직접)
export MONGO_URL="mongodb://localhost:27017/chat"   # 호스트에서는 localhost
pnpm dev                                             # 또는 node node_modules/next/dist/bin/next dev
```

---

## 데모 데이터 채우기

```bash
node scripts/seed-demo-full.mjs   # 상품·대화·안전거래(약속·정산·후기)·프로필 사진까지 한 번에
node scripts/seed-demo.mjs        # 여러 동네 상품을 더 넣고 싶을 때
```

## 데모 시나리오 (핵심 흐름)

1. **회원가입·로그인** — `/signup`, `/login`. 이메일 OTP·2FA(TOTP/이메일)·OAuth 지원. 위치(동네)는 `/mypage`에서 설정(거친 좌표만 저장).
2. **상품 등록·검색** — `/products/new`(위치 필수)에서 등록 → `/products`에서 반경·카테고리·가격·초성 검색. 좌표는 동네 수준만 노출.
3. **채팅** — 상품 상세에서 "채팅하기" → `/chat/[id]`. 비속어 마스킹과 보내기 전 확인, 첫 답장 전 이미지 차단, 사진 미리보기, 읽음 표시·안 읽은 개수, 방 나가기(상대가 새로 보내면 재등장), 전화번호·계좌 밑줄 표시와 사기 이력 확인, 이유를 고르는 신고.
4. **안전거래(에스크로)** — 상품 상세에서 "안전거래 요청"(금액 제안) → `/escrow/[id]`. 요청→조정→입금(보관)→수령확인(정산)/반환. 직거래 약속(장소·시간)을 잡고, 정산 뒤에는 후기(좋아요·보통·별로 + 한마디)를 남긴다. 분쟁 접수 가능.
5. **관리자** — ADMIN 계정으로 `/admin`(대시보드)·`/admin/reports`(신고 처리·유저 정지·해제, 자동 감지 건 배지)·`/admin/disputes`(분쟁 조정)·`/admin/chat-rooms`(휴면 채팅방 개별·일괄 정리). 관리자 승격은 현재 DB 직접(운영 도구 범위): `docker compose exec -T db psql -U app -d app -c "UPDATE \"User\" SET role='ADMIN' WHERE nickname='<닉네임>'"`.
6. **공개 프로필** — `/u/[닉네임]`에서 파는 물건과 받은 후기를 본다. 내 페이지(`/mypage`)에서는 프로필 사진 변경, 구매한 물건, 내 상품 숨기기·삭제.
7. **회원 탈퇴** — `/mypage`. 진행 중인 에스크로·판매중 상품·최근 7일 판매완료가 있으면 차단된다.

---

## 통합 검증 상태 (2026-07-24)

- 전체 빌드: green (Next standalone, 전 라우트 정상).
- 유닛: 885 passed. E2E: 50 passed (health·auth·2FA·oauth·location·profile·products·chat·escrow·admin 전 영역, 크로스 기능 흐름 포함).
- 저장소 이원화(Postgres+Mongo) 실연동 확인. mongo 호스트 발행으로 개발 모드에서 socat 릴레이 불필요.

## 주의 / 알려진 갭

- **실 외부 연동은 목(mock):** SMTP(이메일 OTP)·Kakao(OAuth)·SMS(전화 OTP)·PG(에스크로 결제)는 콘솔/목 처리 — 데모용. 실 배선은 각 어댑터 교체 지점에 표시.
- **채팅 실시간(WS):** 클라이언트가 아직 액세스 토큰을 보관하지 않아 브라우저에서 소켓을 열지 않는다. 대신 방을 열어 둔 동안 5초마다 새 메시지를 확인해 받아 온다(화면을 보고 있을 때만). 소켓이 열리면 그 경로는 쓰지 않는다. WS 서버 자체(인증·룸·마스킹 브로드캐스트)는 동작·테스트됨.
- **마이그레이션:** 이미지는 자동 적용 안 함 — `migrate deploy`를 최초 1회 수동 실행.
