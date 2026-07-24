# 위치(지오코딩) + 전화인증(#1b) 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`).

**Goal:** 동네 주소를 거친 좌표로 지오코딩(목/실제)하고 전화를 SMS로 인증(목/실제)하는 어댑터·서비스·라우트·UI를 구현한다.

**Architecture:** `src/features/location/`에 Geocoder·PhoneVerifier 어댑터(목/실제 토글), 좌표 반올림·전화 OTP 서비스를 모은다. 세션·crypto·감사·bcrypt·목어댑터 패턴은 #1a/ext 재사용. `PhoneOtp` 테이블 + `phoneVerifiedAt` 마이그레이션 1개. **프라이버시 최중점: 저장 좌표는 서비스가 소수 2자리로 반올림, 상세주소·정확좌표 미저장.**

**Tech Stack:** Next.js 16, Prisma 7, zod 4, bcryptjs(전화 OTP), Node crypto, next-intl 4, Vitest + Playwright.

**설계:** `docs/superpowers/specs/2026-07-24-location-phone-design.md`.

## Global Constraints

- **좌표 거칠게:** 지오코더 원시좌표를 그대로 저장 금지. 서비스가 `coarsen`(소수 2자리 반올림 ≈1.1km)으로 깎아 `lat`/`lng`에 저장. 상세주소 문자열·정확좌표는 어디에도 저장·로그·응답 금지.
- **PII:** 동네 문자열 `regionCiphertext`=encryptPII, 전화 `phoneCiphertext`(기존). 전화 OTP 코드 bcrypt 해시만, 평문 코드·전화는 SMS 발송에만. 로그·감사·응답에 평문 금지.
- **OTP:** 1회용(consumedAt)·5분 만료·재발송 30초 레이트리밋. 실패 일반 401.
- **어댑터 목/실제 토글:** 키(KAKAO_LOCAL_API_KEY, OCTOMO_*) 없으면 목으로 전 기능·테스트 동작. 목은 네트워크 없음·결정적.
- 위치·전화 설정 라우트는 로그인 필요(currentUserFromRefresh). 클라 에러는 코드→카탈로그, 서버 원문 렌더 금지. UI 문자열 카탈로그, 한글 평어체.
- TypeScript strict. 커밋 짧은 한글, Co-Authored-By 금지. 브랜치 `feat/location-phone`(생성됨). Node 빌트인 테스트는 `// @vitest-environment node`.

## 실행 카덴스

🔴 적대적 리뷰+fix(geocoder+coarsen·phone OTP·서비스). 🟢 구현+메인 diff점검(마이그레이션·UI·E2E). 브랜치 하나, 최종 opus 리뷰.

## File Structure

| 파일 | 책임 | 태스크 |
|---|---|---|
| `prisma/schema.prisma`+마이그레이션 | PhoneOtp·phoneVerifiedAt·back-relation | 1 |
| `src/features/_shared/env.ts`·`auth/db.ts`·`auth/audit.ts`(수정) | env·emailOtp→phoneOtp 표면·이벤트 | 1 |
| `src/features/location/geocoder/{geocoder,mock,kakao}.ts` | 주소→좌표 어댑터 | 2 |
| `src/features/location/phone/{sms,mock,octomo,phoneOtp}.ts` | SMS 어댑터+전화 OTP | 3 |
| `src/features/location/service.ts` | setLocation·coarsen·전화검증 | 4 |
| `src/app/api/auth/location`·`phone/{send,verify}` 라우트 | 얇은 라우트 | 4 |
| `src/features/location/LocationSettings.tsx`·`PhoneVerify.tsx` + 페이지 | UI | 5 |
| `src/i18n/messages/*`(수정) | location·phone 카탈로그 | 5 |
| `e2e/location.spec.ts`·워크로그 | E2E·기록 | 6 |

---

### Task 1 🟢: 마이그레이션 + env + AuthDb + 감사

**Files:** Modify schema.prisma(+migration), env.ts, auth/db.ts, auth/audit.ts, .env(.example).

**Interfaces:** `PhoneOtp` 모델, `User.phoneVerifiedAt`, `AuthDb`+`phoneOtp`, 감사 4종, env 3종(optional).

- [ ] **Step 1: 스키마**

`prisma/schema.prisma`에 추가:
```prisma
model PhoneOtp {
  id              String    @id @default(cuid())
  userId          String
  user            User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  phoneBlindIndex String
  codeHash        String
  expiresAt       DateTime
  consumedAt      DateTime?
  createdAt       DateTime  @default(now())
  @@index([userId])
}
```
`User`에: `phoneVerifiedAt DateTime?` + `phoneOtps PhoneOtp[]`.

