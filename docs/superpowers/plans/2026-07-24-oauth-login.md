# 소셜 OAuth 로그인·연동(#1a-ext-1) 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 로컬 인증 위에 소셜 OAuth(Google 실제 + Kakao/Naver 목) 로그인·가입·연동/해제를 추가한다.

**Architecture:** `src/features/auth/oauth/`에 어댑터(provider 공통 인터페이스)·state CSRF·연동 서비스를 모으고, `src/app/api/auth/oauth/[provider]/{start,callback,unlink}` 라우트는 얇게 위임한다. 세션 발급·쿠키·회전·감사·crypto는 #1a 것을 그대로 재사용한다. `AuthIdentity` 모델은 이미 마이그레이션돼 있어 스키마 변경이 없다.

**Tech Stack:** Next.js 16 (App Router, `NextResponse.redirect`), Prisma 7, zod 4, Node `node:crypto`(HMAC state), next-intl 4, Vitest 4 + Playwright.

**설계 문서:** `docs/superpowers/specs/2026-07-24-oauth-login-design.md`.

## Global Constraints

- **PII 평문 금지**: 로그·감사행·에러·응답·리다이렉트 URL 어디에도 이메일 평문 금지. `AuthIdentity.emailAtProvider` 미기록. 이메일은 신규 User면 `emailCiphertext`(AES-GCM)에만.
- **자동 연동 금지**: OAuth 이메일이 기존 계정과 같아도 자동 로그인·자동 연동 안 함 → `OAUTH_EMAIL_EXISTS` 안내. 연동은 로그인 상태에서만.
- **마지막 자격증명 해제 금지**: 비번 없고 신원 1개뿐이면 해제 불가.
- **콜백은 refresh 쿠키만**: access 토큰을 URL/리다이렉트에 싣지 않는다. 클라는 이후 `/api/auth/refresh`로 access 취득.
- **state CSRF**: HMAC 서명 + 쿠키 double-submit, 10분 만료, 콜백 후 삭제. open redirect 금지(목적지는 내부 고정 경로만).
- 클라이언트 에러 응답/리다이렉트는 코드만 → 카탈로그 문자열 매핑. 서버 원문 렌더 금지(#1a SignupForm 패턴).
- UI 문자열은 `src/i18n/messages/{ko,en}.json`, 한글 평어체.
- 세션·쿠키·회전·감사·crypto·`getCurrentUser`는 #1a 재사용. 신규 코드는 oauth/·콜백 라우트·소셜 버튼·연동 페이지뿐.
- TypeScript strict. 커밋 짧은 한글, Co-Authored-By 금지. 브랜치 `feat/oauth-login`(이미 생성됨).
- Vitest 기본 환경 jsdom. Node 빌트인 쓰는 테스트는 파일 상단 `// @vitest-environment node`.

## 실행 카덴스 (빠른-정확)

- 🔴 = 보안 핵심 → 구현 서브에이전트 + 별도 적대적 리뷰 + fix 루프.
- 🟢 = 기계적 → 구현 서브에이전트 1회 + 메인 diff 점검(별도 리뷰어 생략).
- 브랜치는 이 계획 하나에 `feat/oauth-login` 하나. 태스크마다 커밋, 최종 whole-branch opus 리뷰.

## File Structure

| 파일 | 책임 | 태스크 |
|---|---|---|
| `src/features/_shared/env.ts` (수정) | GOOGLE_*·OAUTH_STATE_SECRET·APP_BASE_URL 추가 | 1 |
| `src/features/auth/db.ts` (수정) | `authIdentity` 표면 추가 | 1 |
| `src/features/auth/audit.ts` (수정) | OAUTH_* 이벤트 추가 | 1 |
| `src/features/auth/oauth/provider.ts` | `OAuthAdapter` 인터페이스, `getAdapter` | 1 |
| `src/features/auth/oauth/google.ts` | 실제 Google + 키 없으면 목 폴백 | 1 |
| `src/features/auth/oauth/mock.ts` | 목 어댑터 팩토리(Kakao/Naver + Google 폴백) | 1 |
| `src/features/auth/oauth/state.ts` | state 서명·검증·쿠키 | 2 |
| `src/features/auth/session.ts` (수정) | `currentUserFromRefresh` 추가 | 3 |
| `src/features/auth/oauth/link.ts` | login/register/link/unlink 서비스, 닉네임 생성 | 3 |
| `src/app/api/auth/oauth/[provider]/start/route.ts` | authorize 리다이렉트 | 4 |
| `src/app/api/auth/oauth/[provider]/callback/route.ts` | 콜백 처리 | 4 |
| `src/app/api/auth/oauth/[provider]/unlink/route.ts` | 연동 해제 | 4 |
| `src/i18n/messages/{ko,en}.json` (수정) | oauth 카탈로그 | 5 |
| `src/features/auth/SocialButtons.tsx` | 소셜 로그인 버튼 | 5 |
| `src/features/auth/ConnectionsManager.tsx` | 연동/해제 클라 컴포넌트 | 5 |
| `src/app/settings/connections/page.tsx` | 연동 관리 페이지(SSR) | 5 |
| `e2e/oauth.spec.ts` | E2E | 6 |
| `docs/worklog/2026-07-24-oauth-login.md` | 워크로그 | 6 |

---

### Task 1 🟢: env + AuthDb + 감사 이벤트 + 어댑터

**Files:**
- Modify: `src/features/_shared/env.ts`, `src/features/auth/db.ts`, `src/features/auth/audit.ts`, `vitest.setup.ts`, `.env`, `.env.example`
- Create: `src/features/auth/oauth/provider.ts`, `google.ts`, `kakao.ts`, `naver.ts`
- Test: `src/features/auth/oauth/provider.test.ts`

**Interfaces:**
- Produces:
  - `interface OAuthUserInfo { providerUserId: string; email: string }`
  - `interface OAuthAdapter { readonly provider: "GOOGLE"|"KAKAO"|"NAVER"; authorizeUrl(state: string, mockHint?: string): string; exchange(code: string): Promise<OAuthUserInfo> }`
  - `getAdapter(provider: string): OAuthAdapter` (미지원 → `AppError("UNKNOWN_PROVIDER", …, 400)`)
  - `AuthDb`에 `authIdentity` 추가, `AUTH_EVENTS`에 `OAUTH_LOGIN/OAUTH_REGISTER/OAUTH_LINK/OAUTH_UNLINK/OAUTH_FAIL`

- [ ] **Step 1: env 확장**

`src/features/_shared/env.ts`의 `schema`에 `NODE_ENV` 위에 추가:

```ts
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  GOOGLE_REDIRECT_URI: z.string().optional(),
  OAUTH_STATE_SECRET: z.string().min(16),
  APP_BASE_URL: z.string().default("http://localhost:3000"),
```

`vitest.setup.ts`에 추가(기존 주입부 아래):
```ts
process.env.OAUTH_STATE_SECRET ??= "test_oauth_state_secret_min16";
```

`.env`·`.env.example` 둘 다에 추가:
```
OAUTH_STATE_SECRET=change_me_oauth_state_secret_min16
APP_BASE_URL=http://localhost:3000
# GOOGLE_CLIENT_ID=...      # 없으면 Google도 목으로 동작
# GOOGLE_CLIENT_SECRET=...
# GOOGLE_REDIRECT_URI=http://localhost:3000/api/auth/oauth/google/callback
```

- [ ] **Step 2: AuthDb·감사 이벤트 확장**

`src/features/auth/db.ts`:
```ts
export type AuthDb = Pick<PrismaClient, "user" | "session" | "authAuditLog" | "authIdentity">;
```

`src/features/auth/audit.ts`의 `AUTH_EVENTS`에 추가:
```ts
  OAUTH_LOGIN: "OAUTH_LOGIN",
  OAUTH_REGISTER: "OAUTH_REGISTER",
  OAUTH_LINK: "OAUTH_LINK",
  OAUTH_UNLINK: "OAUTH_UNLINK",
  OAUTH_FAIL: "OAUTH_FAIL",
```

- [ ] **Step 3: 실패하는 어댑터 테스트 작성**

`src/features/auth/oauth/provider.test.ts`:
```ts
// @vitest-environment node
import { describe, it, expect } from "vitest";
import { getAdapter } from "./provider";
import { AppError } from "@/features/_shared/error";

describe("getAdapter", () => {
  it("returns an adapter per known provider", () => {
    expect(getAdapter("google").provider).toBe("GOOGLE");
    expect(getAdapter("kakao").provider).toBe("KAKAO");
    expect(getAdapter("naver").provider).toBe("NAVER");
  });

  it("is case-insensitive on the provider slug", () => {
    expect(getAdapter("GOOGLE").provider).toBe("GOOGLE");
  });

  it("rejects an unknown provider", () => {
    expect(() => getAdapter("facebook")).toThrow(AppError);
  });
});

describe("mock adapter", () => {
  it("maps the same hint to the same identity (stable re-login)", async () => {
    const a = await getAdapter("kakao").exchange("abc");
    const b = await getAdapter("kakao").exchange("abc");
    expect(a).toEqual(b);
    expect(a.providerUserId).toContain("kakao");
    expect(a.email).toContain("@");
  });

  it("maps different hints to different identities", async () => {
    const a = await getAdapter("kakao").exchange("u1");
    const b = await getAdapter("kakao").exchange("u2");
    expect(a.providerUserId).not.toBe(b.providerUserId);
  });

  it("authorizeUrl round-trips the mock hint into the callback code", async () => {
    const url = new URL(getAdapter("naver").authorizeUrl("state123", "u9"));
    expect(url.pathname).toBe("/api/auth/oauth/naver/callback");
    expect(url.searchParams.get("state")).toBe("state123");
    const code = url.searchParams.get("code")!;
    const info = await getAdapter("naver").exchange(code);
    expect(info).toEqual(await getAdapter("naver").exchange("u9"));
  });

  it("google falls back to mock when keys are absent", async () => {
    // 테스트 env엔 GOOGLE_* 없음 → 목 동작
    const url = new URL(getAdapter("google").authorizeUrl("s", "g1"));
    expect(url.pathname).toBe("/api/auth/oauth/google/callback");
    expect((await getAdapter("google").exchange("g1")).providerUserId).toContain("google");
  });
});
```

- [ ] **Step 4: 실패 확인**

```bash
pnpm exec vitest run src/features/auth/oauth/provider.test.ts
```
Expected: FAIL — `Failed to resolve import "./provider"`

- [ ] **Step 5: provider 인터페이스 + 목 구현**

`src/features/auth/oauth/provider.ts`:
```ts
import { getEnv } from "@/features/_shared/env";
import { AppError } from "@/features/_shared/error";
import { GoogleAdapter } from "./google";
import { makeMockAdapter } from "./mock";

export type ProviderName = "GOOGLE" | "KAKAO" | "NAVER";

export interface OAuthUserInfo {
  providerUserId: string;
  email: string;
}

export interface OAuthAdapter {
  readonly provider: ProviderName;
  authorizeUrl(state: string, mockHint?: string): string;
  exchange(code: string): Promise<OAuthUserInfo>;
}

const SLUGS: Record<string, ProviderName> = { google: "GOOGLE", kakao: "KAKAO", naver: "NAVER" };

export function getAdapter(slug: string): OAuthAdapter {
  const name = SLUGS[slug.toLowerCase()];
  if (!name) throw new AppError("UNKNOWN_PROVIDER", "지원하지 않는 로그인 방식이에요.", 400);
  if (name === "GOOGLE") {
    const env = getEnv();
    if (env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET && env.GOOGLE_REDIRECT_URI) {
      return new GoogleAdapter(env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET, env.GOOGLE_REDIRECT_URI);
    }
    return makeMockAdapter("GOOGLE");
  }
  return makeMockAdapter(name);
}
```

`src/features/auth/oauth/mock.ts`:
```ts
import { getEnv } from "@/features/_shared/env";
import type { OAuthAdapter, OAuthUserInfo, ProviderName } from "./provider";

/**
 * 실 네트워크 없는 목 어댑터. 키 없이 전 플로우·테스트 동작(#1a 어댑터 원칙).
 * 신원은 code(=mockHint)에서 결정적으로 파생 → 같은 hint=같은 유저(재로그인 재현),
 * 다른 hint=다른 유저(E2E가 실행마다 고유 신원 사용).
 */
export function makeMockAdapter(provider: ProviderName): OAuthAdapter {
  const slug = provider.toLowerCase();
  return {
    provider,
    authorizeUrl(state, mockHint) {
      const base = getEnv().APP_BASE_URL;
      const code = encodeURIComponent(mockHint ?? "default");
      return `${base}/api/auth/oauth/${slug}/callback?code=${code}&state=${encodeURIComponent(state)}`;
    },
    async exchange(code) {
      const handle = code || "default";
      const info: OAuthUserInfo = {
        providerUserId: `${slug}-${handle}`,
        email: `${slug}.${handle}@example.com`,
      };
      return info;
    },
  };
}
```

`src/features/auth/oauth/google.ts`:
```ts
import { getEnv } from "@/features/_shared/env";
import { AppError } from "@/features/_shared/error";
import type { OAuthAdapter, OAuthUserInfo } from "./provider";

const AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const USERINFO_ENDPOINT = "https://openidconnect.googleapis.com/v1/userinfo";

/** 실제 Google OAuth. 키 3종이 있을 때만 provider.ts가 이걸 쓴다. */
export class GoogleAdapter implements OAuthAdapter {
  readonly provider = "GOOGLE" as const;
  constructor(
    private clientId: string,
    private clientSecret: string,
    private redirectUri: string,
  ) {}

  authorizeUrl(state: string): string {
    const p = new URLSearchParams({
      client_id: this.clientId,
      redirect_uri: this.redirectUri,
      response_type: "code",
      scope: "openid email",
      state,
    });
    return `${AUTH_ENDPOINT}?${p.toString()}`;
  }

  async exchange(code: string): Promise<OAuthUserInfo> {
    const tokenRes = await fetch(TOKEN_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: this.clientId,
        client_secret: this.clientSecret,
        redirect_uri: this.redirectUri,
        grant_type: "authorization_code",
      }),
    });
    if (!tokenRes.ok) throw new AppError("OAUTH_EXCHANGE_FAILED", "소셜 로그인에 실패했어요.", 502);
    const { access_token } = (await tokenRes.json()) as { access_token?: string };
    if (!access_token) throw new AppError("OAUTH_EXCHANGE_FAILED", "소셜 로그인에 실패했어요.", 502);

    const infoRes = await fetch(USERINFO_ENDPOINT, {
      headers: { authorization: `Bearer ${access_token}` },
    });
    if (!infoRes.ok) throw new AppError("OAUTH_EXCHANGE_FAILED", "소셜 로그인에 실패했어요.", 502);
    const info = (await infoRes.json()) as { sub?: string; email?: string };
    if (!info.sub || !info.email) throw new AppError("OAUTH_EXCHANGE_FAILED", "소셜 로그인에 실패했어요.", 502);
    return { providerUserId: info.sub, email: info.email };
  }
}
```
`kakao.ts`·`naver.ts`는 별도 파일이 필요 없다 — `makeMockAdapter`로 충분(계획 File Structure의 kakao/naver는 mock.ts로 통합). getAdapter가 목을 반환한다.

- [ ] **Step 6: 통과 확인**

```bash
pnpm exec vitest run src/features/auth/oauth/provider.test.ts && pnpm exec tsc --noEmit
```
Expected: PASS, 타입 에러 없음

- [ ] **Step 7: 커밋**

```bash
git add src/features/_shared/env.ts src/features/auth/db.ts src/features/auth/audit.ts src/features/auth/oauth vitest.setup.ts .env.example
git commit -m "OAuth 어댑터(Google 실제+목 폴백/Kakao/Naver 목)와 env·감사 이벤트 추가"
```

---

### Task 2 🔴: state CSRF

**Files:**
- Create: `src/features/auth/oauth/state.ts`, `src/features/auth/oauth/state.test.ts`

**Interfaces:**
- Consumes: `getEnv()`
- Produces:
  - `STATE_COOKIE`, `interface StatePayload { nonce, mode: "login"|"link", provider, userId?, exp }`
  - `signState(p: { mode, provider, userId? }): string`
  - `verifyState(raw: string | null, expectedProvider: string): StatePayload | null`
  - `stateCookie(state): string`, `clearStateCookie(): string`, `readStateCookie(req): string | null`

- [ ] **Step 1: 실패하는 테스트 작성**

`src/features/auth/oauth/state.test.ts`:
```ts
// @vitest-environment node
import { describe, it, expect } from "vitest";
import { signState, verifyState, stateCookie, readStateCookie, STATE_COOKIE } from "./state";

describe("state sign/verify", () => {
  it("round-trips a login payload", () => {
    const raw = signState({ mode: "login", provider: "GOOGLE" });
    const p = verifyState(raw, "GOOGLE");
    expect(p?.mode).toBe("login");
    expect(p?.provider).toBe("GOOGLE");
  });

  it("carries userId for link mode", () => {
    const raw = signState({ mode: "link", provider: "KAKAO", userId: "u1" });
    expect(verifyState(raw, "KAKAO")?.userId).toBe("u1");
  });

  it("rejects a tampered payload", () => {
    const raw = signState({ mode: "login", provider: "GOOGLE" });
    const [body, sig] = raw.split(".");
    const forged = Buffer.from('{"mode":"login","provider":"GOOGLE","nonce":"x","exp":9999999999999}').toString("base64url");
    expect(verifyState(`${forged}.${sig}`, "GOOGLE")).toBeNull();
    expect(verifyState(`${body}.deadbeef`, "GOOGLE")).toBeNull();
  });

  it("rejects a provider mismatch", () => {
    const raw = signState({ mode: "login", provider: "GOOGLE" });
    expect(verifyState(raw, "KAKAO")).toBeNull();
  });

  it("rejects garbage and null", () => {
    expect(verifyState(null, "GOOGLE")).toBeNull();
    expect(verifyState("nope", "GOOGLE")).toBeNull();
    expect(verifyState("a.b", "GOOGLE")).toBeNull();
  });
});

describe("state cookie", () => {
  it("is HttpOnly SameSite=Lax with a 10-minute max-age", () => {
    const h = stateCookie("s1");
    expect(h).toContain(`${STATE_COOKIE}=s1`);
    expect(h).toContain("HttpOnly");
    expect(h).toContain("SameSite=Lax");
    expect(h).toContain("Max-Age=600");
  });

  it("reads the cookie back from a request", () => {
    const req = new Request("http://x/cb", { headers: { cookie: `a=1; ${STATE_COOKIE}=s1; b=2` } });
    expect(readStateCookie(req)).toBe("s1");
  });
});
```

- [ ] **Step 2: 실패 확인**

```bash
pnpm exec vitest run src/features/auth/oauth/state.test.ts
```
Expected: FAIL — `Failed to resolve import "./state"`

- [ ] **Step 3: 구현**

`src/features/auth/oauth/state.ts`:
```ts
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { getEnv } from "@/features/_shared/env";

export const STATE_COOKIE = "oauth_state";
const STATE_TTL_MS = 10 * 60 * 1000;

export interface StatePayload {
  nonce: string;
  mode: "login" | "link";
  provider: string;
  userId?: string;
  exp: number;
}

function sign(json: string): string {
  return createHmac("sha256", getEnv().OAUTH_STATE_SECRET).update(json).digest("base64url");
}

export function signState(p: { mode: "login" | "link"; provider: string; userId?: string }): string {
  const payload: StatePayload = { ...p, nonce: randomUUID(), exp: Date.now() + STATE_TTL_MS };
  const json = JSON.stringify(payload);
  return `${Buffer.from(json).toString("base64url")}.${sign(json)}`;
}

export function verifyState(raw: string | null, expectedProvider: string): StatePayload | null {
  if (!raw) return null;
  const [body, sig] = raw.split(".");
  if (!body || !sig) return null;

  let json: string;
  try {
    json = Buffer.from(body, "base64url").toString("utf8");
  } catch {
    return null;
  }

  const expected = sign(json);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  let payload: StatePayload;
  try {
    payload = JSON.parse(json);
  } catch {
    return null;
  }
  if (payload.provider !== expectedProvider) return null;
  if (typeof payload.exp !== "number" || payload.exp < Date.now()) return null;
  return payload;
}

function secure(): string {
  return getEnv().NODE_ENV === "production" ? "; Secure" : "";
}

export function stateCookie(state: string): string {
  return `${STATE_COOKIE}=${state}; HttpOnly; SameSite=Lax; Path=/; Max-Age=600${secure()}`;
}

export function clearStateCookie(): string {
  return `${STATE_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${secure()}`;
}

export function readStateCookie(req: Request): string | null {
  const header = req.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === STATE_COOKIE) return rest.join("=") || null;
  }
  return null;
}
```

- [ ] **Step 4: 통과 확인**

```bash
pnpm exec vitest run src/features/auth/oauth/state.test.ts
```
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add src/features/auth/oauth/state.ts src/features/auth/oauth/state.test.ts
git commit -m "OAuth state CSRF 서명·검증·쿠키 추가"
```

---

### Task 3 🔴: 연동 서비스 + currentUserFromRefresh

**Files:**
- Modify: `src/features/auth/session.ts`, `src/features/auth/session.test.ts`
- Create: `src/features/auth/oauth/link.ts`, `src/features/auth/oauth/link.test.ts`

**Interfaces:**
- Consumes: `createSession`/`IssuedSession`·`hashRefreshToken`(session), `encryptPII`/`emailIndex`(crypto), `AUTH_EVENTS`/`logAuthEvent`/`RequestMeta`(audit), `AppError`, `AuthDb`, `OAuthUserInfo`
- Produces:
  - `currentUserFromRefresh(db, refreshToken: string | null): Promise<{ userId: string } | null>`
  - `loginOrRegisterWithOAuth(db, provider, info, meta): Promise<IssuedSession & { userId: string }>`
  - `linkIdentity(db, userId, provider, info, meta): Promise<void>`
  - `unlinkIdentity(db, userId, provider, meta): Promise<void>`
  - `generateNickname(db): Promise<string>`

- [ ] **Step 1: 실패하는 session 헬퍼 테스트 추가**

`src/features/auth/session.test.ts` 파일 끝에 추가(상단 import에 `currentUserFromRefresh` 추가):
```ts
describe("currentUserFromRefresh", () => {
  const future = new Date(Date.now() + 86_400_000);
  function db(session: unknown) {
    return { session: { findUnique: vi.fn().mockResolvedValue(session) } } as unknown as AuthDb;
  }

  it("returns the userId for a live session", async () => {
    const d = db({ userId: "u1", expiresAt: future, revokedAt: null, user: { deletedAt: null } });
    expect(await currentUserFromRefresh(d, "tok")).toEqual({ userId: "u1" });
  });

  it("returns null without a cookie", async () => {
    expect(await currentUserFromRefresh(db(null), null)).toBeNull();
  });

  it("returns null for revoked / expired / deleted / unknown", async () => {
    expect(await currentUserFromRefresh(db(null), "tok")).toBeNull();
    expect(await currentUserFromRefresh(db({ userId: "u1", expiresAt: future, revokedAt: new Date(), user: { deletedAt: null } }), "tok")).toBeNull();
    expect(await currentUserFromRefresh(db({ userId: "u1", expiresAt: new Date(Date.now() - 1000), revokedAt: null, user: { deletedAt: null } }), "tok")).toBeNull();
    expect(await currentUserFromRefresh(db({ userId: "u1", expiresAt: future, revokedAt: null, user: { deletedAt: new Date() } }), "tok")).toBeNull();
  });
});
```

- [ ] **Step 2: 실패하는 link 서비스 테스트 작성**

`src/features/auth/oauth/link.test.ts`:
```ts
// @vitest-environment node
import { describe, it, expect, vi } from "vitest";
import { loginOrRegisterWithOAuth, linkIdentity, unlinkIdentity, generateNickname } from "./link";
import { emailIndex } from "@/features/_shared/crypto";
import type { AuthDb } from "../db";

const meta = { ip: null, ua: null };
const info = { providerUserId: "google-u1", email: "google.u1@example.com" };

function baseDb(over: Record<string, unknown> = {}) {
  return {
    authIdentity: {
      findUnique: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ id: "i1" }),
      delete: vi.fn().mockResolvedValue({}),
    },
    user: {
      findFirst: vi.fn().mockResolvedValue(null),
      findUnique: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ id: "u-new" }),
    },
    session: { create: vi.fn().mockResolvedValue({ id: "s1" }) },
    authAuditLog: { create: vi.fn().mockResolvedValue({}) },
    ...over,
  } as unknown as AuthDb;
}

