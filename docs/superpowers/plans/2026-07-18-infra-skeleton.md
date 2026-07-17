# 인프라 + 뼈대 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Docker로 뜨는 Next.js + Postgres + socket.io 뼈대와, 이후 모든 기능이 재사용할 공용 에러/환경/DB/i18n/테스트 기반을 구축한다.

**Architecture:** 기능 중심 폴더 구조(`src/features/*`, 지금은 `_shared`만 내용 있음). web/db/ws 3개 컨테이너를 Docker Compose로 오케스트레이션. 헬스 슬라이스(`/api/health` + WS ping/pong + 헬스 페이지)로 전체 배선을 end-to-end 증명. 비즈니스 로직 없음.

**Tech Stack:** Next.js 16 (App Router), TypeScript, Tailwind, shadcn/ui, next-intl 4, Prisma 7 + PostgreSQL 16, socket.io 4, Vitest 4 + React Testing Library, Playwright.

## Global Constraints

- Node 22, pnpm (패키지 매니저)
- Next.js 16.x (App Router), TypeScript strict
- Prisma 7.x, PostgreSQL 16
- socket.io 4.x, WS는 독립 컨테이너
- next-intl 4.x: 한글/영어. 기본 언어 = 브라우저 로케일, 사용자 전환 가능. 하드코딩 문자열 금지 → 메시지 카탈로그(ko/en). 한글은 평어체(~요).
- 위치: `lat`/`lng` Float 저장(PostGIS 미사용). #0에서는 컬럼만, haversine 쿼리는 #3.
- 클라이언트 에러 응답은 항상 `{ code: string, message: string }`만. prod에서 스택/DB 내부구조 노출 금지, 서버 로그에만 상세.
- 커밋 메시지: 짧고 간결, 한글. Co-Authored-By 금지. 이슈번호 단독 금지.
- PostGIS/실제 JWT/암호화/상품/채팅/에스크로/지오코딩/Octomo 는 #0 범위 밖.

---

### Task 1: 프로젝트 초기화 + 툴체인

**Files:**
- Create: `package.json`, `tsconfig.json`, `next.config.ts`, `.nvmrc`
- Create: `vitest.config.ts`, `vitest.setup.ts`, `playwright.config.ts`
- Create: `src/app/layout.tsx`, `src/app/page.tsx`
- Create: `tailwind` 설정 (Next 16 방식), `postcss.config.mjs`, `src/app/globals.css`
- Test: `src/__smoke__/smoke.test.ts`

**Interfaces:**
- Produces: 실행 가능한 `pnpm dev`, `pnpm build`, `pnpm test`(Vitest), `pnpm test:e2e`(Playwright) 스크립트. 이후 모든 태스크가 이 스크립트 위에서 동작.

- [ ] **Step 1: 프로젝트 스캐폴딩**

```bash
pnpm dlx create-next-app@16 . --ts --tailwind --app --src-dir --import-alias "@/*" --no-eslint --use-pnpm --yes
```
`.nvmrc`에 `22` 기록. `package.json`의 `packageManager` 필드 pnpm 확인.

- [ ] **Step 2: 테스트 도구 설치**

```bash
pnpm add -D vitest@4 @vitest/coverage-v8 jsdom @testing-library/react @testing-library/jest-dom @testing-library/user-event @playwright/test
pnpm exec playwright install --with-deps chromium
```

- [ ] **Step 3: Vitest 설정 작성**

`vitest.config.ts`:
```ts
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
    globals: true,
    include: ["src/**/*.test.{ts,tsx}"],
    exclude: ["e2e/**", "node_modules/**"],
  },
  resolve: { alias: { "@": resolve(__dirname, "src") } },
});
```
`vitest.setup.ts`:
```ts
import "@testing-library/jest-dom/vitest";
```
`pnpm add -D @vitejs/plugin-react`.

- [ ] **Step 4: Playwright 설정 작성**

