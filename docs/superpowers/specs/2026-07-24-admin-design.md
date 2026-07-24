# #6 관리자 설계

작성일: 2026-07-24
상태: 승인됨 (자율 결정)
선행: #1~#5 완료. 문서화 방침(goal): 주요내용·검토중점 기록.

## 목적

관리자 운영 도구 — 제재(정지/해제), 신고 관리(#4 채팅 신고 처리), 강제 삭제(상품), 에스크로 분쟁 조정(#5 resolve 활용), 대시보드. 신뢰·안전(Trust & Safety)의 최종 관문.

**범위 원칙:** 관리자 액션 + 목록/대시보드까지. 제재는 role 전환(정지/해제)만 — 강제 탈퇴(파기)는 위험이 커서 범위 밖. 신고 접수·저장은 #4에 이미 있음(#6은 처리). 에스크로 분쟁 `resolveDispute`는 #5에 이미 구현(requireAdmin) — #6은 목록·UI만 얹는다.

## 확정 결정 (자율 — 근거)

- **인가(중점):** 전 관리자 라우트 `requireAdmin`(DB-fresh role, #2 계승). 비관리자 403/게스트 401. 관리자 페이지는 서버에서 role 확인 후 아니면 리다이렉트.
- **제재 범위:** `suspendUser`(USER→SUSPENDED), `liftSuspension`(SUSPENDED→USER). **자기 자신·다른 관리자 정지 금지**(자물쇠 방지·권한 남용 방지) — 대상 role이 USER/SUSPENDED일 때만. DB-fresh RBAC가 이미 SUSPENDED를 전 경로에서 차단하므로 role 전환만으로 실효.
- **신고 처리:** Mongo `reports`의 status를 `open → resolved | dismissed`로. 목록(open 우선), 상세(관리자 전용 원문 snapshot 포함 — 이게 #4가 rawText를 관리자용으로 보존한 이유), 처리(resolve/dismiss + 선택적 제재 연동은 분리 — 관리자가 목록에서 신고 처리와 유저 정지를 각각). ChatRepo에 `listReports`·`updateReportStatus` 추가.
- **강제 삭제:** 상품 soft-delete(`deletedAt`), 소유권 무시(관리자 권한). 부적절 게시물 제거. 되돌릴 수 있게 soft(하드 삭제 아님). 감사 로그 필수.
- **에스크로 분쟁:** `listDisputedEscrows`(DISPUTED 목록, 상품·양측 닉네임·금액) 제공. 조정은 #5 `resolveDispute`(이미 requireAdmin 라우트 `/api/escrow/[id]/resolve`) 재사용 — #6은 관리자 대시보드에서 그 라우트를 호출하는 UI만.
- **대시보드:** 집계 카운트(전체 유저·정지 유저·상품 상태별·open 신고·진행 에스크로·분쟁 에스크로). 읽기 전용, PII 없음(수치만).
- **감사 로그(중점):** 모든 관리자 액션을 `AuthAuditLog`에 기록(`event`: `ADMIN_SUSPEND`/`ADMIN_LIFT`/`ADMIN_FORCE_DELETE`/`ADMIN_RESOLVE_REPORT`/`ADMIN_DISMISS_REPORT`, `userId`=대상 또는 관리자). 새 마이그레이션 불요(AuthAuditLog 재사용, event는 String).
- **PII 최소:** 관리자 화면은 닉네임·id·수치·신고 원문(snapshot)만. 이메일/전화는 복호화하지 않는다(복호화 표면 최소화 — 관리자도 PII 원문 불요, 닉네임으로 식별).

## A. 데이터 — 마이그레이션 없음

- Postgres: `User.role`(정지), `Product.deletedAt`(강제삭제), `Escrow.status`(분쟁 목록), `AuthAuditLog`(관리자 액션) — 전부 기존 모델 재사용.
- Mongo `reports`: `status` 값 확장(`open|resolved|dismissed`). `Report` 타입의 status 유니온 확장, `listReports(opts)`·`updateReportStatus(id, status)` 추가(InMemory+Mongo).
- `AdminDb = Pick<PrismaClient, "user"|"product"|"escrow"|"authAuditLog">`(`src/features/admin/db.ts`).

## B. 서비스 (`src/features/admin/service.ts`)

- `suspendUser(db, adminId, targetId)` — 대상 로드, 없으면 404, **대상이 ADMIN이면 `CANNOT_SANCTION_ADMIN` 403**, 이미 SUSPENDED면 멱등(또는 409). `adminId===targetId`면 `CANNOT_SANCTION_SELF` 400. role=SUSPENDED, 감사 로그.
- `liftSuspension(db, adminId, targetId)` — 대상 SUSPENDED면 role=USER, 감사 로그. 아니면 409(정지 상태 아님).
- `forceDeleteProduct(db, adminId, productId)` — 상품 로드(없거나 이미 삭제면 404), `deletedAt=now`, 감사 로그. 소유권 무시.
- `listReports(repo, db, opts?)` — Mongo `reports`(open 우선·최신순) + 신고자/대상 닉네임 보강(Postgres). 반환 `{ id, reporterNickname, targetType, targetLabel, reason, snapshot, status, createdAt }`. snapshot은 관리자 전용 원문.
- `resolveReport(repo, adminId, reportId, action: 'resolve'|'dismiss')` — status 갱신, 감사 로그.
- `listDisputedEscrows(db)` — Escrow status=DISPUTED, 상품 제목·양측 닉네임·금액·분쟁 시각. (조정은 #5 라우트.)
- `dashboardStats(db, repo)` — `{ users, suspended, products:{selling,reserved,sold}, openReports, activeEscrows, disputedEscrows }`. 집계 카운트만.

## C. REST 엔드포인트 (`src/app/api/admin/*`) — 전부 requireAdmin

- `GET /api/admin/dashboard` — dashboardStats.
- `GET /api/admin/reports` — listReports.
- `POST /api/admin/reports/[id]/resolve` — body `{action:'resolve'|'dismiss'}`.
- `POST /api/admin/users/[id]/suspend` / `POST /api/admin/users/[id]/lift`.
- `POST /api/admin/products/[id]/force-delete`.
- `GET /api/admin/disputes` — listDisputedEscrows.
- (분쟁 조정은 기존 `POST /api/escrow/[id]/resolve` 재사용.)
- 얇은 라우트, `requireAdmin`, `withErrorHandling`. 관리자 id는 인증에서만.

## D. UI (한/영 평어체) — 관리자 전용

- `/admin`(대시보드: 카운트 카드 + 신고/분쟁 바로가기), `/admin/reports`(신고 목록·처리·해당 유저 정지 버튼), `/admin/disputes`(분쟁 에스크로 목록·release/refund 버튼→`/api/escrow/[id]/resolve`), `/admin/users`(선택: 신고에서 유저 정지로 충분하면 목록은 최소).
- 페이지 진입 시 서버에서 `requireAdmin`류 확인 — 비관리자는 접근 불가(리다이렉트/404). 코드→카탈로그. 신규 `admin.*` 카탈로그.
- 헤더/내비에 관리자 링크는 role=ADMIN일 때만 노출.

## E. 보안·프라이버시 규약 (검토 중점)

- **인가:** 전 라우트·페이지 requireAdmin(비관리자 403/401, 페이지 리다이렉트). DB-fresh role.
- **권한 남용 방지:** 자기 정지 금지, 다른 관리자 정지 금지(관리자 상호 무력화·자물쇠 방지).
- **감사:** 모든 관리자 액션 AuthAuditLog 기록(누가·무엇을·대상).
- **신고 원문:** snapshot(원문 비속어)은 관리자 화면에만 — #4의 rawText 관리자 전용 보존과 정합.
- **PII 최소:** 이메일/전화 복호화 안 함(닉네임·id·수치만). 대시보드는 집계 수치.
- **강제 삭제:** soft-delete(되돌림 가능), 감사. 하드 삭제 없음.
- 에러 마스킹 유지.

## F. 테스트

- service: suspend(자기/다른관리자 금지·정지·감사), lift(정지상태만), forceDelete(soft·소유권무시·감사·이미삭제 404), listReports(닉네임 보강·snapshot 포함), resolveReport(status·감사), listDisputedEscrows, dashboardStats(집계).
- repo: InMemory listReports/updateReportStatus 왕복.
- 라우트: 각 라우트 requireAdmin(GUEST 401·USER 403), 관리자 id 인증에서만, 입력 검증.
- E2E: 관리자 승격(psql) → 대시보드 조회 → 유저 정지(그 유저 실제 403 확인) → 해제 → 상품 강제삭제(목록서 사라짐) → 신고 목록·처리 → 분쟁 에스크로 조정. 비관리자 403.

## G. 완료 기준 (DoD)

1. 관리자 인가(전 라우트·페이지 requireAdmin, 비관리자 차단)
2. 제재(정지/해제, 자기·타관리자 정지 금지), DB-fresh 실효
3. 신고 관리(목록·원문 snapshot·처리), 강제 삭제(soft·감사)
4. 에스크로 분쟁 목록 + 조정(#5 resolve 재사용)
5. 대시보드 집계(PII 없음), 모든 액션 감사 로그
6. UI 한/영, 관리자 전용 접근
7. 전체 테스트 통과

## H. 범위 밖
- 강제 탈퇴(계정 파기) → 위험, 범위 밖. 채팅 메시지 강제삭제 → 이후. 신고 자동제재·ML → YAGNI. 관리자 권한 세분화(역할 계층) → 단일 ADMIN.

## 커밋/브랜치
- `feat/admin`. 🔴(서비스·인가·권한남용방지·감사)=적대적 리뷰. 🟢(repo확장·라우트·UI·E2E)=메인 점검. 최종 opus. 짧은 한글 커밋.