describe("loginOrRegisterWithOAuth", () => {
  it("logs into the existing user when the identity is known", async () => {
    const db = baseDb({
      authIdentity: { findUnique: vi.fn().mockResolvedValue({ userId: "u1", user: { id: "u1", deletedAt: null } }) },
      session: { create: vi.fn().mockResolvedValue({ id: "s1" }) },
      authAuditLog: { create: vi.fn().mockResolvedValue({}) },
    });
    const r = await loginOrRegisterWithOAuth(db, "GOOGLE", info, meta);
    expect(r.userId).toBe("u1");
    expect(r.refreshToken.length).toBeGreaterThan(20);
    expect((db.authAuditLog.create as any).mock.calls[0][0].data.event).toBe("OAUTH_LOGIN");
  });

  it("creates a passwordless user + identity when nothing matches", async () => {
    const create = vi.fn().mockResolvedValue({ id: "u-new" });
    const db = baseDb({
      user: { findFirst: vi.fn().mockResolvedValue(null), findUnique: vi.fn().mockResolvedValue(null), create },
    });
    const r = await loginOrRegisterWithOAuth(db, "GOOGLE", info, meta);
    expect(r.userId).toBe("u-new");
    const data = create.mock.calls[0][0].data;
    expect(data.passwordHash).toBeUndefined();
    expect(JSON.stringify(data)).not.toContain("google.u1@example.com"); // 평문 이메일 없음
    expect(data.emailBlindIndex).toBe(emailIndex(info.email));
    expect(data.identities.create.providerUserId).toBe("google-u1");
    expect((db.authAuditLog.create as any).mock.calls[0][0].data.event).toBe("OAUTH_REGISTER");
  });

  it("refuses to auto-link when the email already exists", async () => {
    const db = baseDb({ user: { findFirst: vi.fn().mockResolvedValue({ id: "other" }), findUnique: vi.fn(), create: vi.fn() } });
    await expect(loginOrRegisterWithOAuth(db, "GOOGLE", info, meta)).rejects.toMatchObject({ code: "OAUTH_EMAIL_EXISTS", httpStatus: 409 });
  });

  it("rejects a soft-deleted user", async () => {
    const db = baseDb({ authIdentity: { findUnique: vi.fn().mockResolvedValue({ userId: "u1", user: { id: "u1", deletedAt: new Date() } }) } });
    await expect(loginOrRegisterWithOAuth(db, "GOOGLE", info, meta)).rejects.toMatchObject({ code: "AUTH_FAILED" });
  });
});