`playwright.config.ts`:
```ts
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  use: { baseURL: "http://localhost:3000" },
  webServer: {
    command: "pnpm dev",
    url: "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
```

- [ ] **Step 5: package.json 스크립트 추가**

`package.json` scripts에 병합:
```json
{
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:e2e": "playwright test"
  }
}
```

- [ ] **Step 6: 스모크 테스트 작성**

`src/__smoke__/smoke.test.ts`:
```ts
import { describe, it, expect } from "vitest";

describe("toolchain", () => {
  it("runs vitest", () => {
    expect(1 + 1).toBe(2);
  });
});
```

- [ ] **Step 7: 테스트 실행 확인**

Run: `pnpm test`
Expected: PASS (1 test)

- [ ] **Step 8: 커밋**

```bash
git add -A
git commit -m "프로젝트 초기화 및 테스트 툴체인 구성"
```

---

### Task 2: 공용 환경변수 검증 (`_shared/env.ts`)

**Files:**
- Create: `src/features/_shared/env.ts`
- Test: `src/features/_shared/env.test.ts`
- Create: `.env.example`

**Interfaces:**
- Produces: `getEnv(): Env` — 검증된 환경변수 객체. 필드: `DATABASE_URL: string`, `JWT_ACCESS_SECRET: string`, `JWT_REFRESH_SECRET: string`, `AES_KEY: string`, `WS_PORT: number`, `NODE_ENV: "development"|"production"|"test"`. 누락 시 throw. 이후 prisma/ws/에러래퍼가 소비.

- [ ] **Step 1: 실패 테스트 작성**

`src/features/_shared/env.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { parseEnv } from "./env";

const valid = {
  DATABASE_URL: "postgresql://u:p@db:5432/app",
  JWT_ACCESS_SECRET: "a".repeat(32),
  JWT_REFRESH_SECRET: "b".repeat(32),
  AES_KEY: "c".repeat(32),
  WS_PORT: "4000",
  NODE_ENV: "test",
};

describe("parseEnv", () => {
  it("parses valid env and coerces WS_PORT to number", () => {
    const env = parseEnv(valid);
    expect(env.WS_PORT).toBe(4000);
    expect(env.DATABASE_URL).toContain("postgresql://");
  });

  it("throws when a required var is missing", () => {
    const { DATABASE_URL, ...rest } = valid;
    expect(() => parseEnv(rest)).toThrow();
  });

  it("throws when AES_KEY is not 32 chars", () => {
    expect(() => parseEnv({ ...valid, AES_KEY: "short" })).toThrow();
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm test src/features/_shared/env.test.ts`
Expected: FAIL ("Failed to resolve import ./env")

- [ ] **Step 3: 구현**

`pnpm add zod`. `src/features/_shared/env.ts`:
```ts
import { z } from "zod";

const schema = z.object({
  DATABASE_URL: z.string().url().or(z.string().startsWith("postgresql://")),
  JWT_ACCESS_SECRET: z.string().min(16),
  JWT_REFRESH_SECRET: z.string().min(16),
  AES_KEY: z.string().length(32),
  WS_PORT: z.coerce.number().int().positive(),
  NODE_ENV: z.enum(["development", "production", "test"]),
});

export type Env = z.infer<typeof schema>;

export function parseEnv(raw: NodeJS.ProcessEnv | Record<string, unknown>): Env {
  const result = schema.safeParse(raw);
  if (!result.success) {
    throw new Error("환경변수 검증 실패: " + result.error.issues.map((i) => i.path.join(".")).join(", "));
  }
  return result.data;
}

let cached: Env | null = null;
export function getEnv(): Env {
  if (!cached) cached = parseEnv(process.env);
  return cached;
}
```

- [ ] **Step 4: 통과 확인**

