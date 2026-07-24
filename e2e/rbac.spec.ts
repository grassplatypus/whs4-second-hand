import { test, expect } from "@playwright/test";
import { execFileSync } from "node:child_process";

// 실 DB 필요: docker compose up -d db 후 실행.
const unique = () => `e2e${Date.now().toString(36)}${Math.floor(Math.random() * 1000)}`;
const PASSWORD = "hunter2hunter2";
const PHONE = "010-1234-5678"; // e2e/auth.spec.ts류와 동일 — register가 전화번호 유일성을 강제하지 않는다.

// e2e/auth.spec.ts·profile.spec.ts와 동일 사유: Chromium 기본 Accept-Language가 en-US라
// 쿠키 없는 첫 방문에서 한국어 폴백이 깨진다 — locale을 ko-KR로 고정.
test.use({ locale: "ko-KR" });

async function registerAndLogin(
  request: import("@playwright/test").APIRequestContext,
  id: string,
): Promise<{ email: string }> {
  const email = `${id}@example.com`;
  const reg = await request.post("/api/auth/register", {
    data: {
      email,
      phone: PHONE,
      nickname: id,
      password: PASSWORD,
      passwordConfirm: PASSWORD,
      consent: true,
    },
  });
  expect(reg.status()).toBe(201);

  const login = await request.post("/api/auth/login", { data: { email, password: PASSWORD } });
  expect(login.ok()).toBeTruthy();
  return { email };
}

// 관리자 API로 role을 바꿀 방법이 아직 없다(#6 범위) — 이번 태스크가 만든 유일한 유저(unique
// nickname)에 한해 로컬 db 컨테이너에 직접 psql UPDATE를 건다. -T로 tty 할당을 끄고, 값은
// unique()가 만드는 영숫자 닉네임뿐이라 별도 이스케이프 없이도 안전하다.
function setRole(nickname: string, role: "SUSPENDED" | "ADMIN"): void {
  execFileSync(
    "docker",
    ["compose", "exec", "-T", "db", "psql", "-U", "app", "-d", "app", "-c", `UPDATE "User" SET role='${role}' WHERE nickname='${nickname}'`],
    { stdio: "pipe" },
  );
}

test("GUEST(세션 없음): 보호 라우트는 전부 401 UNAUTHENTICATED", async ({ request }) => {
  const ping = await request.get("/api/admin/ping");
  expect(ping.status()).toBe(401);
  expect((await ping.json()).code).toBe("UNAUTHENTICATED");

  const bio = await request.patch("/api/profile/bio", { data: { bio: "hi" } });
  expect(bio.status()).toBe(401);
  expect((await bio.json()).code).toBe("UNAUTHENTICATED");
});

test("일반 USER: admin/ping은 403 FORBIDDEN, 일반 mutating 라우트(bio)는 200", async ({ context }) => {
  const id = unique();
  await registerAndLogin(context.request, id);

  const ping = await context.request.get("/api/admin/ping");
  expect(ping.status()).toBe(403);
  expect((await ping.json()).code).toBe("FORBIDDEN");

  const bio = await context.request.patch("/api/profile/bio", { data: { bio: "안녕하세요" } });
  expect(bio.status()).toBe(200);
  expect((await bio.json()).ok).toBe(true);
});

test("SUSPENDED(psql UPDATE): 같은 세션이 실시간으로 403 차단되고, refresh·재로그인도 403", async ({ context }) => {
  const id = unique();
  const { email } = await registerAndLogin(context.request, id);

  // 정지 전: 정상 유저로서 한 번 통과함을 먼저 확인해 둔다(이후 403이 "정지 때문"임을 대비).
  const beforeSuspend = await context.request.patch("/api/profile/bio", { data: { bio: "정지 전" } });
  expect(beforeSuspend.status()).toBe(200);

  setRole(id, "SUSPENDED");

  // 세션 쿠키는 그대로다(로그아웃하지 않았다) — 그런데도 DB-fresh role 조회가 즉시 막아야 한다.
  const bioAfterSuspend = await context.request.patch("/api/profile/bio", { data: { bio: "정지 후" } });
  expect(bioAfterSuspend.status()).toBe(403);
  expect((await bioAfterSuspend.json()).code).toBe("ACCOUNT_SUSPENDED");

  // refresh(토큰 회전)도 거부되고, 이 호출이 그 세션 자체를 폐기한다(재사용 여지 제거).
  const refresh = await context.request.post("/api/auth/refresh");
  expect(refresh.status()).toBe(403);
  expect((await refresh.json()).code).toBe("ACCOUNT_SUSPENDED");

  // 재로그인 시도(이메일+비번은 여전히 맞음)도 계정 정지로 거부된다 — 존재하지 않는 계정과
  // 구분되지 않는 AUTH_FAILED가 아니라, 인증 자체는 통과한 뒤의 명시적 ACCOUNT_SUSPENDED.
  const relogin = await context.request.post("/api/auth/login", { data: { email, password: PASSWORD } });
  expect(relogin.status()).toBe(403);
  expect((await relogin.json()).code).toBe("ACCOUNT_SUSPENDED");
});

test("ADMIN(psql UPDATE): admin/ping이 200을 돌려준다", async ({ context }) => {
  const id = unique();
  await registerAndLogin(context.request, id);

  setRole(id, "ADMIN");

  const ping = await context.request.get("/api/admin/ping");
  expect(ping.ok()).toBeTruthy();
  expect(await ping.json()).toEqual({ ok: true, role: "ADMIN" });
});
