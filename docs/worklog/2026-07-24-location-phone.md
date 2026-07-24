# 워크로그 — #1b 위치·전화인증(동네 지오코딩·전화 SMS OTP)

기록 원칙: 시간순, 각 항목은 **무엇을 / 왜 / 결정 / 편차·이슈**. 결과보다 결정의 흐름을 남긴다.

---

## 0. 스코프

- **무엇:** #1a(인증 코어)+#1a-ext-1(OAuth)+#1a-ext-2(2FA·step-up) 위에, 사용자가 동네(시/도·시/군/구·동)를 입력하면 지오코딩(Kakao 실제 또는 목)해 **반올림 좌표**(소수 2자리, ≈1.1km)와 동네 문자열만 저장하고, 전화번호는 SMS(Octomo 실제 또는 목) OTP로 검증해 `phoneVerifiedAt`을 세우는 기능을 얹는다 — `/settings/location`·`/settings/phone` 페이지 포함.
- **왜:** 중고거래 특성상 "근처 동네" 매칭·연락 신뢰(전화 인증)가 필요하지만, 정확한 집 위치나 전화번호 평문이 서버·로그·응답 어디에도 노출되면 안 된다. 이번 서브프로젝트의 존재 이유 자체가 "위치는 쓰되 정확좌표는 저장하지 않는다"는 프라이버시 제약이다.
- **결정:** 서브에이전트 구동(SDD), 태스크 6개로 분해, 브랜치 하나(`feat/location-phone`, 새 브랜치 생성/전환/머지 금지). 카덴스는 태스크 1·5·6 🟢(구현+메인 diff점검), 태스크 2~4 🔴(적대적 리뷰+fix루프) — 좌표 반올림(geocoder)과 전화 OTP(phoneOtp)·서비스(setLocation/전화 검증)가 프라이버시·보안 핵심이라 리뷰 비중을 높였다. 전체 태스크를 가로지르는 별도 최종 opus 리뷰는 아직 수행되지 않음(이 워크로그 범위 밖 — 7절 참고).

## 1. 태스크 실행 로그