describe("linkIdentity", () => {
  it("links a new identity to the current user", async () => {
    const create = vi.fn().mockResolvedValue({ id: "i1" });
    const db = baseDb({ authIdentity: { findUnique: vi.fn().mockResolvedValue(null), create } });
    await linkIdentity(db, "u1", "KAKAO", { providerUserId: "kakao-x", email: "k@example.com" }, meta);
    expect(create.mock.calls[0][0].data).toMatchObject({ userId: "u1", provider: "KAKAO", providerUserId: "kakao-x" });
  });

  it("is idempotent when the identity is already linked to this user", async () => {
    const create = vi.fn();
    const db = baseDb({ authIdentity: { findUnique: vi.fn().mockResolvedValue({ userId: "u1" }), create } });
    await linkIdentity(db, "u1", "KAKAO", { providerUserId: "kakao-x", email: "k@example.com" }, meta);
    expect(create).not.toHaveBeenCalled();
  });

  it("rejects an identity owned by another user", async () => {
    const db = baseDb({ authIdentity: { findUnique: vi.fn().mockResolvedValue({ userId: "other" }), create: vi.fn() } });
    await expect(linkIdentity(db, "u1", "KAKAO", { providerUserId: "kakao-x", email: "k@example.com" }, meta)).rejects.toMatchObject({ code: "IDENTITY_TAKEN" });
  });
});