- [ ] **Step 2: 마이그레이션** — `docker compose up -d db` → `prisma migrate dev --name location_phone` (TTY 실패 시 diff+deploy 폴백, 폴더 `YYYYMMDDHHMMSS_location_phone`). psql로 `PhoneOtp` 테이블·`User.phoneVerifiedAt` 확인.

- [ ] **Step 3: env·AuthDb·감사**

env.ts schema에:
```ts
  KAKAO_LOCAL_API_KEY: z.string().optional(),
  OCTOMO_API_KEY: z.string().optional(),
  OCTOMO_SENDER: z.string().optional(),
```
db.ts: `AuthDb = Pick<PrismaClient, "user"|"session"|"authAuditLog"|"authIdentity"|"emailOtp"|"phoneOtp">`.
audit.ts AUTH_EVENTS에: `PHONE_OTP_SENT`, `PHONE_VERIFIED`, `PHONE_VERIFY_FAIL`, `LOCATION_SET`.

- [ ] **Step 4: 검증·커밋**
```bash
pnpm exec tsc --noEmit && pnpm test
git add prisma src/features/_shared/env.ts src/features/auth/db.ts src/features/auth/audit.ts .env.example
git commit -m "전화인증 PhoneOtp 마이그레이션과 위치·전화 env·감사 이벤트 추가"
```

---

### Task 2 🔴: Geocoder 어댑터 + coarsen

**Files:** Create `src/features/location/geocoder/{geocoder,mock,kakao}.ts` + tests. `coarsen`은 여기(geocoder.ts)에 export하되 저장 강제는 Task 4 서비스.

**Interfaces:**
- `interface RegionInput { sido: string; sigungu: string; dong: string }`
- `interface GeoResult { lat: number; lng: number; region: string }`
- `interface Geocoder { geocode(input): Promise<GeoResult> }`, `getGeocoder(): Geocoder`
- `coarsen(lat: number, lng: number): { lat: number; lng: number }` — 소수 2자리 반올림

- [ ] **Step 1: 테스트 (RED)** `geocoder.test.ts`(`// @vitest-environment node`):
  - `coarsen(37.123456, 127.987654)` → `{lat:37.12, lng:127.99}` (소수 2자리)
  - 목 geocode: 같은 RegionInput → 같은 좌표(결정적), 좌표가 한국 범위(위 33~39, 경 124~132), region 문자열이 입력 동네 포함
  - 다른 동네 → 다른 좌표
  - `getGeocoder()`가 키 없으면 목 반환(키 없는 테스트 env)

- [ ] **Step 2: 구현**

`src/features/location/geocoder/geocoder.ts`:
```ts
import { getEnv } from "@/features/_shared/env";
import { makeMockGeocoder } from "./mock";
import { KakaoGeocoder } from "./kakao";

export interface RegionInput { sido: string; sigungu: string; dong: string }
export interface GeoResult { lat: number; lng: number; region: string }
export interface Geocoder { geocode(input: RegionInput): Promise<GeoResult> }

/** 저장 좌표는 동네 중심으로 거칠게(소수 2자리 ≈1.1km) — 집 특정 방지. */
export function coarsen(lat: number, lng: number): { lat: number; lng: number } {
  return { lat: Math.round(lat * 100) / 100, lng: Math.round(lng * 100) / 100 };
}

export function getGeocoder(): Geocoder {
  const key = getEnv().KAKAO_LOCAL_API_KEY;
  return key ? new KakaoGeocoder(key) : makeMockGeocoder();
}
```

`src/features/location/geocoder/mock.ts` — 동네 문자열 SHA-256 해시로 한국 범위 내 결정적 좌표:
```ts
import { createHash } from "node:crypto";
import type { Geocoder, RegionInput, GeoResult } from "./geocoder";

export function makeMockGeocoder(): Geocoder {
  return {
    async geocode(input: RegionInput): Promise<GeoResult> {
      const region = `${input.sido} ${input.sigungu} ${input.dong}`.trim();
      const h = createHash("sha256").update(region).digest();
      // 위도 33~39, 경도 124~132 범위로 매핑(대한민국)
      const lat = 33 + (h.readUInt32BE(0) % 6000) / 1000;   // 33.000~38.999
      const lng = 124 + (h.readUInt32BE(4) % 8000) / 1000;  // 124.000~131.999
      return { lat, lng, region };
    },
  };
}
```