Run: `pnpm test src/features/_shared/env.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: .env.example 작성**

`.env.example`:
```
DATABASE_URL=postgresql://app:app@localhost:5432/app
JWT_ACCESS_SECRET=change_me_at_least_16_chars_long
JWT_REFRESH_SECRET=change_me_at_least_16_chars_long
AES_KEY=0123456789abcdef0123456789abcdef
WS_PORT=4000
NODE_ENV=development
```

- [ ] **Step 6: 커밋**

```bash
git add -A
git commit -m "환경변수 zod 검증 모듈 추가"
```

---

### Task 3: 공용 에러 포맷 + 라우트 래퍼 (`_shared/error.ts`)

**Files:**
- Create: `src/features/_shared/error.ts`
- Test: `src/features/_shared/error.test.ts`

**Interfaces:**
- Consumes: `getEnv()` (NODE_ENV로 마스킹 여부 결정)
- Produces:
  - `class AppError extends Error { code: string; httpStatus: number; constructor(code, message, httpStatus?) }`
  - `toClientError(err: unknown, isProd: boolean): { body: { code: string; message: string }; status: number }`
  - `withErrorHandling(handler): handler` — Next Route Handler를 감싸 예외를 안전 응답으로 변환. 이후 모든 API 라우트가 사용.

- [ ] **Step 1: 실패 테스트 작성**

`src/features/_shared/error.test.ts`:
```ts
import { describe, it, expect, vi } from "vitest";
import { AppError, toClientError } from "./error";