| # | 태스크 | 결과 | 편차·결정 |
|---|--------|------|-----------|
| 1 | `PhoneOtp` 모델+`User`(lat/lng/regionCiphertext/phoneVerifiedAt) 역관계, 마이그레이션, env(`KAKAO_LOCAL_API_KEY`/`OCTOMO_API_KEY`/`OCTOMO_SENDER`), 감사 4종(`LOCATION_SET`/`PHONE_OTP_SENT`/`PHONE_VERIFIED`/`PHONE_VERIFY_FAIL`) | ✅ | 273/273, tsc clean. **Prisma 7.8에서 `migrate diff` 플래그가 `--to-schema`로 개명**(브리프가 가정한 구 플래그와 다름) — 실제 CLI로 확인 후 새 플래그로 진행. `20260723151030_auth_core`(ext-1 유산)의 체크섬 드리프트가 여전히 남아 있어 `migrate dev`가 막히므로 이번에도 diff+deploy로 회피(근본 해결 아님 — 6절 재이관). |
| 2 | 지오코더 어댑터(`geocoder/{geocoder,mock,kakao}.ts`)+`coarsen` | ✅ 적대적 리뷰 clean | 난이도 중 — **프라이버시 핵심.** `coarsen`은 절삭(`Math.trunc`)이 아니라 반올림(`Math.round`)으로 소수 2자리(≈1.1km)에 맞춘다 — 예: `37.126→37.13`. 절삭과 반올림이 다른 결과를 내는 경계값(`.xx5` 근처)으로 "진짜 반올림"임을 증명하는 테스트를 추가. 목 지오코더는 결정적(region 문자열의 sha256 해시로 좌표 산출)·네트워크 없음·대한민국 좌표 범위(위도 33~39, 경도 124~132)를 수학적으로 보장. Kakao 실 어댑터는 region 문자열(동네)만 지오코딩 대상으로 삼고, API 키는 헤더로만 전달하며 실패 시 원문 응답을 그대로 노출하지 않음. 284/284. |
| 3 | 전화 SMS 어댑터(목)+`phoneOtp.ts`(발급·검증) | ✅ 적대적 리뷰 clean | 난이도 중 — 2FA의 `emailOtp.ts` 패턴을 그대로 미러링. bcrypt 해시만 저장(코드 평문·전화번호 평문 미저장·미로그), 조회·매칭은 `phoneBlindIndex`(HMAC)로 하고 SMS 발송 시에만 복호화한 평문을 잠깐 씀. 1회용(소비 시 `consumedAt`)·만료(5분)·재발송 레이트리밋(30초) 순서로 가드. 소비되었거나 만료된 코드는 재검증해도 다시 `true`가 될 수 없음을 단언하는 테스트 포함. 301/301. |
| 4 | `service.ts`(`setLocation`/`startPhoneVerification`/`confirmPhoneVerification`)+세 라우트(`/api/auth/location`, `/api/auth/phone/{send,verify}`) | ✅ 적대적 리뷰 clean | 난이도 중상 — `setLocation`은 지오코딩 결과의 `coarsen()` 결과(반올림 좌표)**만** DB에 쓰고 응답에도 `region` 문자열만 돌려준다(정확좌표가 응답에 없음을 negative 단언하는 테스트로 증명). `PHONE_TAKEN`(409)은 `phoneBlindIndex`가 같고 `phoneVerifiedAt`이 이미 채워진 **다른** 계정이 있을 때만 걸리도록 쿼리를 정확히 함(`id: { not: userId }`). 세 라우트 모두 클라이언트가 보내는 `userId`를 신뢰하지 않고 refresh 쿠키(`currentUserFromRefresh`)로만 신원을 확정. psql로 실제 저장된 좌표가 반올림돼 있음을 수동 확인. 324/324. Minor(PHONE_TAKEN 시도에 감사로그 없음)는 이관됐고 이번 태스크까지 미해결. |
| 5 | UI(`LocationSettings`/`PhoneVerify`)+`/settings/location`·`/settings/phone` 페이지+한/영 카탈로그 | ✅ 메인 diff점검 통과 | 난이도 중 — `/settings/location` 페이지는 `prisma.user.findUnique`에서 **`regionCiphertext`만 select**하고 `lat`/`lng`는 쿼리 자체에 넣지 않는다(주석으로 "좌표는 절대 조회하지 않는다" 명시) — 페이지가 좌표를 아예 들고 있지 않으므로 실수로라도 렌더링될 여지가 없는 구조. `LocationSettings`도 서버 응답의 `region` 필드만 상태로 갖는다. 기존 카탈로그 키(예: `auth.phone`)와 신규 `location.*`/`phone.*` 네임스페이스가 충돌하지 않게 확인. 334/334, build green. |
| 6 | E2E(`e2e/location.spec.ts`)+PII 점검+워크로그(본 문서) | ✅ (본 문서) | 아래 2~6절 참고. `e2e/oauth.spec.ts`류의 통합 충돌은 이번엔 없었음(이 브랜치가 로그인/OAuth 콜백 경로를 건드리지 않았기 때문 — 2FA 브랜치와 다른 지점). |

## 2. E2E 실행 결과 (`e2e/location.spec.ts`, 3개 테스트)

1. **register → login → `/settings/location` 페이지에서 동네 입력·저장 → 화면에 반영, 좌표 미노출** — ✅.
   - 페이지 레벨: `/settings/location` 방문 시 "위치 설정" 제목과 "아직 설정하지 않았어요"가 먼저 보이고, 시/도·시/군/구·동을 채워 저장 버튼을 누르면 "저장했어요"와 "현재 동네: 서울특별시 마포구 합정동"이 실제 렌더로 나타남을 확인.
   - 좌표 미노출(페이지): `src/features/location/geocoder/mock.ts`의 결정적 알고리즘(sha256 해시 기반)을 테스트 코드에서 그대로 재계산해, 이번 저장으로 실제 DB에 들어갔을 반올림 좌표 문자열(예: `"33.xx"`/`"1xx.xx"`)을 미리 구한 뒤 페이지 HTML 전체(`page.content()`)에 그 문자열이 없는지 직접 단언 — 막연한 정규식이 아니라 실제 유출 후보 값을 겨눈 검증이다. `"lat":`/`"lng":` 형태의 JSON 키 노출도 없음을 함께 확인.
   - 좌표 미노출(응답): 같은 세션으로 다시 `POST /api/auth/location`을 호출해 응답 바디가 정확히 `{ region: "..." }` 하나의 키만 가짐(`Object.keys(body)` 단언)을 확인 — `lat`/`lng` 필드 자체가 존재하지 않는다(`undefined`가 아니라 키 부재).