describe("unlinkIdentity", () => {
  it("unlinks when other credentials remain", async () => {
    const del = vi.fn().mockResolvedValue({});
    const db = baseDb({
      user: { findUnique: vi.fn().mockResolvedValue({ passwordHash: "$2b$x", identities: [{ id: "i1", provider: "KAKAO" }] }), findFirst: vi.fn(), create: vi.fn() },
      authIdentity: { findUnique: vi.fn(), create: vi.fn(), delete: del },
    });
    await unlinkIdentity(db, "u1", "KAKAO", meta);
    expect(del).toHaveBeenCalledWith({ where: { id: "i1" } });
  });

  it("refuses to unlink the last credential", async () => {
    const db = baseDb({
      user: { findUnique: vi.fn().mockResolvedValue({ passwordHash: null, identities: [{ id: "i1", provider: "KAKAO" }] }), findFirst: vi.fn(), create: vi.fn() },
    });
    await expect(unlinkIdentity(db, "u1", "KAKAO", meta)).rejects.toMatchObject({ code: "LAST_CREDENTIAL", httpStatus: 409 });
  });

  it("404s when the provider is not linked", async () => {
    const db = baseDb({
      user: { findUnique: vi.fn().mockResolvedValue({ passwordHash: "$2b$x", identities: [{ id: "i1", provider: "KAKAO" }] }), findFirst: vi.fn(), create: vi.fn() },
    });
    await expect(unlinkIdentity(db, "u1", "NAVER", meta)).rejects.toMatchObject({ code: "IDENTITY_NOT_FOUND", httpStatus: 404 });
  });
});