`src/features/location/geocoder/kakao.ts` — 실제(키 있을 때만). Kakao Local 주소검색 API 호출:
```ts
import { AppError } from "@/features/_shared/error";
import type { Geocoder, RegionInput, GeoResult } from "./geocoder";

const ENDPOINT = "https://dapi.kakao.com/v2/local/search/address.json";

export class KakaoGeocoder implements Geocoder {
  constructor(private apiKey: string) {}
  async geocode(input: RegionInput): Promise<GeoResult> {
    const region = `${input.sido} ${input.sigungu} ${input.dong}`.trim();
    const res = await fetch(`${ENDPOINT}?query=${encodeURIComponent(region)}`, {
      headers: { Authorization: `KakaoAK ${this.apiKey}` },
    });
    if (!res.ok) throw new AppError("GEOCODE_FAILED", "위치를 찾지 못했어요.", 502);
    const body = (await res.json()) as { documents?: { x: string; y: string }[] };
    const first = body.documents?.[0];
    if (!first) throw new AppError("GEOCODE_FAILED", "위치를 찾지 못했어요.", 502);
    return { lat: Number(first.y), lng: Number(first.x), region };
  }
}
```

- [ ] **Step 3: 통과·커밋**
```bash
pnpm exec vitest run src/features/location/geocoder && pnpm exec tsc --noEmit
git add src/features/location/geocoder
git commit -m "주소 지오코더 어댑터(Kakao 실제+목)와 좌표 반올림 추가"
```

---

### Task 3 🔴: PhoneVerifier 어댑터 + 전화 OTP

**Files:** Create `src/features/location/phone/{sms,mock,octomo,phoneOtp}.ts` + tests.

**Interfaces:**
- `interface Sms { send(phonePlaintext: string, code: string): Promise<void> }`, `getSms(): Sms`, `MemorySms`(테스트)
- `issuePhoneOtp(db, userId, phonePlaintext, phoneBlindIndex, sms, meta): Promise<void>`
- `verifyPhoneOtp(db, userId, code): Promise<boolean>`

- [ ] **Step 1: 테스트 (RED)** `phoneOtp.test.ts` — 목 AuthDb + MemorySms:
  - 발급: 6자리 코드, `create` data.codeHash가 bcrypt(`$2`), 평문 코드 payload에 없음, phoneBlindIndex 저장, MemorySms.body에 코드, 만료 미래, 기존 미소비 무효화
  - 레이트리밋: 30초 내 재발급 → `AppError` 429
  - 검증: 정상→true+consumedAt, 오코드→false, 만료→false, 소비→false
  - 로그·감사에 평문 전화·코드 없음(PHONE_OTP_SENT는 userId만)

- [ ] **Step 2: 구현**

`sms.ts`:
```ts
import { getEnv } from "@/features/_shared/env";

export interface Sms { send(phonePlaintext: string, code: string): Promise<void> }

export class MemorySms implements Sms {
  readonly sent: { code: string }[] = [];
  async send(_phone: string, code: string): Promise<void> { this.sent.push({ code }); }
}

class ConsoleSms implements Sms {
  async send(): Promise<void> { console.log("[SMS] 인증코드 발송(목)"); } // 코드·전화 미기록
}

let cached: Sms | null = null;
export function getSms(): Sms {
  if (cached) return cached;
  const env = getEnv();
  // OCTOMO_API_KEY 있으면 실 Octomo(이후). 지금은 목.
  cached = new ConsoleSms();
  if (env.OCTOMO_API_KEY) console.warn("[SMS] OCTOMO 설정됐으나 미구현 — 코드는 콘솔 목");
  return cached;
}
export function setSmsForTest(s: Sms | null): void { cached = s; }
```
> `octomo.ts`는 인터페이스 자리만(실 연동 이후) — 또는 파일 없이 ConsoleSms가 목. File Structure의 octomo.ts는 생략 가능.

`phoneOtp.ts` — emailOtp.ts와 동일 구조(bcrypt·1회용·레이트리밋), phoneBlindIndex 컬럼 포함, 발송은 `sms.send(phonePlaintext, code)`. `PHONE_OTP_SENT` 감사(userId만).

- [ ] **Step 3: 통과·커밋**
```bash
pnpm exec vitest run src/features/location/phone && pnpm exec tsc --noEmit
git add src/features/location/phone
git commit -m "전화 SMS 어댑터(목)와 전화 OTP 발급·검증 추가"
```

---

### Task 4 🔴: 위치·전화 서비스 + 라우트