2. **로그인 없이 위치 라우트 호출 → 401** — ✅. refresh 쿠키 없는 새 `request` 컨텍스트로 `POST /api/auth/location` → 401.
3. **로그인 상태에서 전화 인증 발송 200, 오코드 검증 401** — ✅. `POST /api/auth/phone/send` → `200 { ok: true }`. 이어서 `POST /api/auth/phone/verify`에 임의의 6자리(`"000000"`)를 보내면 `401`과 `code: "PHONE_VERIFY_FAILED"`.

## 3. 전화 인증 E2E 커버리지의 한계 (명시)

dev 환경의 SMS는 `ConsoleSms`(콘솔에 `"[SMS] 인증코드 발송(목)"`만 찍고 코드·전화번호는 남기지 않음)다. 실제 발송된 6자리 코드 값은 로그에도 응답에도 노출되지 않으므로, Playwright(실 서버·실 DB)는 그 코드를 어떤 경로로도 읽어낼 수 없다 — TOTP처럼 클라이언트가 시크릿으로 코드를 스스로 계산할 방법도 없다(전화 OTP는 서버가 무작위로 뽑아 SMS로만 보내는 순수 난수). 이 저장소는 `OCTOMO_API_KEY`가 없으면 콘솔 목만 쓰도록 설계돼 있어(실 Octomo 연동은 범위 밖, L절), 이 한계는 인프라 선택의 직접적 결과다.

따라서:
- **전화 인증의 해피패스(정확한 코드로 `phoneVerifiedAt`이 실제로 세워지는 경로)는 E2E가 아니라 단위/서비스 테스트로만 증명된다** — `src/features/location/phone/phoneOtp.test.ts`(발급·bcrypt 해시·1회용·만료·레이트리밋), `src/features/location/service.test.ts`(`confirmPhoneVerification`이 성공 시 `phoneVerifiedAt`을 세우고 `PHONE_TAKEN` 충돌을 정확히 가려내는지), `src/app/api/auth/phone/{send,verify}/route.test.ts`(라우트 레벨 200/401/409).
- `e2e/location.spec.ts`는 브리프 지시대로 위치 설정(전 과정 실증)과 전화 쪽은 "발송 200 + 오코드 401"(코드를 모르니 실패 경로만) 두 가지로 좁혔다.
- 이는 태스크 6 브리프에 이미 명시된 결정이며(`.superpowers/sdd/task-6-brief.md` "전화 인증" 절), 새로 발견한 갭이 아니라 계획대로 실행한 결과다.

## 4. DoD 6개 항목 검증 결과

1. **동네 주소 입력→지오코딩(목/실제)→반올림 좌표+regionCiphertext 저장, 상세좌표 미저장** — ✅. 유닛(`geocoder.test.ts`의 반올림 경계 테스트, `service.test.ts`의 negative 단언)+E2E(2절 테스트 1: psql 없이도 결정적 목 알고리즘 재계산으로 페이지·응답에 정확좌표가 없음을 직접 증명)+psql(5절: `lat`/`lng`가 소수 2자리).
2. **전화 SMS 인증(목 코드 발송→검증)→phoneVerifiedAt, 오코드·만료·재사용 거부** — ✅(유닛 레벨 해피패스, E2E는 오코드 실패 경로만 — 3절 한계). `phoneOtp.test.ts`/`service.test.ts`가 정확한 코드 성공, 오코드·만료·소비된 코드 재사용 실패를 모두 증명.
3. **전화 코드 bcrypt·1회용·레이트리밋, 좌표 반올림, 로그·응답에 평문/정확좌표 없음** — ✅. psql(5절)로 `codeHash`가 `$2b$10$...` bcrypt 형식임을, `lat`/`lng`가 반올림값임을 확인. grep(5절)으로 SMS 목의 고정 로그 한 줄 외엔 `console.log`가 없음을 확인.
4. **위치·전화 설정 UI 한/영, 로그인 필요** — ✅. E2E 테스트 1(한국어 렌더 실증)+테스트 2(로그인 없이 401). 영어 카탈로그는 태스크 5에서 `en.json`에 동일 키로 채워졌고 두 페이지 모두 `useTranslations`/`getTranslations`만 쓰고 한국어를 하드코딩하지 않으므로(2FA 워크로그의 전례와 동일 근거) 별도 영어 E2E 없이 코드로 확인.
5. **키 있으면 실제(Kakao/Octomo) 동작(수동), 없으면 목으로 전 기능·테스트** — ✅(목 경로). `KAKAO_LOCAL_API_KEY`/`OCTOMO_API_KEY`가 로컬 `.env`에 없으므로 이번 전체 검증(유닛+E2E+build)은 전부 목 경로로 실행됐고, 그 목 경로가 결정적으로 대한민국 좌표 범위를 보장함은 태스크 2에서 이미 증명됨(진행표 참고). 실 Kakao/Octomo 키를 넣은 수동 확인은 이번 태스크의 범위가 아니며(L절), 이번 태스크에서도 수행하지 않았다.
6. **전체 테스트 통과** — ✅. 아래 5절의 실제 출력.