describe("generateNickname", () => {
  it("retries until it finds a free nickname", async () => {
    const findUnique = vi.fn().mockResolvedValueOnce({ id: "x" }).mockResolvedValueOnce(null);
    const db = baseDb({ user: { findUnique, findFirst: vi.fn(), create: vi.fn() } });
    const n = await generateNickname(db);
    expect(n).toMatch(/^이웃-\d{4}$/);
    expect(findUnique).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 3: 실패 확인**

```bash
pnpm exec vitest run src/features/auth/session.test.ts src/features/auth/oauth/link.test.ts
```
Expected: FAIL — import 해결 실패 / `currentUserFromRefresh is not a function`

- [ ] **Step 4: session 헬퍼 구현**

`src/features/auth/session.ts` 파일 끝에 추가:
```ts
/**
 * refresh 쿠키로 현재 유저를 회전 없이 조회한다(OAuth 연동 등 로그인 상태 확인용).
 * 유효하지 않은 세션이면 null.
 */
export async function currentUserFromRefresh(
  db: AuthDb,
  refreshToken: string | null,
): Promise<{ userId: string } | null> {
  if (!refreshToken) return null;
  const session = await db.session.findUnique({
    where: { tokenHash: hashRefreshToken(refreshToken) },
    select: { userId: true, expiresAt: true, revokedAt: true, user: { select: { deletedAt: true } } },
  });
  if (!session || session.revokedAt || session.expiresAt.getTime() <= Date.now() || session.user.deletedAt) return null;
  return { userId: session.userId };
}
```
(상단 import에 `hashRefreshToken`이 이미 있음.)

- [ ] **Step 5: link 서비스 구현**

`src/features/auth/oauth/link.ts`:
```ts
import { encryptPII, emailIndex } from "@/features/_shared/crypto";
import { AppError } from "@/features/_shared/error";
import { createSession, type IssuedSession } from "../session";
import { AUTH_EVENTS, logAuthEvent, type RequestMeta } from "../audit";
import type { AuthDb } from "../db";
import type { OAuthUserInfo, ProviderName } from "./provider";

function isUniqueViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: unknown }).code === "P2002";
}

export async function generateNickname(db: AuthDb): Promise<string> {
  for (let i = 0; i < 10; i++) {
    const nickname = `이웃-${Math.floor(1000 + Math.random() * 9000)}`;
    const exists = await db.user.findUnique({ where: { nickname }, select: { id: true } });
    if (!exists) return nickname;
  }
  throw new AppError("NICKNAME_GEN_FAILED", "잠시 후 다시 시도해 주세요.", 503);
}

export async function loginOrRegisterWithOAuth(
  db: AuthDb,
  provider: ProviderName,
  info: OAuthUserInfo,
  meta: RequestMeta,
): Promise<IssuedSession & { userId: string }> {
  const identity = await db.authIdentity.findUnique({
    where: { provider_providerUserId: { provider, providerUserId: info.providerUserId } },
    select: { userId: true, user: { select: { id: true, deletedAt: true } } },
  });

  if (identity) {
    if (identity.user.deletedAt) throw new AppError("AUTH_FAILED", "다시 로그인해 주세요.", 401);
    const session = await createSession(db, identity.userId);
    await logAuthEvent(db, AUTH_EVENTS.OAUTH_LOGIN, identity.userId, meta);
    return { ...session, userId: identity.userId };
  }

  const existing = await db.user.findFirst({
    where: { emailBlindIndex: emailIndex(info.email) },
    select: { id: true },
  });
  if (existing) {
    await logAuthEvent(db, AUTH_EVENTS.OAUTH_FAIL, existing.id, meta);
    throw new AppError("OAUTH_EMAIL_EXISTS", "이 이메일은 이미 가입돼 있어요. 로그인 후 계정 설정에서 연동해 주세요.", 409);
  }

  const nickname = await generateNickname(db);
  let user: { id: string };
  try {
    user = await db.user.create({
      data: {
        nickname,
        emailCiphertext: encryptPII(info.email),
        emailBlindIndex: emailIndex(info.email),
        consentedAt: new Date(),
        identities: { create: { provider, providerUserId: info.providerUserId } },
      },
      select: { id: true },
    });
  } catch (err) {
    // 동시 OAuth 가입 경합: 같은 이메일/신원이 먼저 생성된 경우
    if (isUniqueViolation(err)) throw new AppError("OAUTH_EMAIL_EXISTS", "이 이메일은 이미 가입돼 있어요. 로그인 후 계정 설정에서 연동해 주세요.", 409);
    throw err;
  }

  const session = await createSession(db, user.id);
  await logAuthEvent(db, AUTH_EVENTS.OAUTH_REGISTER, user.id, meta);
  return { ...session, userId: user.id };
}

export async function linkIdentity(
  db: AuthDb,
  userId: string,
  provider: ProviderName,
  info: OAuthUserInfo,
  meta: RequestMeta,
): Promise<void> {
  const existing = await db.authIdentity.findUnique({
    where: { provider_providerUserId: { provider, providerUserId: info.providerUserId } },
    select: { userId: true },
  });
  if (existing) {
    if (existing.userId === userId) return; // 멱등
    throw new AppError("IDENTITY_TAKEN", "다른 계정에 연동된 소셜 계정이에요.", 409);
  }
  try {
    await db.authIdentity.create({ data: { userId, provider, providerUserId: info.providerUserId } });
  } catch (err) {
    if (isUniqueViolation(err)) throw new AppError("IDENTITY_TAKEN", "다른 계정에 연동된 소셜 계정이에요.", 409);
    throw err;
  }
  await logAuthEvent(db, AUTH_EVENTS.OAUTH_LINK, userId, meta);
}

export async function unlinkIdentity(
  db: AuthDb,
  userId: string,
  provider: ProviderName,
  meta: RequestMeta,
): Promise<void> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { passwordHash: true, identities: { select: { id: true, provider: true } } },
  });
  if (!user) throw new AppError("AUTH_FAILED", "다시 로그인해 주세요.", 401);

  const target = user.identities.find((i) => i.provider === provider);
  if (!target) throw new AppError("IDENTITY_NOT_FOUND", "연동되지 않은 소셜 계정이에요.", 404);

  const credentials = (user.passwordHash ? 1 : 0) + user.identities.length;
  if (credentials <= 1) {
    throw new AppError("LAST_CREDENTIAL", "마지막 로그인 수단이라 해제할 수 없어요. 비밀번호를 먼저 설정해 주세요.", 409);
  }

  await db.authIdentity.delete({ where: { id: target.id } });
  await logAuthEvent(db, AUTH_EVENTS.OAUTH_UNLINK, userId, meta);
}
```

- [ ] **Step 6: 통과 확인**

```bash
pnpm exec vitest run src/features/auth/session.test.ts src/features/auth/oauth/link.test.ts && pnpm exec tsc --noEmit
```
Expected: PASS, 타입 에러 없음

- [ ] **Step 7: 커밋**

```bash
git add src/features/auth/session.ts src/features/auth/session.test.ts src/features/auth/oauth/link.ts src/features/auth/oauth/link.test.ts
git commit -m "OAuth 로그인·가입·연동/해제 서비스와 세션 헬퍼 추가"
```

---

### Task 4 🔴: OAuth 라우트 (start / callback / unlink)

**Files:**
- Create: `src/app/api/auth/oauth/[provider]/start/route.ts`, `callback/route.ts`, `unlink/route.ts`

**Interfaces:**
- Consumes: `getAdapter`, `signState`/`verifyState`/`stateCookie`/`clearStateCookie`/`readStateCookie`, `loginOrRegisterWithOAuth`/`linkIdentity`/`unlinkIdentity`, `currentUserFromRefresh`, `refreshCookie`/`readRefreshCookie`, `requestMeta`, `withErrorHandling`, `prisma`, `getEnv`
- Produces: 3개 라우트. E2E(Task 6)가 호출.

- [ ] **Step 1: start 라우트**

`src/app/api/auth/oauth/[provider]/start/route.ts`:
```ts
import { NextResponse } from "next/server";
import { getEnv } from "@/features/_shared/env";
import { prisma } from "@/features/_shared/prisma";
import { getAdapter } from "@/features/auth/oauth/provider";
import { signState, stateCookie } from "@/features/auth/oauth/state";
import { currentUserFromRefresh } from "@/features/auth/session";
import { readRefreshCookie } from "@/features/auth/cookies";

// 리다이렉트 기반이라 withErrorHandling(JSON) 대신 자체 try/catch로 실패를 리다이렉트로 변환한다.
export async function GET(req: Request, ctx: { params: Promise<{ provider: string }> }) {
  const base = getEnv().APP_BASE_URL;
  try {
    const { provider } = await ctx.params;
    const adapter = getAdapter(provider); // 미지원 provider → AppError → catch
    const url = new URL(req.url);
    const link = url.searchParams.get("link") === "1";
    const mockHint = url.searchParams.get("mock_as") ?? undefined;

    let userId: string | undefined;
    if (link) {
      const current = await currentUserFromRefresh(prisma, readRefreshCookie(req));
      if (!current) return NextResponse.redirect(`${base}/login?error=login_required`);
      userId = current.userId;
    }

    const state = signState({ mode: link ? "link" : "login", provider: adapter.provider, userId });
    const res = NextResponse.redirect(adapter.authorizeUrl(state, mockHint));
    res.headers.append("set-cookie", stateCookie(state));
    return res;
  } catch {
    return NextResponse.redirect(`${base}/login?error=oauth_failed`);
  }
}
```

- [ ] **Step 2: callback 라우트**

`src/app/api/auth/oauth/[provider]/callback/route.ts`:
```ts
import { NextResponse } from "next/server";
import { AppError } from "@/features/_shared/error";
import { getEnv } from "@/features/_shared/env";
import { prisma } from "@/features/_shared/prisma";
import { getAdapter } from "@/features/auth/oauth/provider";
import { verifyState, readStateCookie, clearStateCookie } from "@/features/auth/oauth/state";
import { loginOrRegisterWithOAuth, linkIdentity } from "@/features/auth/oauth/link";
import { refreshCookie } from "@/features/auth/cookies";
import { requestMeta } from "@/features/auth/audit";

// AppError.code → 리다이렉트 쿼리(사용자에게 코드만 노출, 카탈로그가 문자열 매핑)
const ERROR_QUERY: Record<string, string> = {
  OAUTH_EMAIL_EXISTS: "email_exists",
  IDENTITY_TAKEN: "identity_taken",
};

export async function GET(req: Request, ctx: { params: Promise<{ provider: string }> }) {
  const base = getEnv().APP_BASE_URL;
  let mode: "login" | "link" = "login";
  try {
    const { provider } = await ctx.params;
    const adapter = getAdapter(provider);
    const url = new URL(req.url);
    const code = url.searchParams.get("code");
    const rawState = url.searchParams.get("state");
    const cookieState = readStateCookie(req);

    // double-submit: 쿼리 state와 쿠키 state가 정확히 같아야 한다
    if (!code || !rawState || !cookieState || rawState !== cookieState) {
      return redirect(`${base}/login?error=oauth_failed`);
    }
    const state = verifyState(rawState, adapter.provider);
    if (!state) return redirect(`${base}/login?error=oauth_failed`);
    mode = state.mode;

    const info = await adapter.exchange(code);
    const meta = requestMeta(req);

    if (mode === "link") {
      if (!state.userId) return redirect(`${base}/login?error=login_required`);
      await linkIdentity(prisma, state.userId, adapter.provider, info, meta);
      return redirect(`${base}/settings/connections?linked=${provider}`);
    }

    const session = await loginOrRegisterWithOAuth(prisma, adapter.provider, info, meta);
    const res = redirect(`${base}/`);
    res.headers.append("set-cookie", refreshCookie(session.refreshToken, session.expiresAt));
    return res;
  } catch (err) {
    const q = err instanceof AppError ? (ERROR_QUERY[err.code] ?? "oauth_failed") : "oauth_failed";
    const target = mode === "link" ? "/settings/connections" : "/login";
    return redirect(`${base}${target}?error=${q}`);
  }
}

// 콜백은 성공·실패 모두 state 쿠키를 지운다(일회용).
function redirect(to: string): NextResponse {
  const res = NextResponse.redirect(to);
  res.headers.append("set-cookie", clearStateCookie());
  return res;
}
```

- [ ] **Step 3: unlink 라우트**

`src/app/api/auth/oauth/[provider]/unlink/route.ts`:
```ts
import { withErrorHandling, AppError } from "@/features/_shared/error";
import { prisma } from "@/features/_shared/prisma";
import { getAdapter } from "@/features/auth/oauth/provider";
import { unlinkIdentity } from "@/features/auth/oauth/link";
import { currentUserFromRefresh } from "@/features/auth/session";
import { readRefreshCookie } from "@/features/auth/cookies";
import { requestMeta } from "@/features/auth/audit";

// 쿠키 기반 상태변경 POST. SameSite=Lax가 교차 사이트 POST에서 쿠키를 막아 CSRF 방어.
export const POST = withErrorHandling(async (req: Request, ctx?: unknown) => {
  const { provider } = await (ctx as { params: Promise<{ provider: string }> }).params;
  const name = getAdapter(provider).provider; // 검증 겸 정규화
  const current = await currentUserFromRefresh(prisma, readRefreshCookie(req));
  if (!current) throw new AppError("UNAUTHENTICATED", "로그인이 필요해요.", 401);
  await unlinkIdentity(prisma, current.userId, name, requestMeta(req));
  return Response.json({ ok: true });
});
```

- [ ] **Step 4: 수동 검증 (목 provider)**

```bash
docker compose up -d db
pnpm dev
```
다른 터미널:
```bash
# 목 카카오로 소셜 가입 (start → authorizeUrl이 곧장 콜백으로 되돌아옴)
curl -si -c /tmp/j.txt "localhost:3000/api/auth/oauth/kakao/start?mock_as=alice" | grep -i location   # → 콜백 URL
# 위 location을 그대로 호출(쿠키 유지)
L=$(curl -si -c /tmp/j.txt "localhost:3000/api/auth/oauth/kakao/start?mock_as=alice" | grep -i '^location' | tr -d '\r' | awk '{print $2}')
curl -si -b /tmp/j.txt -c /tmp/j.txt "$L" | grep -iE 'location|set-cookie'   # → / 로 리다이렉트 + refresh_token 쿠키
# 세션으로 access 취득
curl -s -b /tmp/j.txt -X POST localhost:3000/api/auth/refresh | head -c 80
docker compose exec -T db psql -U app -d app -c 'SELECT "provider","providerUserId" FROM "AuthIdentity"; SELECT "event" FROM "AuthAuditLog" ORDER BY "createdAt" DESC LIMIT 3;'
```
Expected: 콜백이 `/`로 302 + `refresh_token` 쿠키, refresh가 accessToken 반환, `AuthIdentity`에 `KAKAO/kakao-alice` 행, 감사에 `OAUTH_REGISTER`. psql 어디에도 평문 이메일 없음(User는 암호문만).

- [ ] **Step 5: 커밋**

```bash
git add src/app/api/auth/oauth
git commit -m "OAuth start·callback·unlink 라우트 추가"
```

---

### Task 5 🟢: UI (소셜 버튼 + 연동 페이지 + 카탈로그)

**Files:**
- Modify: `src/i18n/messages/ko.json`, `en.json`, `src/features/auth/LoginForm.tsx`, `SignupForm.tsx`(소셜 버튼 삽입)
- Create: `src/features/auth/SocialButtons.tsx`, `ConnectionsManager.tsx`, `src/app/settings/connections/page.tsx`
- Test: `src/features/auth/SocialButtons.test.tsx`, `ConnectionsManager.test.tsx`

**Interfaces:**
- Consumes: Task 4 라우트
- Produces: 소셜 버튼(로그인/가입), `/settings/connections` 페이지

- [ ] **Step 1: 카탈로그 추가**

`ko.json`의 `auth` 블록에 `oauth` 키 추가(기존 키 유지):
```json
    "oauth": {
      "google": "구글로 계속하기",
      "kakao": "카카오로 계속하기",
      "naver": "네이버로 계속하기",
      "or": "또는",
      "connections": "연결된 계정",
      "connected": "연결됨",
      "link": "연결하기",
      "unlink": "연결 해제",
      "emailExists": "이 이메일은 이미 가입돼 있어요. 로그인 후 여기서 연결해 주세요",
      "identityTaken": "다른 계정에 연결된 소셜 계정이에요",
      "lastCredential": "마지막 로그인 수단이라 해제할 수 없어요",
      "failed": "소셜 로그인에 실패했어요. 다시 시도해 주세요"
    }
```

`en.json`의 `auth` 블록:
```json
    "oauth": {
      "google": "Continue with Google",
      "kakao": "Continue with Kakao",
      "naver": "Continue with Naver",
      "or": "or",
      "connections": "Connected accounts",
      "connected": "Connected",
      "link": "Connect",
      "unlink": "Disconnect",
      "emailExists": "That email is already registered. Log in and connect it here",
      "identityTaken": "That social account is linked to another account",
      "lastCredential": "This is your last sign-in method and can't be removed",
      "failed": "Social login failed. Please try again"
    }
```

- [ ] **Step 2: 실패하는 컴포넌트 테스트 작성**

`src/features/auth/SocialButtons.test.tsx`:
```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { SocialButtons } from "./SocialButtons";
import ko from "@/i18n/messages/ko.json";

function renderIt() {
  return render(
    <NextIntlClientProvider locale="ko" messages={ko}>
      <SocialButtons />
    </NextIntlClientProvider>,
  );
}

describe("SocialButtons", () => {
  it("links each provider to its start endpoint", () => {
    renderIt();
    expect(screen.getByRole("link", { name: "구글로 계속하기" })).toHaveAttribute("href", "/api/auth/oauth/google/start");
    expect(screen.getByRole("link", { name: "카카오로 계속하기" })).toHaveAttribute("href", "/api/auth/oauth/kakao/start");
    expect(screen.getByRole("link", { name: "네이버로 계속하기" })).toHaveAttribute("href", "/api/auth/oauth/naver/start");
  });
});
```

`src/features/auth/ConnectionsManager.test.tsx`:
```tsx
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { ConnectionsManager } from "./ConnectionsManager";
import ko from "@/i18n/messages/ko.json";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));

function renderIt(connected: string[]) {
  return render(
    <NextIntlClientProvider locale="ko" messages={ko}>
      <ConnectionsManager connected={connected} />
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) }));
});
afterEach(() => vi.unstubAllGlobals());

describe("ConnectionsManager", () => {
  it("shows connect vs disconnect per provider", () => {
    renderIt(["GOOGLE"]);
    // 구글은 연결됨 → 해제 버튼, 카카오/네이버는 연결 링크
    expect(screen.getByRole("button", { name: "연결 해제" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "카카오로 계속하기" })).toHaveAttribute("href", "/api/auth/oauth/kakao/start?link=1");
  });

  it("posts to the unlink endpoint on disconnect", async () => {
    const user = userEvent.setup();
    renderIt(["GOOGLE", "KAKAO"]);
    await user.click(screen.getAllByRole("button", { name: "연결 해제" })[0]);
    await waitFor(() => {
      const call = (globalThis.fetch as any).mock.calls[0];
      expect(String(call[0])).toBe("/api/auth/oauth/google/unlink");
      expect(call[1].method).toBe("POST");
    });
  });

  it("shows a catalog message when unlink is refused", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 409, json: async () => ({ code: "LAST_CREDENTIAL", message: "x" }) }));
    const user = userEvent.setup();
    renderIt(["GOOGLE"]);
    await user.click(screen.getByRole("button", { name: "연결 해제" }));
    expect(await screen.findByText("마지막 로그인 수단이라 해제할 수 없어요")).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: 실패 확인**

```bash
pnpm exec vitest run src/features/auth/SocialButtons.test.tsx src/features/auth/ConnectionsManager.test.tsx
```
Expected: FAIL — import 해결 실패

- [ ] **Step 4: SocialButtons 구현**

`src/features/auth/SocialButtons.tsx`:
```tsx
import { useTranslations } from "next-intl";

const PROVIDERS = ["google", "kakao", "naver"] as const;

// 서버 컴포넌트에서도 쓸 수 있게 순수 링크만. 폼이 아니라 top-level 네비게이션(GET)이라
// SameSite=Lax 쿠키가 정상 전송된다.
export function SocialButtons() {
  const t = useTranslations("auth.oauth");
  return (
    <div className="flex w-80 flex-col gap-2">
      {PROVIDERS.map((p) => (
        <a
          key={p}
          href={`/api/auth/oauth/${p}/start`}
          className="rounded border px-3 py-2 text-center"
        >
          {t(p)}
        </a>
      ))}
    </div>
  );
}
```

- [ ] **Step 5: ConnectionsManager 구현**

`src/features/auth/ConnectionsManager.tsx`:
```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";

const PROVIDERS = [
  { slug: "google", name: "GOOGLE" },
  { slug: "kakao", name: "KAKAO" },
  { slug: "naver", name: "NAVER" },
] as const;

const ERROR_KEYS: Record<string, string> = {
  LAST_CREDENTIAL: "lastCredential",
  IDENTITY_TAKEN: "identityTaken",
};

export function ConnectionsManager({ connected }: { connected: string[] }) {
  const t = useTranslations("auth.oauth");
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  async function unlink(slug: string) {
    setError(null);
    const res = await fetch(`/api/auth/oauth/${slug}/unlink`, { method: "POST" });
    if (!res.ok) {
      const body = await res.json().catch(() => ({ code: undefined }));
      return setError(t(ERROR_KEYS[body.code] ?? "failed"));
    }
    router.refresh();
  }

  return (
    <div className="flex w-80 flex-col gap-3">
      {PROVIDERS.map((p) => {
        const isConnected = connected.includes(p.name);
        return (
          <div key={p.slug} className="flex items-center justify-between rounded border px-3 py-2">
            <span>{t(p.slug)}</span>
            {isConnected ? (
              <button type="button" onClick={() => unlink(p.slug)} className="text-sm text-red-600">
                {t("unlink")}
              </button>
            ) : (
              <a href={`/api/auth/oauth/${p.slug}/start?link=1`} className="text-sm text-blue-600">
                {t("link")}
              </a>
            )}
          </div>
        );
      })}
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
    </div>
  );
}
```

- [ ] **Step 6: 연동 페이지 + 로그인/가입 버튼 삽입**

`src/app/settings/connections/page.tsx`:
```tsx
import { getTranslations } from "next-intl/server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { prisma } from "@/features/_shared/prisma";
import { currentUserFromRefresh } from "@/features/auth/session";
import { REFRESH_COOKIE } from "@/features/auth/cookies";
import { ConnectionsManager } from "@/features/auth/ConnectionsManager";

export default async function ConnectionsPage() {
  const t = await getTranslations("auth.oauth");
  const token = (await cookies()).get(REFRESH_COOKIE)?.value ?? null;
  const current = await currentUserFromRefresh(prisma, token);
  if (!current) redirect("/login?error=login_required");

  const identities = await prisma.authIdentity.findMany({
    where: { userId: current.userId },
    select: { provider: true },
  });

  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-6 py-12">
      <h1 className="text-2xl font-semibold">{t("connections")}</h1>
      <ConnectionsManager connected={identities.map((i) => i.provider)} />
    </main>
  );
}
```

`LoginForm.tsx`·`SignupForm.tsx`: `</form>` 다음에 구분선 + 소셜 버튼을 넣는다. 각 파일 반환 JSX의 폼 아래에 삽입:
```tsx
      <div className="flex w-80 items-center gap-2 text-sm text-zinc-400">
        <span className="h-px flex-1 bg-zinc-200" />
        {t("oauth.or")}
        <span className="h-px flex-1 bg-zinc-200" />
      </div>
      <SocialButtons />
```
그리고 각 파일 상단에 `import { SocialButtons } from "./SocialButtons";`. `useTranslations("auth")`가 이미 있으므로 `t("oauth.or")`로 접근(없으면 `useTranslations` 스코프를 `auth`로 확인). `SocialButtons`는 자체적으로 `useTranslations("auth.oauth")`를 쓰므로 부모 스코프와 무관.

> 주의: `SocialButtons`는 `use client` 없는 순수 컴포넌트지만 `useTranslations`(클라 훅)를 쓴다. `LoginForm`/`SignupForm`이 이미 `"use client"`라 그 안에서 렌더되면 문제없다. `SignupForm.tsx`/`LoginForm.tsx`가 클라 컴포넌트인지 확인하고, 그 트리 안에서만 사용.

- [ ] **Step 7: 통과 확인 + 빌드**

```bash
pnpm exec vitest run src/features/auth && pnpm exec tsc --noEmit && pnpm build
```
Expected: PASS, 타입 에러 없음, 빌드 성공

- [ ] **Step 8: 커밋**

```bash
git add src/i18n/messages src/features/auth/SocialButtons.tsx src/features/auth/SocialButtons.test.tsx src/features/auth/ConnectionsManager.tsx src/features/auth/ConnectionsManager.test.tsx src/app/settings src/features/auth/LoginForm.tsx src/features/auth/SignupForm.tsx
git commit -m "소셜 로그인 버튼과 연동 관리 페이지 추가"
```

---

### Task 6 🟢: E2E + 워크로그 + 준수 노트

**Files:**
- Create: `e2e/oauth.spec.ts`, `docs/worklog/2026-07-24-oauth-login.md`
- Modify: `docs/superpowers/specs/2026-07-18-auth-core-design.md`(열거 트레이드오프 한 줄 추가)

**Interfaces:**
- Consumes: Task 4·5의 라우트·페이지

- [ ] **Step 1: E2E 작성**

`e2e/oauth.spec.ts`:
```ts
import { test, expect } from "@playwright/test";

// 실 DB 필요: docker compose up -d db 후 실행. 목 provider라 실 네트워크 없음.
// mock_as로 실행마다 고유 신원 → 이전 실행 행과 충돌 없음.
const unique = () => `e2e${Date.now()}${Math.floor(Math.random() * 1000)}`;

test.use({ locale: "ko-KR" });

test("social signup → relogin same user → link second → unlink", async ({ page, context, request }) => {
  const alice = unique();

  // 1) 카카오로 소셜 가입 (start가 목 콜백으로 바로 되돌림)
  await page.goto(`/api/auth/oauth/kakao/start?mock_as=${alice}`);
  await expect(page).toHaveURL(/\/$/); // 콜백이 / 로 리다이렉트
  const afterSignup = await context.cookies();
  expect(afterSignup.find((c) => c.name === "refresh_token")).toBeTruthy();

  // access 취득 → /me 동작
  const me1 = await request.post("/api/auth/refresh");
  expect(me1.ok()).toBeTruthy();
  const { accessToken } = await me1.json();
  const meRes = await request.get("/api/auth/me", { headers: { authorization: `Bearer ${accessToken}` } });
  expect(meRes.ok()).toBeTruthy();

  // 2) 같은 mock_as로 재로그인 → 같은 유저(중복 생성 없음): 연동 페이지에 KAKAO 1개
  await page.goto("/settings/connections");
  await expect(page.getByText("카카오로 계속하기")).toBeVisible();
  await expect(page.getByRole("button", { name: "연결 해제" })).toHaveCount(1); // 카카오만 연결됨

  // 3) 네이버 연동 (로그인 상태 = refresh 쿠키)
  await page.goto(`/api/auth/oauth/naver/start?link=1&mock_as=${alice}`);
  await expect(page).toHaveURL(/settings\/connections/);
  await page.reload();
  await expect(page.getByRole("button", { name: "연결 해제" })).toHaveCount(2); // 카카오+네이버

  // 4) 네이버 해제 성공 (자격증명 2개라 마지막 아님)
  await page.getByRole("button", { name: "연결 해제" }).nth(1).click();
  await expect(page.getByRole("button", { name: "연결 해제" })).toHaveCount(1);
});

test("last-credential unlink is refused", async ({ page }) => {
  const bob = unique();
  await page.goto(`/api/auth/oauth/google/start?mock_as=${bob}`);
  await expect(page).toHaveURL(/\/$/);
  await page.goto("/settings/connections");
  await page.getByRole("button", { name: "연결 해제" }).click();
  await expect(page.getByRole("alert")).toHaveText("마지막 로그인 수단이라 해제할 수 없어요");
});

test("forged callback state is rejected", async ({ page }) => {
  // state 쿠키 없이 콜백 직접 호출 → 로그인 페이지로 에러 리다이렉트
  await page.goto("/api/auth/oauth/kakao/callback?code=x&state=forged");
  await expect(page).toHaveURL(/\/login\?error=oauth_failed/);
});

test("oauth email collision is not auto-linked", async ({ page, request }) => {
  const carol = unique();
  const email = `kakao.${carol}@example.com`; // 목 카카오가 만들 이메일과 동일
  // 먼저 로컬 가입으로 그 이메일 선점
  const reg = await request.post("/api/auth/register", {
    data: { email, phone: "010-1234-5678", nickname: carol.slice(0, 18), password: "hunter2hunter2", passwordConfirm: "hunter2hunter2", consent: true },
  });
  expect(reg.status()).toBe(201);
  // 같은 이메일로 카카오 OAuth → 자동 연동 안 하고 에러
  await page.goto(`/api/auth/oauth/kakao/start?mock_as=${carol}`);
  await expect(page).toHaveURL(/error=email_exists/);
});
```

- [ ] **Step 2: E2E 실행**

```bash
docker compose up -d db
pnpm exec prisma migrate deploy
pnpm test:e2e
```
Expected: 새 oauth 4개 + 기존 health 2 + auth 4 전부 PASS

- [ ] **Step 3: 전체 검증 + PII 점검**

```bash
pnpm exec tsc --noEmit && pnpm test && pnpm build
docker compose exec -T db psql -U app -d app -c 'SELECT "emailCiphertext","emailBlindIndex","passwordHash" FROM "User" WHERE "passwordHash" IS NULL LIMIT 3;'
grep -rn "console.log" src/features/auth/oauth src/app/api/auth/oauth
```
Expected: 타입·테스트·빌드 green. OAuth 유저는 `passwordHash` NULL + 이메일 암호문만(평문 없음). grep 출력 없음.

- [ ] **Step 4: 준수 노트 + 워크로그**

`docs/superpowers/specs/2026-07-18-auth-core-design.md`의 "알려진 갭 / 수용한 트레이드오프" 절에 한 줄 추가:
```markdown
- OAuth 이메일 충돌 시 `OAUTH_EMAIL_EXISTS` 안내는 계정 존재를 드러낸다(OAuth 플로우 본질 — 그 provider 이메일 통제 증명). 자동 연동을 막기 위한 의도적 노출. (ext-1)
```

`docs/worklog/2026-07-24-oauth-login.md` — `docs/worklog/2026-07-23-auth-core.md` 형식(무엇을/왜/결정/편차·이슈, 태스크별 표, 리뷰 지적·처리, DoD 8항 검증). 실제 진행 기반으로 작성.

- [ ] **Step 5: 커밋**

```bash
git add e2e/oauth.spec.ts docs/worklog/2026-07-24-oauth-login.md docs/superpowers/specs/2026-07-18-auth-core-design.md
git commit -m "OAuth E2E와 워크로그·준수 노트 추가"
```

---

## 완료 기준 (DoD) — 설계 문서와 동일

1. 목 3사로 소셜 가입 → passwordless User + AuthIdentity, refresh 쿠키, /me 동작 — Task 4·6
2. 소셜 재로그인 시 기존 User(중복 생성 없음) — Task 6 E2E
3. OAuth 이메일 충돌 시 자동 연동 안 함 — Task 3·6
4. 연동/해제 동작, 마지막 자격증명 해제 거부 — Task 3·5·6
5. state 위조·불일치 콜백 거부 — Task 2·4·6
6. GOOGLE_* 있으면 실제 Google(수동), 없으면 목으로 전 기능·테스트 — Task 1
7. 로그·감사·응답·리다이렉트에 평문 이메일 없음, 전체 테스트 통과 — Task 6
8. 소셜 버튼·연동 페이지 한/영 동작 — Task 5·6

## 범위 밖 (건드리지 말 것)

- 2FA(TOTP·이메일 OTP) 설정·강제, 민감작업 재인증 → ext-2
- 로컬 비번 나중에 추가("비밀번호 설정") → 1c
- 프로필·마이페이지·탈퇴 → 1c
- RBAC 강제 → #2