**Files:** Create `src/features/location/service.ts` + test, `src/app/api/auth/location/route.ts`, `phone/send/route.ts`, `phone/verify/route.ts`.

**Interfaces:**
- `setLocation(db, userId, input: RegionInput, geocoder, meta): Promise<{ region: string }>`
- `startPhoneVerification(db, userId, sms, meta): Promise<void>`
- `confirmPhoneVerification(db, userId, code, meta): Promise<void>`
- `locationSchema`(zod: sido/sigungu/dong 비어있지 않음)

- [ ] **Step 1: 테스트 (RED)** `service.test.ts` — 목 AuthDb + 목 geocoder:
  - `setLocation`: geocode 결과(예 37.123456)가 `user.update`에 **반올림된**(37.12) lat/lng로 저장, `regionCiphertext`가 암호문(평문 region 아님), **상세좌표(37.123456) 미저장** 단언(`JSON.stringify(data)`에 정확좌표 문자열 없음), LOCATION_SET 감사, 반환에 좌표 없음
  - `startPhoneVerification`: 저장된 phoneCiphertext 복호화→issuePhoneOtp 호출(phoneBlindIndex 전달)
  - `confirmPhoneVerification`: verifyPhoneOtp 성공→phoneVerifiedAt 기록+PHONE_VERIFIED. 실패→AppError+PHONE_VERIFY_FAIL. (선택) 같은 phoneBlindIndex 다른 검증계정→PHONE_TAKEN 409

- [ ] **Step 2: 구현** `service.ts`:
```ts
import { z } from "zod";
import { encryptPII, decryptPII } from "@/features/_shared/crypto";
import { AppError } from "@/features/_shared/error";
import { AUTH_EVENTS, logAuthEvent, type RequestMeta } from "@/features/auth/audit";
import type { AuthDb } from "@/features/auth/db";
import { coarsen, type Geocoder, type RegionInput } from "./geocoder/geocoder";
import { issuePhoneOtp, verifyPhoneOtp } from "./phone/phoneOtp";
import type { Sms } from "./phone/sms";

export const locationSchema = z.object({
  sido: z.string().trim().min(1),
  sigungu: z.string().trim().min(1),
  dong: z.string().trim().min(1),
});

export async function setLocation(db: AuthDb, userId: string, input: RegionInput, geocoder: Geocoder, meta: RequestMeta): Promise<{ region: string }> {
  const result = await geocoder.geocode(input);
  const { lat, lng } = coarsen(result.lat, result.lng); // 저장 직전 반올림 — 정확좌표 저장 금지
  await db.user.update({ where: { id: userId }, data: { lat, lng, regionCiphertext: encryptPII(result.region) } });
  await logAuthEvent(db, AUTH_EVENTS.LOCATION_SET, userId, meta);
  return { region: result.region }; // 좌표는 반환하지 않는다
}

export async function startPhoneVerification(db: AuthDb, userId: string, sms: Sms, meta: RequestMeta): Promise<void> {
  const user = await db.user.findUnique({ where: { id: userId }, select: { phoneCiphertext: true, phoneBlindIndex: true } });
  if (!user?.phoneCiphertext || !user.phoneBlindIndex) throw new AppError("NO_PHONE", "등록된 전화번호가 없어요.", 400);
  await issuePhoneOtp(db, userId, decryptPII(user.phoneCiphertext), user.phoneBlindIndex, sms, meta);
}

export async function confirmPhoneVerification(db: AuthDb, userId: string, code: string, meta: RequestMeta): Promise<void> {
  const ok = await verifyPhoneOtp(db, userId, code);
  if (!ok) { await logAuthEvent(db, AUTH_EVENTS.PHONE_VERIFY_FAIL, userId, meta); throw new AppError("PHONE_VERIFY_FAILED", "코드를 다시 확인해 주세요.", 401); }
  const me = await db.user.findUnique({ where: { id: userId }, select: { phoneBlindIndex: true } });
  if (me?.phoneBlindIndex) {
    const other = await db.user.findFirst({ where: { phoneBlindIndex: me.phoneBlindIndex, phoneVerifiedAt: { not: null }, id: { not: userId } }, select: { id: true } });
    if (other) throw new AppError("PHONE_TAKEN", "이미 인증된 전화번호예요.", 409);
  }
  await db.user.update({ where: { id: userId }, data: { phoneVerifiedAt: new Date() } });
  await logAuthEvent(db, AUTH_EVENTS.PHONE_VERIFIED, userId, meta);
}
```

