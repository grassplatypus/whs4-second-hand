# #4 채팅 설계

작성일: 2026-07-24
상태: 승인됨 (자율 결정)
선행: #1(회원)·#2(RBAC)·#3(상품) 완료. 문서화 방침(goal): 주요내용·검토중점 기록.

## 목적

상품 기준 1:1 실시간 채팅(구매자↔판매자). 첫 메시지 멀티미디어 차단, 한국어 비속어/우회 감지·마스킹, 사용자 차단, 신고. 실시간은 WS(socket.io), 저장은 **MongoDB**(사용자 지시: 채팅 이원화).

**범위 원칙:** 대화·메시지·실시간 전달·비속어필터·차단·신고까지. 거래(에스크로)는 #5. 신고 처리·제재는 #6.

## 확정 결정 (자율 — 근거)

- **저장소 이원화:** 관계형(Postgres)은 #1~#3, 채팅은 **MongoDB**(#0 결정 계승). `mongodb` 드라이버, lazy 싱글톤, repo 추상화(단위테스트는 in-memory fake — 실 Mongo 불요).
- **WS 인증(중점):** 핸드셰이크 `auth.token`(access JWT)을 `verifyAccessToken`으로 검증(스텁 교체). 미인증→연결 거부. SUSPENDED/deleted→거부(DB fresh, RBAC 계승). userId를 socket.data에.
- **대화 모델:** 상품별 (buyer, seller) 쌍당 1개. 구매자가 상품 상세에서 "채팅하기"로 시작. 판매자 자신에겐 시작 불가.
- **첫 메시지 멀티미디어 차단:** 새 대화의 **첫 메시지는 텍스트만**(이미지/미디어 금지) — 무분별 이미지 스팸 방지. 이후 메시지는 이미지 허용(#3 이미지 파이프라인 재사용: EXIF strip).
- **비속어/우회 감지:** 정규화(공백·특수문자 제거, 반복문자 축약, 초성 매칭) 후 금칙어 목록 매칭 → **마스킹**(예 `***`). 우회(ㅅㅂ, 시 발, 시1발) 잡도록 정규화. 저장은 원문+마스킹 플래그(관리자 판단용), 전달은 마스킹본. 과탐은 demo 허용.
- **차단:** userA가 userB 차단 → B는 A에게 새 메시지·대화 시작 불가. 차단 목록 Mongo.
- **신고:** 메시지/유저 신고 → Mongo `reports`(신고자·대상·사유·스냅샷). 처리는 #6.
- **읽음/타이핑:** 최소(읽음 표시 optional, 타이핑 optional). MVP는 메시지 송수신·이력·필터·차단·신고 우선.
- **전달 경로:** WS로 실시간 emit + Mongo 저장. 이력·대화목록은 REST(Next API, Mongo 조회). WS와 REST 모두 같은 서비스/repo.

## A. 저장소 (`src/features/chat/`)

- `mongo.ts` — `getDb(): Promise<Db>` lazy(`MONGO_URL`), `setMongoForTest(db)`. 컬렉션: `conversations`, `messages`, `blocks`, `reports`.
- `repo.ts` — `ChatRepo` 인터페이스(createConversation/findConversation/listConversations/insertMessage/listMessages/isBlocked/block/unblock/insertReport). Mongo 구현 + in-memory fake(테스트). 인덱스: conversations(productId, participants), messages(conversationId, createdAt), blocks(blockerId, blockedId).
- 스키마(문서): Conversation `{ _id, productId, sellerId, buyerId, createdAt, lastMessageAt }`. Message `{ _id, conversationId, senderId, kind:'text'|'image', text?, imagePath?, masked:bool, createdAt }`. Block `{ blockerId, blockedId, createdAt }`. Report `{ reporterId, targetType:'message'|'user', targetId, reason, snapshot, createdAt, status:'open' }`.

## B. 비속어 필터 (`src/features/chat/filter.ts`)

- `normalize(text): string` — 소문자, 공백·특수문자 제거, 반복 축약, (선택) 초성화.
- `maskProfanity(text): { masked: string; hit: boolean }` — 정규화본에서 금칙어(작은 KO 목록: 시발/씨발/개새끼/병신 등 + 초성/우회 변형) 매칭 → 원문의 해당 구간을 `*`로 치환. hit 플래그.
- 금칙어 목록은 데이터 파일(`profanity-words.ts`), 확장 용이.

## C. 서비스 (`src/features/chat/service.ts`)

- `startConversation(repo, buyerId, productId, firstText)` — 상품·판매자 로드(Postgres product), 판매자==buyer면 `AppError("SELF_CHAT", 400)`, 차단 관계면 `BLOCKED` 403, 첫 메시지 텍스트 필수·비어있으면 400. 기존 대화 있으면 재사용. 첫 메시지 저장(마스킹 적용). 반환 `{conversationId, message}`.
- `sendMessage(repo, senderId, conversationId, { kind, text?, imagePath? })` — 참여자 확인(아니면 403), 차단 확인, kind=image면 대화에 메시지 1건 이상 존재해야(첫 메시지 이미지 금지) 아니면 `FIRST_MSG_TEXT_ONLY` 400. 텍스트면 마스킹. 저장·lastMessageAt 갱신. 반환 message.
- `listConversations(repo, userId)` — 참여 대화 목록(상대 닉네임·상품 요약·마지막 메시지 시각). PII 없음.
- `listMessages(repo, userId, conversationId, cursor?)` — 참여자만, 페이지네이션.
- `blockUser(repo, userId, targetId)`·`unblock`. `reportMessage/reportUser(repo, reporterId, ...)`.

## D. WS 서버 (`src/server/ws/index.ts` 교체·확장)

- 핸드셰이크 미들웨어: `verifyAccessToken(auth.token)` → userId, null이면 next(Error) 연결 거부. (DB fresh SUSPENDED 검사는 WS 서버가 Postgres 접근 — 또는 access 토큰만으로 최소, SUSPENDED는 REST 게이트가 주 방어. WS는 인증만 필수, SUSPENDED는 best-effort.)
- 이벤트: `join`(conversationId → 참여자 확인 후 room join), `message`(sendMessage 서비스 호출 → 저장 → room에 emit `message`), `typing`(optional). 서버가 서비스/repo 사용(WS 서버는 별도 프로세스라 Mongo·Postgres 접근 필요).
- 재연결·룸은 socket.io 기본.

## E. REST 엔드포인트 (`src/app/api/chat/*`)

- `POST /api/chat/conversations` — active USER, startConversation(body productId, firstText). WS 없이도 대화 시작 가능.
- `GET /api/chat/conversations` — active USER, 목록.
- `GET /api/chat/conversations/[id]/messages` — active USER+참여자, 이력.
- `POST /api/chat/conversations/[id]/messages` — active USER+참여자, sendMessage(REST 폴백; 실시간은 WS).
- `POST /api/chat/block` / `unblock` — active USER.
- `POST /api/chat/report` — active USER.
- 얇은 라우트, `requireActiveUser`, `withErrorHandling`.

## F. UI (한/영 평어체)

- `/chat`(대화 목록), `/chat/[id]`(채팅방: 메시지 스트림, 텍스트/이미지 전송, 차단·신고 버튼). 상품 상세 "채팅하기"→startConversation→`/chat/[id]`.
- WS 클라(socket.io-client)로 실시간 수신, REST로 이력·전송 폴백. 마스킹본 표시. 서버 원문 렌더 금지(코드→카탈로그). 신규 카탈로그 `chat.*`.

## G. 보안·프라이버시 규약 (검토 중점)

- **WS 인증:** 실 JWT 검증, 미인증 거부. 룸 join은 참여자만(타인 대화 도청 불가).
- **참여자 격리:** listMessages/sendMessage는 대화 참여자만. 타인 대화 접근 403.
- **첫 메시지 텍스트:** 새 대화 첫 메시지 이미지 금지.
- **비속어 마스킹:** 전달·표시는 마스킹본. 원문은 관리자용으로만 저장(신고 스냅샷).
- **차단:** 차단 유저는 대화 시작·전송 불가.
- **이미지:** 채팅 이미지도 #3 파이프라인(EXIF strip). 첫 메시지 금지.
- **PII:** 대화 목록·메시지에 이메일/전화/정확좌표 없음(상대는 닉네임만).
- 에러 마스킹 유지. SUSPENDED는 REST 라우트서 차단(WS는 인증 필수).

## H. 테스트

- filter: 정규화, 마스킹(시발/우회/초성), 정상어 미탐, hit 플래그.
- service: startConversation(자기자신 400·차단 403·첫텍스트·재사용), sendMessage(참여자 403·첫이미지 금지·마스킹·저장), list(참여자만·PII 없음), block/report.
- repo: in-memory fake로 서비스 테스트. (Mongo 실연동은 E2E/수동.)
- WS: 인증 미들웨어(유효 토큰 통과·무효 거부), join 참여자 확인, message emit.
- 라우트/E2E: 대화 시작→메시지 송수신→비속어 마스킹→첫 이미지 차단→타인 대화 접근 403→차단→신고. GUEST 401.
- 응답에 PII·원문 비속어(전달 경로) 없음.

## I. 완료 기준 (DoD)

1. WS 실 JWT 인증(미인증 거부), 룸 참여자 격리
2. 상품 기준 1:1 대화 시작(자기자신·차단 방지), 실시간 송수신
3. 첫 메시지 멀티미디어 차단
4. 한국어 비속어/우회 감지·마스킹(전달·표시 마스킹본, 원문 관리자용)
5. 차단(차단 유저 대화·전송 불가), 신고(→#6용 저장)
6. 참여자만 이력/전송, 타인 접근 403, PII 없음
7. 전체 테스트 통과, UI 한/영

## J. 범위 밖
- 거래(에스크로) → #5. 신고 처리·제재 → #6. 그룹채팅·음성·영상통화 → YAGNI. 읽음/타이핑 고도화 → 이후.

## 커밋/브랜치
- `feat/chat`. 🔴(필터·서비스·WS인증·참여자격리)=적대적 리뷰. 🟢(repo/mongo·라우트·UI·E2E)=메인 점검. 최종 opus. 짧은 한글 커밋.