## 5. 실행한 검증 명령과 실제 출력

```
docker compose up -d db                                 → Running (기존 컨테이너 재사용)
DATABASE_URL=postgresql://app:app@localhost:5432/app pnpm exec prisma migrate deploy
                                                          → 4 migrations found, No pending migrations to apply.
pnpm exec playwright test                                → 19 passed (0 failed)
                                                            (e2e/health.spec.ts 2/2, e2e/auth.spec.ts 7/7,
                                                             e2e/location.spec.ts 3/3, e2e/twofactor.spec.ts 3/3,
                                                             e2e/oauth.spec.ts 4/4 — 전부 그린, 통합 충돌 없음)
pnpm exec tsc --noEmit                                   → 출력 없음(클린)
pnpm test                                                → Test Files 44 passed / Tests 334 passed
pnpm build                                               → 성공(Turbopack). 최초 1회 EPERM(.next\static\... unlink)
                                                            발생 — OneDrive 동기화가 잠근 잔여 `.next` 산출물로
                                                            추정(코드 변경과 무관), `.next` 삭제 후 재빌드하니
                                                            바로 성공. 3개 위치/전화 라우트(`/api/auth/location`,
                                                            `/api/auth/phone/{send,verify}`) 포함 전 라우트 동적(ƒ)
```

**PII/프라이버시 점검 1 — `User.lat`/`lng`/`regionCiphertext`:**

```
docker compose exec -T db psql -U app -d app -c 'SELECT "lat","lng","regionCiphertext" FROM "User" WHERE "lat" IS NOT NULL LIMIT 5;'
```
```
  lat  |  lng   |                                      regionCiphertext
-------+--------+--------------------------------------------------------------------------------------------
 33.64 | 128.81 | ntzMtcYwvcsSewje.FjjIF+yIaljJg4HlnEyrLQ==.DoC5/09P9qy5HrI/D7oB/KdzaA4sXd8+FpQxTxEMXGllxkc=
 33.64 | 128.81 | iBxaxBvjdaC0A7KC.FXokEm1jzMIHV4ZCYcabZA==.LTskC479l8LG4mHZCBPBYn5ur3nM9yN/SzEcb5kbx+7hT5A=
(2 rows)
```
`lat`/`lng` 모두 소수 2자리(coarsen 그대로) — 정확좌표(예: 소수 5~6자리 GPS 정밀도)가 아니다. `regionCiphertext`는 `iv.tag.ciphertext`(AES-256-GCM) 형태의 암호문이지 평문 동네 주소가 아니다. (두 행은 이번 태스크의 `e2e/location.spec.ts` 실행이 만든 유저 — 같은 목 지오코더 알고리즘이 결정적이라 두 유저가 우연히 같은 좌표를 냈다.)

**PII/프라이버시 점검 2 — `PhoneOtp.codeHash`:**

```
docker compose exec -T db psql -U app -d app -c 'SELECT "codeHash" FROM "PhoneOtp" LIMIT 5;'
```
```
                           codeHash
--------------------------------------------------------------
 $2b$10$ZnA3m4opj47NuR.42kU/K.uh5OTZM2DnmWvoPbK6MGM01Q806sXwu
 $2b$10$w7FwMP2Z.YCnP6cQeobfEO5vUpwZVzUpTMC8tz08wxtIWBnAaZgSq
(2 rows)
```
`$2b$10$...` — bcrypt 해시(6자리 코드 평문이 아니다).

**PII/프라이버시 점검 3 — 로그 grep:**
```
grep -rn "console.log" src/features/location src/app/api/auth/location src/app/api/auth/phone
```
```
src/features/location/phone/sms.ts:18:    console.log("[SMS] 인증코드 발송(목)"); // 코드·전화 미기록
```
`ConsoleSms.send`가 인자를 받지 않고 고정 문자열만 찍는 목 로그 — 수신 전화번호도, 코드도 남기지 않는다. `src/app/api/auth/location`·`src/app/api/auth/phone` 라우트 파일에는 매치가 아예 없다.

## 6. 파일 변경 (이 태스크)

