# 2차 인증(2FA) + 민감작업 재인증(#1a-ext-2) 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** 유저별 TOTP/이메일 OTP 2FA 설정·강제(로컬·OAuth 둘 다)와 민감작업 step-up 재인증을 구현한다.

**Architecture:** `src/features/auth/twofactor/`에 TOTP·이메일 OTP 코어, 목/실제 메일러, challenge·step-up 토큰, 2FA·step-up 서비스를 모은다. 로그인은 기존 `login.ts`/`oauth/link.ts`에 2FA 게이트를 삽입(1차 통과 후 세션 대신 challenge). 세션·crypto·감사·쿠키 헬퍼는 #1a/ext-1 재사용. `EmailOtp` 테이블 마이그레이션 1개.

**Tech Stack:** Next.js 16, Prisma 7, otplib(TOTP), zod 4, jose(challenge/step-up JWT), bcryptjs(OTP 해시), Node crypto, next-intl 4, Vitest + Playwright.

**설계 문서:** `docs/superpowers/specs/2026-07-24-two-factor-design.md`.

## Global Constraints

- **PII 평문 금지:** 이메일 주소는 OTP 발송에만. 로그·감사·응답·리다이렉트 금지. TOTP 시크릿은 `encryptPII`(AES-GCM), OTP 코드는 bcrypt 해시로만 저장 — 평문 시크릿·코드 저장 금지.
- **토큰 격리:** challenge(`purpose:'2fa'`)·step-up(`purpose:'step_up'`)·access(role claim)는 상호 배타. 각 verify가 purpose/claim 대조 — 한 토큰을 다른 용도로 절대 통과시키지 않는다.
- **2FA 우회 불가:** 로컬(`login.ts`)과 OAuth(`oauth/link.ts`) 로그인 둘 다 2FA 켠 유저면 세션 대신 challenge 발급.
- **OTP 1회용·만료·레이트리밋:** `consumedAt`으로 재사용 차단. 5분 만료. 동일 유저·purpose 활성 코드 1개, 재발급 최소 30초 간격.
- 실패 일반화: 2FA/step-up 코드 실패는 방식·계정 정보 누출 없이 일반 401.
- 쿠키: challenge/step-up 모두 HttpOnly·SameSite=Lax·Path=/·prod만 Secure(#1a cookies.ts 패턴).
- 클라 에러는 코드→카탈로그 매핑, 서버 원문 렌더 금지. UI 문자열 카탈로그, 한글 평어체.
- 세션·쿠키·crypto·감사·`getCurrentUser`·`currentUserFromRefresh` 재사용. 신규는 twofactor/·2fa 라우트·설정/챌린지 UI.
- challenge/step-up 토큰은 `JWT_ACCESS_SECRET` 재사용(신규 시크릿 없음), purpose claim으로 격리.
- TypeScript strict. 커밋 짧은 한글, Co-Authored-By 금지. 브랜치 `feat/two-factor`(생성됨). Node 빌트인 테스트는 `// @vitest-environment node`.

## 실행 카덴스

- 🔴 = 적대적 리뷰+fix루프(코어·토큰·서비스·로그인통합·step-up게이팅). 🟢 = 구현+메인 diff점검(마이그레이션·UI·E2E).
- 브랜치 하나(`feat/two-factor`), 최종 opus 리뷰.

## File Structure

| 파일 | 책임 | 태스크 |
|---|---|---|
| `prisma/schema.prisma`(수정)+마이그레이션 | EmailOtp·OtpPurpose·User back-relation | 1 |
| `src/features/_shared/env.ts`(수정) | TWO_FACTOR_ISSUER·SMTP_* | 1 |
| `src/features/auth/db.ts`·`audit.ts`(수정) | emailOtp 표면·2FA 이벤트 | 1 |
| `src/features/auth/twofactor/totp.ts` | TOTP 생성·검증·uri | 2 |
| `src/features/auth/twofactor/mailer.ts` | 목/실제 메일러 | 2 |
| `src/features/auth/twofactor/emailOtp.ts` | 이메일 OTP 발급·검증 | 2 |
| `src/features/auth/twofactor/challenge.ts` | 로그인 challenge 토큰·쿠키 | 3 |
| `src/features/auth/twofactor/stepup.ts` | step-up 토큰·쿠키·requireRecentAuth | 3 |
| `src/features/auth/twofactor/service.ts` | 2FA 설정/해제·step-up 재인증·로그인 완료 | 4 |
| `src/features/auth/login.ts`·`oauth/link.ts`(수정) | 2FA 게이트 삽입 | 5 |
| `src/app/api/auth/2fa/*` 라우트 | verify-login·resend·totp·email·disable | 5,6 |
| `src/app/api/auth/step-up/route.ts` | 재인증→step_up 쿠키 | 6 |
| `src/app/api/auth/oauth/[provider]/unlink/route.ts`(수정) | step-up 요건 추가 | 6 |
| `src/app/settings/security/page.tsx`·`/login/2fa/page.tsx`·컴포넌트 | UI | 7 |
| `src/i18n/messages/*`(수정) | twofactor 카탈로그 | 7 |
| `e2e/twofactor.spec.ts`·워크로그 | E2E·기록 | 8 |

---

### Task 1 🟢: 마이그레이션 + env + AuthDb + 감사 이벤트 + deps

**Files:** Modify `prisma/schema.prisma`, `src/features/_shared/env.ts`, `src/features/auth/db.ts`, `src/features/auth/audit.ts`, `.env`/`.env.example`, `package.json`. Create migration.

**Interfaces produced:** `EmailOtp` 모델, `OtpPurpose` enum, `AuthDb`+`emailOtp`, `AUTH_EVENTS`+2FA 이벤트 8종, env `TWO_FACTOR_ISSUER`/`SMTP_*`.

- [ ] **Step 1: deps 설치**
```bash
pnpm add otplib
```

- [ ] **Step 2: 스키마 수정**

`prisma/schema.prisma`에 추가(기존 enum들 옆):
```prisma
enum OtpPurpose {
  LOGIN_2FA
  STEP_UP
  SETUP
}

model EmailOtp {
  id         String     @id @default(cuid())
  userId     String
  user       User       @relation(fields: [userId], references: [id], onDelete: Cascade)
  codeHash   String
  purpose    OtpPurpose
  expiresAt  DateTime
  consumedAt DateTime?
  createdAt  DateTime   @default(now())

  @@index([userId])
}
```
`User` 모델에 back-relation 추가(다른 컬럼 불변):
```prisma
  emailOtps        EmailOtp[]
```

- [ ] **Step 3: 마이그레이션 생성·적용**
```bash
docker compose up -d db
pnpm exec prisma migrate dev --name two_factor
```
> `migrate dev`가 TTY 필요로 실패하면 ext-1 Task 2 패턴대로 `prisma migrate diff`로 SQL 생성 후 `prisma migrate deploy`. 폴더명 `YYYYMMDDHHMMSS_two_factor`.
검증:
```bash
docker compose exec -T db psql -U app -d app -c '\d "EmailOtp"'
```
Expected: `EmailOtp` 테이블, `userId` 인덱스, `OtpPurpose` enum 존재

- [ ] **Step 4: env·AuthDb·감사 확장**

`env.ts` schema에 추가:
```ts
  TWO_FACTOR_ISSUER: z.string().default("GrassSecondhand"),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().positive().optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
```
`db.ts`:
```ts
export type AuthDb = Pick<PrismaClient, "user" | "session" | "authAuditLog" | "authIdentity" | "emailOtp">;
```
`audit.ts` `AUTH_EVENTS`에 추가:
```ts
  TWO_FACTOR_ENABLED: "TWO_FACTOR_ENABLED",
  TWO_FACTOR_DISABLED: "TWO_FACTOR_DISABLED",
  TWO_FACTOR_CHALLENGE: "TWO_FACTOR_CHALLENGE",
  TWO_FACTOR_SUCCESS: "TWO_FACTOR_SUCCESS",
  TWO_FACTOR_FAIL: "TWO_FACTOR_FAIL",
  STEP_UP_SUCCESS: "STEP_UP_SUCCESS",
  STEP_UP_FAIL: "STEP_UP_FAIL",
  OTP_SENT: "OTP_SENT",
```
`.env`/`.env.example`에 `# SMTP_HOST=...`(주석, 없으면 목) 안내 추가.

- [ ] **Step 5: 검증·커밋**
```bash
pnpm exec tsc --noEmit && pnpm test
git add prisma src/features/_shared/env.ts src/features/auth/db.ts src/features/auth/audit.ts package.json pnpm-lock.yaml .env.example
git commit -m "2FA용 EmailOtp 마이그레이션과 env·감사 이벤트·otplib 추가"
```

---

### Task 2 🔴: TOTP 코어 + 이메일 OTP 코어 + 목 메일러

**Files:** Create `src/features/auth/twofactor/{totp,mailer,emailOtp}.ts` + tests.

**Interfaces produced:**
- `generateTotpSecret(): string`, `totpUri(secret, accountEmail): string`, `verifyTotp(secret, code): boolean`
- `interface Mailer { send(to, subject, body): Promise<void> }`, `getMailer(): Mailer`, `MemoryMailer`(테스트용, 캡처)
- `issueEmailOtp(db, userId, purpose, mailer, accountEmail): Promise<void>`, `verifyEmailOtp(db, userId, purpose, code): Promise<boolean>`

- [ ] **Step 1: TOTP 테스트 작성 (RED)**

`src/features/auth/twofactor/totp.test.ts`:
```ts
// @vitest-environment node
import { describe, it, expect } from "vitest";
import { authenticator } from "otplib";
import { generateTotpSecret, totpUri, verifyTotp } from "./totp";

describe("totp", () => {
  it("generates a base32 secret", () => {
    const s = generateTotpSecret();
    expect(s).toMatch(/^[A-Z2-7]+$/);
    expect(s.length).toBeGreaterThanOrEqual(16);
  });
  it("builds an otpauth uri with issuer and account", () => {
    const uri = totpUri("JBSWY3DPEHPK3PXP", "user@example.com");
    expect(uri).toMatch(/^otpauth:\/\/totp\//);
    expect(uri).toContain("user@example.com");
  });
  it("verifies a live code and rejects a wrong one", () => {
    const s = generateTotpSecret();
    expect(verifyTotp(s, authenticator.generate(s))).toBe(true);
    expect(verifyTotp(s, "000000")).toBe(false);
    expect(verifyTotp(s, "not-a-code")).toBe(false);
  });
});
```

- [ ] **Step 2: TOTP 구현**

`src/features/auth/twofactor/totp.ts`:
```ts
import { authenticator } from "otplib";
import { getEnv } from "@/features/_shared/env";

export function generateTotpSecret(): string {
  return authenticator.generateSecret();
}

export function totpUri(secret: string, accountEmail: string): string {
  return authenticator.keyuri(accountEmail, getEnv().TWO_FACTOR_ISSUER, secret);
}

export function verifyTotp(secret: string, code: string): boolean {
  try {
    return authenticator.check(code.trim(), secret);
  } catch {
    return false;
  }
}
```
> otplib 기본 window는 0. `authenticator.options = { window: 1 }`를 모듈 로드 시 설정해 ±1 스텝 허용(시계 오차). 파일 상단에 `authenticator.options = { window: 1 };`.

- [ ] **Step 3: 메일러 테스트·구현**

`src/features/auth/twofactor/mailer.ts`:
```ts
import { getEnv } from "@/features/_shared/env";

export interface Mailer {
  send(to: string, subject: string, body: string): Promise<void>;
}

/** 테스트·개발용. 실 SMTP 없이 발송 내역을 메모리에 담는다. 코드는 로그에 남기지 않는다. */
export class MemoryMailer implements Mailer {
  readonly sent: { to: string; subject: string; body: string }[] = [];
  async send(to: string, subject: string, body: string): Promise<void> {
    this.sent.push({ to, subject, body });
  }
}

/** dev 목: 콘솔에 '메일 발송됨'만(코드 평문·수신자 이메일은 남기지 않음). */
class ConsoleMailer implements Mailer {
  async send(): Promise<void> {
    console.log("[MAILER] OTP 메일 발송(목)");
  }
}

let cached: Mailer | null = null;
export function getMailer(): Mailer {
  if (cached) return cached;
  const env = getEnv();
  // SMTP_* 있으면 실 메일러(이후 구현). 지금은 목.
  cached = env.SMTP_HOST ? new ConsoleMailer() : new ConsoleMailer();
  return cached;
}

export function setMailerForTest(m: Mailer | null): void {
  cached = m;
}
```
> 실 SMTP 연동은 범위 밖(설계 M). ConsoleMailer가 목. 테스트는 `MemoryMailer`를 `issueEmailOtp`에 주입.

`src/features/auth/twofactor/mailer.test.ts`: `MemoryMailer.send`가 내역을 담고, `body`에 코드가 들어가되 `sent` 외 어디에도 안 남는지.

- [ ] **Step 4: 이메일 OTP 테스트 작성 (RED)**

`src/features/auth/twofactor/emailOtp.test.ts` — 목 AuthDb 주입. 케이스:
- 발급 시 6자리 코드 생성, `create` data의 `codeHash`가 bcrypt(`$2`)이고 평문 코드가 payload에 없음, `MemoryMailer.body`엔 코드 있음, `purpose`·`expiresAt`(미래) 설정
- 발급 시 동일 유저·purpose 기존 미소비 코드 무효화(`updateMany consumedAt` 또는 `deleteMany`) 호출
- 레이트리밋: 30초 내 재발급 시 `AppError`(또는 조용히 재사용) — 활성 코드 존재 시 새로 안 만듦
- 검증: 올바른 코드 → true + `consumedAt` 기록. 틀린 코드 → false. 만료 코드 → false. 이미 소비된 코드 → false. purpose 불일치 → false
- 검증 시 코드 평문이 쿼리·로그에 없음

`src/features/auth/twofactor/emailOtp.ts`:
```ts
import bcrypt from "bcryptjs";
import { randomInt } from "node:crypto";
import { AppError } from "@/features/_shared/error";
import { AUTH_EVENTS, logAuthEvent } from "../audit";
import type { AuthDb } from "../db";
import type { OtpPurpose } from "@prisma/client";
import type { Mailer } from "./mailer";

const CODE_TTL_MS = 5 * 60 * 1000;
const RESEND_MIN_MS = 30 * 1000;

function sixDigits(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

export async function issueEmailOtp(
  db: AuthDb,
  userId: string,
  purpose: OtpPurpose,
  mailer: Mailer,
  accountEmail: string,
): Promise<void> {
  const recent = await db.emailOtp.findFirst({
    where: { userId, purpose, consumedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
  });
  if (recent && Date.now() - recent.createdAt.getTime() < RESEND_MIN_MS) {
    throw new AppError("OTP_TOO_SOON", "잠시 후 다시 시도해 주세요.", 429);
  }
  // 기존 미소비 코드 무효화(활성 1개 유지)
  await db.emailOtp.updateMany({
    where: { userId, purpose, consumedAt: null },
    data: { consumedAt: new Date() },
  });

  const code = sixDigits();
  await db.emailOtp.create({
    data: {
      userId,
      purpose,
      codeHash: await bcrypt.hash(code, 10),
      expiresAt: new Date(Date.now() + CODE_TTL_MS),
    },
    select: { id: true },
  });
  // 코드 평문은 메일 본문에만. 로그·감사 금지.
  await mailer.send(accountEmail, "인증 코드", `인증 코드: ${code} (5분 안에 입력해 주세요)`);
  await logAuthEvent(db, AUTH_EVENTS.OTP_SENT, userId, { ip: null, ua: null });
}

export async function verifyEmailOtp(
  db: AuthDb,
  userId: string,
  purpose: OtpPurpose,
  code: string,
): Promise<boolean> {
  const candidates = await db.emailOtp.findMany({
    where: { userId, purpose, consumedAt: null, expiresAt: { gt: new Date() } },
    select: { id: true, codeHash: true },
  });
  for (const c of candidates) {
    if (await bcrypt.compare(code.trim(), c.codeHash)) {
      await db.emailOtp.update({ where: { id: c.id }, data: { consumedAt: new Date() } });
      return true;
    }
  }
  return false;
}
```
> `OtpPurpose` 타입은 `@prisma/client`에서 import. 목 테스트는 문자열 리터럴로 충분.

- [ ] **Step 5: 통과·커밋**
```bash
pnpm exec vitest run src/features/auth/twofactor
git add src/features/auth/twofactor package.json
git commit -m "TOTP·이메일 OTP 코어와 목 메일러 추가"
```

---

### Task 3 🔴: challenge + step-up 토큰

**Files:** Create `src/features/auth/twofactor/{challenge,stepup}.ts` + tests.

**Interfaces produced:**
- challenge: `signChallenge(userId, method): Promise<string>`, `verifyChallenge(token): Promise<{userId, method}|null>`, `CHALLENGE_COOKIE`, `challengeCookie`/`clearChallengeCookie`/`readChallengeCookie`
- stepup: `signStepUp(userId): Promise<string>`, `verifyStepUp(token): Promise<{userId}|null>`, `STEPUP_COOKIE`, `stepUpCookie`/`clearStepUpCookie`/`readStepUpCookie`, `requireRecentAuth(req): Promise<{userId}>`

- [ ] **Step 1: 테스트 작성 (RED)**

`challenge.test.ts`(`// @vitest-environment node`):
- `signChallenge("u1","TOTP")` → `verifyChallenge` 왕복 `{userId:"u1", method:"TOTP"}`
- **격리:** challenge 토큰을 `verifyAccessToken`(tokens.ts)에 넣으면 null; access 토큰을 `verifyChallenge`에 넣으면 null(purpose 불일치)
- 변조·만료·garbage → null
- 쿠키 HttpOnly/SameSite=Lax/5분, read 왕복

`stepup.test.ts` 유사 + `requireRecentAuth`: 유효 쿠키 있는 req → `{userId}`, 없거나 무효 → `AppError("STEP_UP_REQUIRED", 401)`. step-up 토큰을 access로 verify 시 null(격리).

- [ ] **Step 2: 구현**

`src/features/auth/twofactor/challenge.ts`:
```ts
import { SignJWT, jwtVerify } from "jose";
import { getEnv } from "@/features/_shared/env";

const CHALLENGE_TTL = "5m";
export const CHALLENGE_COOKIE = "2fa_challenge";

function key(): Uint8Array {
  return new TextEncoder().encode(getEnv().JWT_ACCESS_SECRET);
}

export async function signChallenge(userId: string, method: string): Promise<string> {
  return new SignJWT({ purpose: "2fa", method })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime(CHALLENGE_TTL)
    .sign(key());
}

export async function verifyChallenge(token: string): Promise<{ userId: string; method: string } | null> {
  try {
    const { payload } = await jwtVerify(token, key(), { algorithms: ["HS256"] });
    if (payload.purpose !== "2fa" || !payload.sub || typeof payload.method !== "string") return null;
    return { userId: payload.sub, method: payload.method };
  } catch {
    return null;
  }
}

function secure(): string {
  return getEnv().NODE_ENV === "production" ? "; Secure" : "";
}
export function challengeCookie(token: string): string {
  return `${CHALLENGE_COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=300${secure()}`;
}
export function clearChallengeCookie(): string {
  return `${CHALLENGE_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${secure()}`;
}
export function readChallengeCookie(req: Request): string | null {
  const header = req.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === CHALLENGE_COOKIE) return rest.join("=") || null;
  }
  return null;
}
```

`src/features/auth/twofactor/stepup.ts` — 동일 구조, `purpose:"step_up"`, `STEPUP_COOKIE="step_up"`, TTL `10m`, Max-Age=600. 추가:
```ts
import { AppError } from "@/features/_shared/error";
// ...
export async function requireRecentAuth(req: Request): Promise<{ userId: string }> {
  const token = readStepUpCookie(req);
  const v = token ? await verifyStepUp(token) : null;
  if (!v) throw new AppError("STEP_UP_REQUIRED", "본인 확인이 필요해요.", 401);
  return v;
}
```
> **쿠키 파서 중복:** challenge/stepup/oauth-state/refresh가 같은 쿠키 파싱 로직을 반복한다. 이 태스크에서 `src/features/auth/cookies.ts`에 `readCookie(req, name): string|null` 범용 헬퍼를 추가하고, 신규 두 모듈은 그것을 쓴다(기존 refresh/state 리팩터는 범위 밖 — 신규만 DRY). read 헬퍼는 `readCookie(req, CHALLENGE_COOKIE)`로 위임.

- [ ] **Step 3: 통과·커밋**
```bash
pnpm exec vitest run src/features/auth/twofactor
git add src/features/auth/twofactor src/features/auth/cookies.ts
git commit -m "2FA challenge·step-up 토큰과 범용 쿠키 리더 추가"
```

---

### Task 4 🔴: 2FA 설정·step-up·로그인 완료 서비스

**Files:** Create `src/features/auth/twofactor/service.ts` + test.

**Interfaces produced:**
- `startTotpSetup(db, userId): Promise<{secret, uri}>`, `confirmTotp(db, userId, code, meta): Promise<void>`
- `startEmailOtpSetup(db, userId, mailer): Promise<void>`, `confirmEmailOtpSetup(db, userId, code, meta): Promise<void>`
- `disableTwoFactor(db, userId, meta): Promise<void>`
- `verifyStepUpReauth(db, userId, raw, meta): Promise<void>`
- `completeLoginTwoFactor(db, userId, method, raw, mailer, meta): Promise<IssuedSession>`
- `sendLoginOtp(db, userId, meta): Promise<void>` (챌린지 중 이메일 재발송)

**Consumes:** totp·emailOtp·mailer(Task 2), `encryptPII`/`decryptPII`, `verifyPassword`(#1a password.ts), `createSession`(session.ts), audit.

- [ ] **Step 1: 테스트 작성 (RED)** — 목 AuthDb. 케이스:
  - `startTotpSetup`: 시크릿 생성, `user.update` data.totpSecret가 **암호문**(평문 시크릿 아님), `twoFactorMethod` 아직 안 바뀜, uri 반환
  - `confirmTotp`: 저장된(암호화된) 시크릿 복호화 후 verifyTotp 성공 → `twoFactorMethod=TOTP`, TWO_FACTOR_ENABLED 감사. 틀린 코드 → AppError, method 불변
  - `startEmailOtpSetup`: `issueEmailOtp(SETUP)` 호출(계정 이메일은 `decryptPII(emailCiphertext)`로 얻음)
  - `confirmEmailOtpSetup`: `verifyEmailOtp(SETUP)` 성공 → EMAIL 활성
  - `disableTwoFactor`: method=NONE, totpSecret=null, 감사
  - `verifyStepUpReauth`: password 수단(bcrypt 검증), totp 수단, email 수단(verifyEmailOtp STEP_UP) 각각 성공/실패. 실패 → AppError + STEP_UP_FAIL. OAuth-only(비번 없음)에 password 수단 시도 → 실패
  - `completeLoginTwoFactor`: method=TOTP 코드 검증 성공 → createSession 반환 + TWO_FACTOR_SUCCESS. 실패 → AppError(일반 401) + TWO_FACTOR_FAIL. method=EMAIL은 verifyEmailOtp(LOGIN_2FA)
  - 전 경로: 응답·감사·로그에 평문 코드·시크릿·이메일 없음

- [ ] **Step 2: 구현** — `service.ts`. 핵심 발췌(나머지는 인터페이스·테스트대로):
```ts
import { encryptPII, decryptPII } from "@/features/_shared/crypto";
import { AppError } from "@/features/_shared/error";
import { verifyPassword } from "../password";
import { createSession, type IssuedSession } from "../session";
import { AUTH_EVENTS, logAuthEvent, type RequestMeta } from "../audit";
import type { AuthDb } from "../db";
import { generateTotpSecret, totpUri, verifyTotp } from "./totp";
import { issueEmailOtp, verifyEmailOtp } from "./emailOtp";
import { getMailer, type Mailer } from "./mailer";

function twoFactorFailed(): AppError {
  return new AppError("TWO_FACTOR_FAILED", "코드를 다시 확인해 주세요.", 401);
}

export async function startTotpSetup(db: AuthDb, userId: string): Promise<{ secret: string; uri: string }> {
  const user = await db.user.findUnique({ where: { id: userId }, select: { emailCiphertext: true } });
  if (!user) throw new AppError("AUTH_FAILED", "다시 로그인해 주세요.", 401);
  const secret = generateTotpSecret();
  await db.user.update({ where: { id: userId }, data: { totpSecret: encryptPII(secret) } });
  return { secret, uri: totpUri(secret, decryptPII(user.emailCiphertext)) };
}

export async function confirmTotp(db: AuthDb, userId: string, code: string, meta: RequestMeta): Promise<void> {
  const user = await db.user.findUnique({ where: { id: userId }, select: { totpSecret: true } });
  if (!user?.totpSecret || !verifyTotp(decryptPII(user.totpSecret), code)) throw twoFactorFailed();
  await db.user.update({ where: { id: userId }, data: { twoFactorMethod: "TOTP" } });
  await logAuthEvent(db, AUTH_EVENTS.TWO_FACTOR_ENABLED, userId, meta);
}

export async function completeLoginTwoFactor(
  db: AuthDb, userId: string, method: string, raw: unknown, mailer: Mailer, meta: RequestMeta,
): Promise<IssuedSession> {
  const code = (raw as { code?: string })?.code ?? "";
  const ok = method === "EMAIL"
    ? await verifyEmailOtp(db, userId, "LOGIN_2FA", code)
    : await verifyTotpFor(db, userId, code);
  if (!ok) { await logAuthEvent(db, AUTH_EVENTS.TWO_FACTOR_FAIL, userId, meta); throw twoFactorFailed(); }
  const session = await createSession(db, userId);
  await logAuthEvent(db, AUTH_EVENTS.TWO_FACTOR_SUCCESS, userId, meta);
  return session;
}

async function verifyTotpFor(db: AuthDb, userId: string, code: string): Promise<boolean> {
  const user = await db.user.findUnique({ where: { id: userId }, select: { totpSecret: true } });
  return !!user?.totpSecret && verifyTotp(decryptPII(user.totpSecret), code);
}

// verifyStepUpReauth, disableTwoFactor, startEmailOtpSetup, confirmEmailOtpSetup, sendLoginOtp — 인터페이스·테스트대로.
// verifyStepUpReauth: raw.method ∈ {password,totp,email}. password → user.passwordHash로 verifyPassword.
//   email → verifyEmailOtp(STEP_UP). totp → verifyTotpFor. 성공/실패 STEP_UP_SUCCESS/FAIL 감사, 실패 시 일반 AppError.
```

- [ ] **Step 3: 통과·커밋**
```bash
pnpm exec vitest run src/features/auth/twofactor && pnpm exec tsc --noEmit
git add src/features/auth/twofactor
git commit -m "2FA 설정·해제·step-up 재인증·로그인 완료 서비스 추가"
```

---

### Task 5 🔴: 로그인 2FA 게이트 + 설정·verify 라우트

**Files:** Modify `src/features/auth/login.ts`, `src/features/auth/oauth/link.ts`, `src/app/api/auth/login/route.ts`, `src/app/api/auth/oauth/[provider]/callback/route.ts`. Create `src/app/api/auth/2fa/{verify-login,resend,totp/start,totp/confirm,email/start,email/confirm}/route.ts`. Modify `login.test.ts`, `oauth/link.test.ts`.

**Interfaces produced:** `loginUser`가 2FA 유저면 `{ twoFactorRequired: true, method, userId }`(세션 없이) 반환하도록 결과 타입 확장. `loginOrRegisterWithOAuth`도 동일 분기. `LoginResult` union.

- [ ] **Step 1: login.ts 게이트 테스트·구현**

`login.test.ts`에 추가: 2FA=TOTP 유저 로그인 → 결과 `{twoFactorRequired:true, method:"TOTP", userId}`, `createSession` **미호출**, TWO_FACTOR_CHALLENGE 감사. NONE 유저는 기존대로 세션.

`login.ts` `loginUser` 수정 — 비번 검증 성공 후:
```ts
  if (user.twoFactorMethod !== "NONE") {
    await logAuthEvent(db, AUTH_EVENTS.TWO_FACTOR_CHALLENGE, user.id, meta);
    return { twoFactorRequired: true, method: user.twoFactorMethod, userId: user.id };
  }
```
(`select`에 `twoFactorMethod` 추가. `LoginResult`를 union으로: 기존 세션 결과 | `{twoFactorRequired:true, method, userId}`.)

`login/route.ts`: 결과가 `twoFactorRequired`면 `signChallenge(userId, method)` 쿠키 심고 `{twoFactorRequired:true, method}` 반환(세션·refresh 쿠키 없음). 아니면 기존대로.

- [ ] **Step 2: oauth/link.ts 게이트 (2FA 우회 방지)**

`loginOrRegisterWithOAuth`의 **기존 신원 로그인** 경로: `user.twoFactorMethod !== NONE`이면 `createSession` 대신 `{ twoFactorRequired: true, method, userId }` 반환. select에 twoFactorMethod 추가. (신규 가입은 NONE이라 그대로.) 반환 타입 union.

`callback/route.ts`: 로그인 결과가 `twoFactorRequired`면 `signChallenge` 쿠키 + `/login/2fa`로 리다이렉트(refresh 쿠키 없음). 아니면 기존 `/`.

`link.test.ts`에 추가: 2FA 켠 기존 유저의 OAuth 로그인 → challenge 결과, 세션 미발급.

- [ ] **Step 3: verify-login·resend·설정 라우트**

`src/app/api/auth/2fa/verify-login/route.ts`(JSON, withErrorHandling):
```ts
export const POST = withErrorHandling(async (req: Request) => {
  const challenge = await verifyChallenge(readChallengeCookie(req) ?? "");
  if (!challenge) throw new AppError("TWO_FACTOR_FAILED", "코드를 다시 확인해 주세요.", 401);
  const session = await completeLoginTwoFactor(prisma, challenge.userId, challenge.method, await req.json().catch(() => ({})), getMailer(), requestMeta(req));
  return Response.json({ ok: true }, {
    headers: [
      ["set-cookie", refreshCookie(session.refreshToken, session.expiresAt)],
      ["set-cookie", clearChallengeCookie()],
    ],
  });
});
```
> Next Response에 set-cookie 2개: `new Headers()`에 append 또는 위 배열 형태. 구현자는 ext-1 callback의 `res.headers.append("set-cookie", ...)` 패턴을 따라도 됨.

`2fa/resend`: challenge 쿠키의 userId·method=EMAIL이면 `sendLoginOtp`. `2fa/totp/start`·`totp/confirm`·`email/start`·`email/confirm`: **로그인 필요**(`currentUserFromRefresh`로 userId), 각 서비스 호출. 전부 얇은 JSON 라우트.

- [ ] **Step 4: 검증·커밋**

수동: 목 이메일 2FA 유저 로그인 → verify-login 없이는 세션 없음 확인.
```bash
pnpm test && pnpm exec tsc --noEmit
git add src/features/auth/login.ts src/features/auth/oauth/link.ts src/app/api/auth/login src/app/api/auth/oauth src/app/api/auth/2fa src/features/auth/login.test.ts src/features/auth/oauth/link.test.ts
git commit -m "로컬·OAuth 로그인에 2FA 챌린지 게이트와 설정·검증 라우트 추가"
```

---

### Task 6 🔴: step-up 게이팅 + step-up 라우트

**Files:** Create `src/app/api/auth/2fa/disable/route.ts`, `src/app/api/auth/step-up/route.ts`. Modify `src/app/api/auth/oauth/[provider]/unlink/route.ts`.

- [ ] **Step 1: step-up 라우트**

`src/app/api/auth/step-up/route.ts`(JSON):
```ts
export const POST = withErrorHandling(async (req: Request) => {
  const current = await currentUserFromRefresh(prisma, readRefreshCookie(req));
  if (!current) throw new AppError("UNAUTHENTICATED", "로그인이 필요해요.", 401);
  await verifyStepUpReauth(prisma, current.userId, await req.json().catch(() => ({})), requestMeta(req));
  return Response.json({ ok: true }, { headers: { "set-cookie": stepUpCookie(await signStepUp(current.userId)) } });
});
```

- [ ] **Step 2: disable 라우트(step-up 필요)**
```ts
export const POST = withErrorHandling(async (req: Request) => {
  const recent = await requireRecentAuth(req);         // step_up 쿠키 없으면 401 STEP_UP_REQUIRED
  await disableTwoFactor(prisma, recent.userId, requestMeta(req));
  return Response.json({ ok: true });
});
```

- [ ] **Step 3: unlink에 step-up 추가**

`oauth/[provider]/unlink/route.ts` 수정: `currentUserFromRefresh`로 인증 확인 **후 추가로** `requireRecentAuth(req)`로 step-up 확인. step-up의 userId와 refresh의 userId 일치 확인(다른 유저 step_up 쿠키 재사용 방지). 미통과 401 STEP_UP_REQUIRED.

- [ ] **Step 4: 통합 테스트/수동 검증**

수동: step_up 쿠키 없이 disable/unlink → 401. `/step-up`(비번 또는 이메일 OTP) → step_up 쿠키 → disable/unlink 통과.
```bash
pnpm test && pnpm exec tsc --noEmit
git add src/app/api/auth/2fa/disable src/app/api/auth/step-up src/app/api/auth/oauth
git commit -m "민감작업 step-up 게이팅과 재인증 라우트 추가"
```

---

### Task 7 🟢: UI (2FA 설정·로그인 챌린지·step-up) + 카탈로그

**Files:** Create `src/app/settings/security/page.tsx`, `src/app/login/2fa/page.tsx`, `src/features/auth/TwoFactorSettings.tsx`, `TwoFactorChallenge.tsx`, `StepUpPrompt.tsx` + tests. Modify catalogs.

- [ ] **Step 1: 카탈로그** — `auth.twofactor.*` 키 추가(양 로케일): 설정 제목/TOTP/이메일 선택, QR·시크릿 안내, 코드 입력, 활성/해제, 챌린지 제목, "이메일로 받기", 재인증 제목/비번/코드, 에러(`failed`, `tooSoon`, `stepUpRequired`). 브리프에 정확 문자열.

- [ ] **Step 2: 컴포넌트(TDD)** — 기존 폼 패턴(클라, fetch→코드→카탈로그 에러, submitting 가드, role=alert):
  - `TwoFactorSettings`: 현재 method 표시, TOTP 설정(start→시크릿/uri 표시→코드 확인), 이메일 2FA 설정(start→코드 확인), 해제(step-up 필요 시 StepUpPrompt 유도). QR은 uri를 `otpauth://` 텍스트로 표시 + 시크릿 수동입력 안내(외부 요청 없이).
  - `TwoFactorChallenge`: 코드 입력→`/2fa/verify-login`. method=EMAIL이면 "이메일로 받기"→`/2fa/resend`. 성공 시 `/`로.
  - `StepUpPrompt`: 비번 또는 코드 입력→`/step-up`→성공 시 원 작업 재시도 콜백.
  - 테스트: 각 컴포넌트가 올바른 엔드포인트로 POST, 실패 코드→카탈로그 문자열, 서버 원문 미렌더.

- [ ] **Step 3: 페이지** — `/settings/security`(SSR refresh 쿠키 가드→현재 method 로드→TwoFactorSettings), `/login/2fa`(challenge 쿠키 존재 전제, TwoFactorChallenge). 서버 컴포넌트 얇게.

- [ ] **Step 4: 통과·빌드·커밋**
```bash
pnpm test && pnpm exec tsc --noEmit && pnpm build
git add src/app/settings/security src/app/login/2fa src/features/auth/TwoFactor* src/features/auth/StepUpPrompt* src/i18n/messages
git commit -m "2FA 설정·로그인 챌린지·재인증 UI와 한/영 메시지 추가"
```

---

### Task 8 🟢: E2E + 워크로그

**Files:** Create `e2e/twofactor.spec.ts`, `docs/worklog/2026-07-24-two-factor.md`.

- [ ] **Step 1: E2E** — 목 메일러로 코드 캡처가 어려우므로(E2E는 실 서버) **TOTP 위주 + 이메일은 API로**. 시나리오:
  - TOTP: 로컬 가입→로그인→`/settings/security`에서 TOTP 설정(시크릿 취득→otplib로 코드 생성→확인)→로그아웃→재로그인 시 `/login/2fa` 챌린지→otplib 코드로 통과→세션. `e2e`에서 `otplib`로 코드 생성.
  - 2FA 해제: step_up 없이 disable→401(API), `/step-up`(비번)→step_up→disable 성공.
  - OAuth 2FA: TOTP 켠 유저가 (같은 이메일) — OAuth 로그인 경로도 챌린지 뜨는지(API 레벨).
  - 이메일 OTP: API 레벨에서 setup→(코드 취득 불가 시 목 메일러 대신) — dev에서 이메일 OTP는 콘솔 목이라 E2E 코드 취득 어려움 → **이메일 2FA E2E는 서비스/단위 테스트로 커버**, E2E는 TOTP·step-up 중심. 워크로그에 명시.
  - `test.use({ locale: "ko-KR" })`.

- [ ] **Step 2: 실행·PII 점검**
```bash
docker compose up -d db && pnpm exec prisma migrate deploy && pnpm test:e2e
pnpm exec tsc --noEmit && pnpm test && pnpm build
docker compose exec -T db psql -U app -d app -c 'SELECT "codeHash" FROM "EmailOtp" LIMIT 3; SELECT "totpSecret" FROM "User" WHERE "totpSecret" IS NOT NULL LIMIT 3;'
grep -rn "console.log" src/features/auth/twofactor src/app/api/auth/2fa src/app/api/auth/step-up
```
Expected: E2E green, `codeHash`는 bcrypt·`totpSecret`은 암호문(평문 시크릿·코드 없음), grep은 mailer의 목 로그 외 없음.

- [ ] **Step 3: 워크로그·커밋**

`docs/worklog/2026-07-24-two-factor.md`(무엇을/왜/결정/편차, 태스크 표, 리뷰 지적·처리, DoD 9항, 이메일 OTP E2E 한계 명시). 커밋:
```bash
git add e2e/twofactor.spec.ts docs/worklog/2026-07-24-two-factor.md
git commit -m "2FA E2E와 워크로그 추가"
```

---

## 완료 기준 (DoD) — 설계 L절과 동일 (1~9)

## 범위 밖 (건드리지 말 것)

- 비번변경·탈퇴 step-up 게이팅, 로컬 비번 추가 → 1c(프리미티브 재사용)
- 실 SMTP·SMS·WebAuthn → YAGNI/이후
- RBAC 강제 → #2