describe("toClientError", () => {
  it("passes through AppError code and message", () => {
    const { body, status } = toClientError(new AppError("NOT_FOUND", "찾을 수 없어요", 404), true);
    expect(body).toEqual({ code: "NOT_FOUND", message: "찾을 수 없어요" });
    expect(status).toBe(404);
  });

  it("masks unknown errors in prod (no internal detail)", () => {
    const { body, status } = toClientError(new Error("DB stack trace: table users column secret"), true);
    expect(status).toBe(500);
    expect(body.code).toBe("INTERNAL");
    expect(body.message).not.toContain("stack");
    expect(body.message).not.toContain("users");
  });

  it("does not leak raw message even in dev body", () => {
    const { body } = toClientError(new Error("raw internal"), false);
    // dev도 클라이언트 바디엔 raw 미포함 (로그로만)
    expect(body.message).not.toContain("raw internal");
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm test src/features/_shared/error.test.ts`
Expected: FAIL (import 실패)

- [ ] **Step 3: 구현**

`src/features/_shared/error.ts`:
```ts
export class AppError extends Error {
  constructor(
    public code: string,
    message: string,
    public httpStatus: number = 400,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export interface ClientError {
  body: { code: string; message: string };
  status: number;
}

export function toClientError(err: unknown, _isProd: boolean): ClientError {
  if (err instanceof AppError) {
    return { body: { code: err.code, message: err.message }, status: err.httpStatus };
  }
  // 알 수 없는 에러: 내부 정보 절대 노출 금지, 서버 로그에만 상세
  console.error("[UNHANDLED]", err);
  return {
    body: { code: "INTERNAL", message: "문제가 생겼어요. 잠시 후 다시 시도해 주세요." },
    status: 500,
  };
}

type RouteHandler = (req: Request, ctx?: unknown) => Promise<Response> | Response;

export function withErrorHandling(handler: RouteHandler): RouteHandler {
  return async (req, ctx) => {
    try {
      return await handler(req, ctx);
    } catch (err) {
      const { body, status } = toClientError(err, process.env.NODE_ENV === "production");
      return Response.json(body, { status });
    }
  };
}
```

- [ ] **Step 4: 통과 확인**

Run: `pnpm test src/features/_shared/error.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: 커밋**

```bash
git add -A
git commit -m "공용 에러 포맷 및 라우트 래퍼 추가"
```

---

### Task 4: Prisma User 스텁 모델 + 클라이언트 싱글톤

**Files:**
- Create: `prisma/schema.prisma`
- Create: `src/features/_shared/prisma.ts`
- Test: `src/features/_shared/prisma.test.ts`

**Interfaces:**
- Consumes: `DATABASE_URL`
- Produces: `prisma` — PrismaClient 싱글톤 (핫리로드 안전). `User` 모델(id, email, lat, lng, createdAt). 이후 모든 DB 접근이 이 클라이언트 사용.

- [ ] **Step 1: Prisma 설치 + 스키마 작성**

```bash
pnpm add -D prisma@7
pnpm add @prisma/client@7
```
`prisma/schema.prisma`:
```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model User {
  id        String   @id @default(cuid())
  email     String   @unique
  lat       Float?
  lng       Float?
  createdAt DateTime @default(now())
}
```

- [ ] **Step 2: 싱글톤 구현**

`src/features/_shared/prisma.ts`:
```ts
import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
```

- [ ] **Step 3: 싱글톤 테스트 작성**

`src/features/_shared/prisma.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { prisma } from "./prisma";

describe("prisma singleton", () => {
  it("exposes a client with User model", () => {
    expect(prisma).toBeDefined();
    expect(prisma.user).toBeDefined();
  });
});
```

- [ ] **Step 4: 클라이언트 생성 + 테스트**

```bash
pnpm exec prisma generate
pnpm test src/features/_shared/prisma.test.ts
```
Expected: PASS (1 test). (실제 DB 연결 없이 클라이언트 형태만 검증)

- [ ] **Step 5: 커밋**

```bash
git add -A
git commit -m "Prisma User 스텁 모델 및 클라이언트 싱글톤 추가"
```

---

### Task 5: `/api/health` 라우트

**Files:**
- Create: `src/features/_shared/health.ts`
- Create: `src/app/api/health/route.ts`
- Test: `src/features/_shared/health.test.ts`

**Interfaces:**
- Consumes: `prisma`, `withErrorHandling`
- Produces: `checkHealth(db: { queryRaw }): Promise<{ status: "ok"; db: boolean; ts: string }>` — DB `SELECT 1` 확인. 라우트는 `withErrorHandling`으로 감싼 `GET`.

- [ ] **Step 1: 실패 테스트 작성**

`src/features/_shared/health.test.ts`:
```ts
import { describe, it, expect, vi } from "vitest";
import { checkHealth } from "./health";

describe("checkHealth", () => {
  it("returns ok when db query succeeds", async () => {
    const db = { $queryRaw: vi.fn().mockResolvedValue([{ "?column?": 1 }]) };
    const res = await checkHealth(db as any);
    expect(res.status).toBe("ok");
    expect(res.db).toBe(true);
    expect(typeof res.ts).toBe("string");
  });

  it("reports db false when query throws", async () => {
    const db = { $queryRaw: vi.fn().mockRejectedValue(new Error("down")) };
    const res = await checkHealth(db as any);
    expect(res.db).toBe(false);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm test src/features/_shared/health.test.ts`
Expected: FAIL (import 실패)

- [ ] **Step 3: 구현**

`src/features/_shared/health.ts`:
```ts
import type { PrismaClient } from "@prisma/client";

export interface HealthResult {
  status: "ok";
  db: boolean;
  ts: string;
}

export async function checkHealth(
  db: Pick<PrismaClient, "$queryRaw">,
): Promise<HealthResult> {
  let dbOk = false;
  try {
    await db.$queryRaw`SELECT 1`;
    dbOk = true;
  } catch {
    dbOk = false;
  }
  return { status: "ok", db: dbOk, ts: new Date().toISOString() };
}
```

- [ ] **Step 4: 라우트 작성**

`src/app/api/health/route.ts`:
```ts
import { prisma } from "@/features/_shared/prisma";
import { checkHealth } from "@/features/_shared/health";
import { withErrorHandling } from "@/features/_shared/error";

export const GET = withErrorHandling(async () => {
  const result = await checkHealth(prisma);
  return Response.json(result);
});
```

- [ ] **Step 5: 통과 확인**

Run: `pnpm test src/features/_shared/health.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 6: 커밋**

```bash
git add -A
git commit -m "헬스체크 로직 및 /api/health 라우트 추가"
```

---

### Task 6: next-intl 다국어 + 헬스 페이지 UI

**Files:**
- Create: `src/i18n/messages/ko.json`, `src/i18n/messages/en.json`
- Create: `src/i18n/request.ts`, `src/i18n/routing.ts`
- Modify: `next.config.ts` (next-intl 플러그인)
- Create: `src/features/health/HealthStatus.tsx`, `src/features/health/LocaleToggle.tsx`
- Modify: `src/app/layout.tsx`, `src/app/page.tsx`
- Test: `src/features/health/HealthStatus.test.tsx`

**Interfaces:**
- Consumes: `/api/health` 응답 형태 `{ status, db, ts }`
- Produces: `HealthStatus` 컴포넌트 — props `{ db: boolean }`, `db` true면 "잘 돌아가고 있어요"(ko)/"All good"(en), false면 문제 메시지. 메시지는 next-intl 카탈로그에서.

- [ ] **Step 1: next-intl 설치 + 메시지 카탈로그**

```bash
pnpm add next-intl@4
```
`src/i18n/messages/ko.json`:
```json
{ "health": { "ok": "잘 돌아가고 있어요", "bad": "연결에 문제가 있어요", "title": "서버 상태" } }
```
`src/i18n/messages/en.json`:
```json
{ "health": { "ok": "All good", "bad": "Something's wrong", "title": "Server status" } }
```

- [ ] **Step 2: next-intl 설정**

`src/i18n/routing.ts`:
```ts
import { defineRouting } from "next-intl/routing";

export const routing = defineRouting({
  locales: ["ko", "en"],
  defaultLocale: "ko",
  localeDetection: true, // 브라우저 로케일 기준 초기 언어
});
```
`src/i18n/request.ts`:
```ts
import { getRequestConfig } from "next-intl/server";
import { routing } from "./routing";

export default getRequestConfig(async ({ requestLocale }) => {
  let locale = await requestLocale;
  if (!locale || !routing.locales.includes(locale as "ko" | "en")) {
    locale = routing.defaultLocale;
  }
  return { locale, messages: (await import(`./messages/${locale}.json`)).default };
});
```
`next.config.ts`에 플러그인 래핑:
```ts
import createNextIntlPlugin from "next-intl/plugin";
const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");
export default withNextIntl({});
```

- [ ] **Step 3: 실패 테스트 작성**

`src/features/health/HealthStatus.test.tsx`:
```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { HealthStatus } from "./HealthStatus";
import ko from "@/i18n/messages/ko.json";

function renderWithIntl(ui: React.ReactNode) {
  return render(
    <NextIntlClientProvider locale="ko" messages={ko}>{ui}</NextIntlClientProvider>,
  );
}

describe("HealthStatus", () => {
  it("shows ok message in Korean when db is up", () => {
    renderWithIntl(<HealthStatus db={true} />);
    expect(screen.getByText("잘 돌아가고 있어요")).toBeInTheDocument();
  });

  it("shows bad message when db is down", () => {
    renderWithIntl(<HealthStatus db={false} />);
    expect(screen.getByText("연결에 문제가 있어요")).toBeInTheDocument();
  });
});
```

- [ ] **Step 4: 실패 확인**

Run: `pnpm test src/features/health/HealthStatus.test.tsx`
Expected: FAIL (import 실패)

- [ ] **Step 5: 컴포넌트 구현**

`src/features/health/HealthStatus.tsx`:
```tsx
"use client";
import { useTranslations } from "next-intl";

export function HealthStatus({ db }: { db: boolean }) {
  const t = useTranslations("health");
  return <p role="status">{db ? t("ok") : t("bad")}</p>;
}
```
`src/features/health/LocaleToggle.tsx` (쿠키 기반 전환):
```tsx
"use client";
import { useRouter } from "next/navigation";

export function LocaleToggle() {
  const router = useRouter();
  const set = (locale: "ko" | "en") => {
    document.cookie = `NEXT_LOCALE=${locale}; path=/; max-age=31536000`;
    router.refresh();
  };
  return (
    <div>
      <button onClick={() => set("ko")}>한국어</button>
      <button onClick={() => set("en")}>English</button>
    </div>
  );
}
```

- [ ] **Step 6: layout/page 배선**

`src/app/layout.tsx` (NextIntlClientProvider 래핑):
```tsx
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages } from "next-intl/server";
import "./globals.css";

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale();
  const messages = await getMessages();
  return (
    <html lang={locale}>
      <body>
        <NextIntlClientProvider locale={locale} messages={messages}>
          {children}
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
```
`src/app/page.tsx`:
```tsx
import { getTranslations } from "next-intl/server";
import { prisma } from "@/features/_shared/prisma";
import { checkHealth } from "@/features/_shared/health";
import { HealthStatus } from "@/features/health/HealthStatus";
import { LocaleToggle } from "@/features/health/LocaleToggle";

export default async function Home() {
  const t = await getTranslations("health");
  const health = await checkHealth(prisma).catch(() => ({ db: false }));
  return (
    <main>
      <h1>{t("title")}</h1>
      <HealthStatus db={health.db} />
      <LocaleToggle />
    </main>
  );
}
```

- [ ] **Step 7: 통과 확인**

Run: `pnpm test src/features/health/HealthStatus.test.tsx`
Expected: PASS (2 tests)

- [ ] **Step 8: 커밋**

```bash
git add -A
git commit -m "next-intl 다국어 및 헬스 상태 페이지 추가"
```

---

### Task 7: socket.io WS 서버 (독립 컨테이너 엔트리)

**Files:**
- Create: `src/server/ws/index.ts`
- Create: `src/server/ws/auth-stub.ts`
- Test: `src/server/ws/auth-stub.test.ts`, `src/server/ws/server.test.ts`

**Interfaces:**
- Consumes: `getEnv()` (WS_PORT)
- Produces:
  - `verifyTokenStub(token?: string): { userId: string | null }` — 지금은 아무 토큰이나 통과(#1에서 실제 JWT 검증으로 교체). 토큰 없으면 `userId: null`.
  - `createWsServer(): { io, listen(port), close() }` — `ping` 이벤트 수신 시 `pong` emit.

- [ ] **Step 1: 인증 스텁 실패 테스트**

`src/server/ws/auth-stub.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { verifyTokenStub } from "./auth-stub";

describe("verifyTokenStub", () => {
  it("returns a userId for any non-empty token (stub)", () => {
    expect(verifyTokenStub("anything").userId).not.toBeNull();
  });
  it("returns null userId when token absent", () => {
    expect(verifyTokenStub(undefined).userId).toBeNull();
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm test src/server/ws/auth-stub.test.ts`
Expected: FAIL (import 실패)

- [ ] **Step 3: 인증 스텁 구현**

`src/server/ws/auth-stub.ts`:
```ts
// #0 스텁: 실제 JWT 검증은 #1에서 교체.
export function verifyTokenStub(token?: string): { userId: string | null } {
  if (!token) return { userId: null };
  return { userId: "stub-user" };
}
```

- [ ] **Step 4: 통과 확인**

Run: `pnpm test src/server/ws/auth-stub.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: WS 서버 실패 테스트 (ping/pong 왕복)**

`pnpm add socket.io@4` / `pnpm add -D socket.io-client@4`.
`src/server/ws/server.test.ts`:
```ts
import { describe, it, expect, afterEach } from "vitest";
import { io as Client, type Socket } from "socket.io-client";
import { createWsServer } from "./index";

let server: ReturnType<typeof createWsServer> | null = null;
let client: Socket | null = null;

afterEach(() => {
  client?.close();
  server?.close();
});

describe("ws server", () => {
  it("responds pong to ping", async () => {
    server = createWsServer();
    const port = 45123;
    await server.listen(port);
    client = Client(`http://localhost:${port}`, { transports: ["websocket"] });
    const pong = await new Promise<string>((resolve) => {
      client!.on("pong", (msg: string) => resolve(msg));
      client!.on("connect", () => client!.emit("ping"));
    });
    expect(pong).toBe("pong");
  });
});
```

- [ ] **Step 6: 실패 확인**

Run: `pnpm test src/server/ws/server.test.ts`
Expected: FAIL (import 실패)

- [ ] **Step 7: WS 서버 구현**

`src/server/ws/index.ts`:
```ts
import { Server } from "socket.io";
import { createServer, type Server as HttpServer } from "node:http";
import { verifyTokenStub } from "./auth-stub";

export function createWsServer() {
  const http: HttpServer = createServer();
  const io = new Server(http, { cors: { origin: "*" } });

  io.use((socket, next) => {
    const { userId } = verifyTokenStub(socket.handshake.auth?.token);
    (socket.data as { userId: string | null }).userId = userId; // #1에서 미인증 거부로 강화
    next();
  });

  io.on("connection", (socket) => {
    socket.on("ping", () => socket.emit("pong", "pong"));
  });

  return {
    io,
    listen: (port: number) =>
      new Promise<void>((resolve) => http.listen(port, resolve)),
    close: () => {
      io.close();
      http.close();
    },
  };
}

// 컨테이너 엔트리: 직접 실행 시 기동
if (process.env.WS_STANDALONE === "1") {
  const port = Number(process.env.WS_PORT ?? 4000);
  createWsServer()
    .listen(port)
    .then(() => console.log(`[ws] listening on ${port}`));
}
```

- [ ] **Step 8: 통과 확인**

Run: `pnpm test src/server/ws/server.test.ts`
Expected: PASS (1 test)

- [ ] **Step 9: 커밋**

```bash
git add -A
git commit -m "socket.io WS 서버 및 ping/pong, 인증 스텁 추가"
```

---

### Task 8: Docker Compose + Dockerfile + E2E

**Files:**
- Create: `docker-compose.yml`
- Create: `Dockerfile` (web), `Dockerfile.ws`
- Create: `.dockerignore`
- Modify: `next.config.ts` (`output: "standalone"`)
- Create: `e2e/health.spec.ts`
- Create: `scripts/ws-entry.mjs` (또는 tsx 실행)

**Interfaces:**
- Consumes: 앞 태스크 전부 (web 이미지가 Next 앱, ws 이미지가 `createWsServer`)
- Produces: `docker compose up`으로 db/web/ws 3컨테이너 기동. 완료 기준 전체 충족.

- [ ] **Step 1: next standalone 출력 설정**

`next.config.ts`의 next-intl 래핑 대상 객체에 `output: "standalone"` 추가.

- [ ] **Step 2: web Dockerfile**

`Dockerfile`:
```dockerfile
FROM node:22-alpine AS base
RUN corepack enable
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN pnpm exec prisma generate && pnpm build

FROM base AS run
ENV NODE_ENV=production
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
EXPOSE 3000
CMD ["node", "server.js"]
```

- [ ] **Step 3: ws Dockerfile**

WS는 tsx로 TS 엔트리 직접 실행. `pnpm add -D tsx`.
`Dockerfile.ws`:
```dockerfile
FROM node:22-alpine
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm exec prisma generate
ENV WS_STANDALONE=1
EXPOSE 4000
CMD ["pnpm", "exec", "tsx", "src/server/ws/index.ts"]
```

- [ ] **Step 4: docker-compose.yml**

```yaml
services:
  db:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: app
      POSTGRES_PASSWORD: app
      POSTGRES_DB: app
    volumes:
      - pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U app"]
      interval: 5s
      timeout: 3s
      retries: 10

  web:
    build: { context: ., dockerfile: Dockerfile }
    env_file: .env
    environment:
      DATABASE_URL: postgresql://app:app@db:5432/app
    ports: ["3000:3000"]
    volumes:
      - media:/app/media
    depends_on:
      db: { condition: service_healthy }

  ws:
    build: { context: ., dockerfile: Dockerfile.ws }
    env_file: .env
    environment:
      DATABASE_URL: postgresql://app:app@db:5432/app
      WS_PORT: 4000
    ports: ["4000:4000"]
    volumes:
      - media:/app/media
    depends_on:
      db: { condition: service_healthy }

volumes:
  pgdata:
  media:
```
`.dockerignore`: `node_modules`, `.next`, `.git`, `e2e`.

- [ ] **Step 5: DB 마이그레이션 적용**

```bash
cp .env.example .env
docker compose up -d db
pnpm exec prisma migrate dev --name init
```
Expected: `User` 테이블 생성 마이그레이션 파일 생성.

- [ ] **Step 6: E2E 테스트 작성**

`e2e/health.spec.ts`:
```ts
import { test, expect } from "@playwright/test";

test("health page shows Korean status and toggles to English", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading")).toBeVisible();
  await expect(page.getByRole("status")).toBeVisible();
  await page.getByRole("button", { name: "English" }).click();
  await expect(page.getByRole("heading", { name: "Server status" })).toBeVisible();
});

test("api health returns ok json", async ({ request }) => {
  const res = await request.get("/api/health");
  expect(res.ok()).toBeTruthy();
  const body = await res.json();
  expect(body.status).toBe("ok");
});
```

- [ ] **Step 7: E2E 실행**

```bash
docker compose up -d db
pnpm exec prisma migrate deploy
pnpm test:e2e
```
Expected: PASS (2 tests). db down이면 `/api/health`는 `db:false`지만 `status:"ok"` 유지.

- [ ] **Step 8: 전체 스택 기동 검증**

```bash
docker compose up --build -d
docker compose ps        # web/db/ws 모두 healthy/up
curl localhost:3000/api/health   # {"status":"ok","db":true,...}
```
WS ping/pong은 Task 7 단위테스트로 이미 검증됨.

- [ ] **Step 9: 커밋**

```bash
git add -A
git commit -m "Docker Compose 3컨테이너 구성 및 헬스 E2E 추가"
```

---

## Self-Review

**Spec coverage:**
- A 컨테이너 구성 → Task 8 ✓
- B 폴더 구조 → Task 1(스캐폴딩) + 이후 features/_shared, server/ws 경로 준수 ✓
- C 헬스 슬라이스 → Task 4(User)+5(api)+6(UI)+7(WS ping/pong) ✓
- D 공용 인프라 → Task 2(env)+3(error)+4(prisma)+1(테스트 셋업) ✓
- E YAGNI 제외 항목 → 계획에 없음(준수) ✓
- 완료기준 1~8 → Task 8 검증 스텝 + 각 태스크 테스트로 커버 ✓
- i18n(한/영, 브라우저기본, 전환) → Task 6 ✓

**Placeholder scan:** 실제 코드/명령 모두 기재, TBD 없음 ✓

**Type consistency:** `checkHealth(prisma)` 반환 `{status, db, ts}` — Task 5 정의, Task 6 page.tsx 소비 일치. `verifyTokenStub` 시그니처 Task 7 내부 일치. `withErrorHandling` Task 3 정의, Task 5 사용 일치 ✓

**주의점(구현자):** create-next-app 최신 대화형 프롬프트가 플래그와 다를 수 있음 → 비대화형 실패 시 수동 스캐폴딩. Next 16 tailwind 설정 방식 확인. prisma 7 generate output 경로 확인.