- 생성: `e2e/location.spec.ts`, `docs/worklog/2026-07-24-location-phone.md`(본 문서)
- `src/`, `prisma/schema.prisma`, `docker-compose.yml`은 이 태스크에서 손대지 않았다.

## 7. 남은 알려진 갭 (다음 단계로 이관)

- **마이그레이션 체크섬 드리프트(`20260723151030_auth_core`)** — ext-1 태스크10 적용 이후 그 SQL 파일에 주석이 편집돼 Prisma 체크섬이 드리프트됐다. `migrate deploy`는 체크섬을 재검증하지 않아 무해하지만 `migrate dev`는 이 드리프트에서 막힌다. #1a-ext-1 태스크1(이 저장소에서 처음 발견), #1a-ext-2 전체, 그리고 이번 #1b 태스크1까지 diff+deploy 폴백만 써 왔고 근본 해결(`prisma migrate resolve --applied` 등)은 아직 하지 않았다 — 유지보수 항목으로 계속 이관.
- **전화 인증 해피패스 E2E 부재** — 3절에 명시한 대로 콘솔 목 SMS라는 인프라 선택의 직접 결과이며, 단위/서비스 테스트로 대체 커버됐다. 실 Octomo 연동(범위 밖, L절) 이후에 웹훅/테스트 전화번호 등으로 코드를 읽어올 방법이 생기면 그때 E2E로 승격 가능.
- **Task 4(#1b)의 Minor 이관 — `PHONE_TAKEN` 충돌 시도에 감사로그 없음** — 진행표에 기록된 항목으로, 이번 태스크에서 새로 확인하거나 고치지 않았다(`src/` 미변경).
- **최종 브랜치 opus 리뷰** — #1a-ext-1·#1a-ext-2의 선례처럼 6개 태스크 전체를 가로지르는 교차 리뷰는 아직 수행되지 않았다. 이 워크로그는 태스크 6(E2E)까지의 기록이며, 최종 리뷰는 별도 단계로 남아 있다.

## 최종 whole-branch 리뷰(opus) → 검토 중점·이관 항목

Critical 0. 좌표 프라이버시 코어(정확좌표 미저장·미반환·미표시)는 전 경로 견고 확인. 아래는 리뷰가 조립 관점에서 짚은 항목(코드 블로커 아님, 문서화·이관).

**전화 유일성은 best-effort(중요 — 정정):** `confirmPhoneVerification`의 "한 전화 = 한 검증계정"은 읽기-후-쓰기 검사이며 DB 제약이 없다. 같은 번호로 등록한 두 계정이 **동시에** `/phone/verify`를 호출하면 둘 다 검사를 통과해 둘 다 `phoneVerifiedAt`이 세워질 수 있는 TOCTOU가 있다. 설계 §확정결정이 이를 "선택적 강제"로 명시했으므로 머지 블로커는 아니나, 워크로그 4절의 "정확히 가려냄"은 **단일 요청 기준**임을 여기서 정정한다.

**실 SMS 전 하드닝 세트(1c 또는 실 Octomo 연동 시):**
1. 전화 유일성 durable화 — `phoneBlindIndex`에 부분 유니크 인덱스(`WHERE "phoneVerifiedAt" IS NOT NULL`) 또는 검사+갱신을 트랜잭션+행잠금으로.
2. `PHONE_TAKEN` 충돌에 감사 이벤트 추가(악용 모니터링).
3. 코드 검증 시도 횟수 제한(현재 5분 TTL 내 무제한 추측 — bcrypt+단일활성코드로 성공확률 <~0.5%/window지만, 실 SMS면 피해자 번호를 자기 계정에 얹고 온라인 추측 가능).

**Octomo 배선(설계 §D↔§L 정합):** `getSms()`는 `OCTOMO_API_KEY` 유무와 무관하게 항상 `ConsoleSms`를 반환한다(실 Octomo 미구현, §L 배선 대상). 키가 있어도 코드는 콘솔로만 가고 전송되지 않으므로 검증이 완결되지 않는다(안전 실패 — 우회 없음). 설계 §D의 "키 있으면 Octomo" 문구는 목표이고 현 구현은 §L 배연 대기 상태다.

**마이그레이션 체크섬 드리프트(3연속 재발):** `20260723151030_auth_core`가 적용 후 편집돼 `migrate dev`를 막는다(`migrate deploy`는 무관). 별도 유지보수 태스크로 `prisma migrate resolve` 예정.

- OTP 유틸 중복(emailOtp↔phoneOtp), getSms 경고 캐시 동작은 저위험 이관.
