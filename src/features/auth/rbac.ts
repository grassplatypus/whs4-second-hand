import { AppError } from "@/features/_shared/error";
import { currentUserFromRefresh } from "./session";
import { readRefreshCookie } from "./cookies";
import { getCurrentUser } from "./context";
import type { AuthDb } from "./db";

export type Role = "USER" | "SUSPENDED" | "ADMIN";

/**
 * 세션/토큰이 무엇을 주장하든, 계정 상태(정지/탈퇴)를 최종적으로 거르는 관문.
 * 반드시 DB에서 방금 읽은 값으로 호출해야 한다 — 토큰의 role은 stale일 수 있다.
 */
export function assertNotSuspended(user: { role: Role; deletedAt: Date | null }): void {
  if (user.deletedAt) throw new AppError("ACCOUNT_GONE", "이용할 수 없는 계정이에요.", 403);
  if (user.role === "SUSPENDED") throw new AppError("ACCOUNT_SUSPENDED", "계정이 정지되었어요.", 403);
}

export function assertRole(role: Role, allowed: Role[]): void {
  if (!allowed.includes(role)) throw new AppError("FORBIDDEN", "권한이 없어요.", 403);
}

/** 신원(userId)이 확인된 뒤 항상 이 함수를 거쳐 DB에서 role을 새로 읽는다 — 토큰 role은 신뢰하지 않는다. */
async function loadActive(db: AuthDb, userId: string): Promise<{ userId: string; role: Role }> {
  const user = await db.user.findUnique({ where: { id: userId }, select: { role: true, deletedAt: true } });
  if (!user) throw new AppError("UNAUTHENTICATED", "로그인이 필요해요.", 401);
  assertNotSuspended(user as { role: Role; deletedAt: Date | null });
  return { userId, role: user.role as Role };
}

/** refresh 쿠키 기반 인증 + DB-fresh 권한 확인. 라우트 핸들러에서 쓰는 기본 게이트. */
export async function requireActiveUser(db: AuthDb, req: Request): Promise<{ userId: string; role: Role }> {
  const current = await currentUserFromRefresh(db, readRefreshCookie(req));
  if (!current) throw new AppError("UNAUTHENTICATED", "로그인이 필요해요.", 401);
  return loadActive(db, current.userId);
}

/** access 토큰(Bearer) 기반 인증 + DB-fresh 권한 확인. */
export async function requireActiveBearer(db: AuthDb, req: Request): Promise<{ userId: string; role: Role }> {
  const claims = await getCurrentUser(req);
  if (!claims) throw new AppError("UNAUTHENTICATED", "로그인이 필요해요.", 401);
  return loadActive(db, claims.userId);
}

export async function requireAdmin(db: AuthDb, req: Request): Promise<{ userId: string }> {
  const u = await requireActiveUser(db, req);
  assertRole(u.role, ["ADMIN"]);
  return { userId: u.userId };
}