- [ ] **Step 3: 라우트** — 3개 전부 로그인 필요(`currentUserFromRefresh(prisma, readRefreshCookie(req))` → 401), `withErrorHandling`, JSON. location은 `locationSchema.parse`(실패 시 INVALID_INPUT), `getGeocoder()`. phone/send는 `getSms()`. phone/verify는 body `{code}`.

- [ ] **Step 4: 수동 검증·커밋** — dev에서 로그인→location 설정→psql로 lat/lng가 반올림값·정확좌표 없음 확인, 전화 send/verify(콘솔 목 코드). 
```bash
pnpm test && pnpm exec tsc --noEmit
git add src/features/location/service.ts src/app/api/auth/location src/app/api/auth/phone
git commit -m "위치 설정·전화 인증 서비스와 라우트 추가"
```

---

### Task 5 🟢: UI + 카탈로그

**Files:** Create `src/features/location/{LocationSettings,PhoneVerify}.tsx` + tests, `src/app/settings/location/page.tsx`, `src/app/settings/phone/page.tsx`. Modify catalogs.

- [ ] **Step 1: 카탈로그** `location.*`(제목·시도·시군구·동·저장·현재동네·저장됨), `phone.*`(제목·인증하기·코드입력·확인·인증됨·재발송·에러 failed/taken/tooSoon/noPhone). 양 로케일, 평어체.

- [ ] **Step 2: 컴포넌트(TDD)** — 기존 폼 패턴(클라, fetch→코드→카탈로그, submitting, role=alert):
  - `LocationSettings`: 시도/시군구/동 입력→POST /api/auth/location→저장됨·현재 동네 표시(좌표 미표시). 현재 region은 SSR prop.
  - `PhoneVerify`: 코드 발송(POST /phone/send)→코드 입력→POST /phone/verify→인증됨 배지. 현재 검증상태 SSR prop.
  - 테스트: 올바른 엔드포인트 POST, 에러코드→카탈로그, 서버원문 미렌더.

- [ ] **Step 3: 페이지** — SSR refresh 쿠키 가드→현재 region/phoneVerifiedAt 로드→컴포넌트. 미인증→/login?error=login_required.

- [ ] **Step 4: 통과·빌드·커밋**
```bash
pnpm test && pnpm exec tsc --noEmit && pnpm build
git add src/features/location src/app/settings/location src/app/settings/phone src/i18n/messages
git commit -m "위치·전화 인증 설정 UI와 한/영 메시지 추가"
```

---

### Task 6 🟢: E2E + 워크로그

**Files:** Create `e2e/location.spec.ts`, `docs/worklog/2026-07-24-location-phone.md`.

- [ ] **Step 1: E2E** — `test.use({locale:"ko-KR"})`, unique 유저:
  - 가입→로그인→/settings/location에서 동네 입력→저장, 응답·페이지에 정확좌표 없음(psql로 lat/lng 반올림 확인은 검증 스텝)
  - 전화 인증: 콘솔 목이라 코드 취득 불가 → **전화 인증 해피패스는 API+단위테스트로**, E2E는 위치 설정 + 전화 send가 200 + 잘못된 코드 verify 401(코드 모르니 실패 경로)만. 워크로그에 한계 명시.

- [ ] **Step 2: 실행·프라이버시 점검**
```bash
docker compose up -d db && pnpm exec prisma migrate deploy && pnpm test:e2e
pnpm exec tsc --noEmit && pnpm test && pnpm build
docker compose exec -T db psql -U app -d app -c 'SELECT "lat","lng","regionCiphertext" FROM "User" WHERE "lat" IS NOT NULL LIMIT 3; SELECT "codeHash" FROM "PhoneOtp" LIMIT 3;'
grep -rn "console.log" src/features/location src/app/api/auth/location src/app/api/auth/phone
```
Expected: E2E green, lat/lng는 소수 2자리(정확좌표 없음), regionCiphertext 암호문, codeHash bcrypt, grep은 sms 목 로그만.

- [ ] **Step 3: 워크로그·커밋** — 형식(무엇을/왜/결정/편차, 태스크 표, **리뷰·검토 중점**(좌표 프라이버시·OTP 위생), DoD 6항, 전화 E2E 한계). 커밋:
```bash
git add e2e/location.spec.ts docs/worklog/2026-07-24-location-phone.md
git commit -m "위치·전화 E2E와 워크로그 추가"
```

---

## DoD — 설계 K절과 동일 (1~6)

## 범위 밖
- 거리검색 haversine → #3. 프로필 통합 → 1c. 위치·전화 변경 step-up → 1c. 실 Kakao/Octomo 프로덕션 → 이후.
