import { randomUUID } from "node:crypto";
import { AppError } from "@/features/_shared/error";
import { generateRefreshToken, hashRefreshToken, refreshExpiry, signAccessToken } from "./tokens";
import { AUTH_EVENTS, logAuthEvent, type RequestMeta } from "./audit";
import type { AuthDb } from "./db";

export interface IssuedSession {
  refreshToken: string;
  expiresAt: Date;
}

/**
 * 새 회전 체인(familyId)을 시작한다. 로그인 시 호출.
 * refresh 원본은 반환값으로만 나가고(쿠키행), DB에는 SHA-256 해시만 남는다.
 */
export async function createSession(db: AuthDb, userId: string, familyId = randomUUID()): Promise<IssuedSession> {
  const refreshToken = generateRefreshToken();
  const expiresAt = refreshExpiry();

  await db.session.create({
    data: { userId, familyId, tokenHash: hashRefreshToken(refreshToken), expiresAt },
    select: { id: true },
  });

  return { refreshToken, expiresAt };
}

export interface RotatedSession {
  userId: string;
  role: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
}

function authFailed(): AppError {
  return new AppError("AUTH_FAILED", "다시 로그인해 주세요.", 401);
}

/**
 * refresh 회전. 유효한 토큰이면 새 access+refresh를 발급하고 구 세션을 폐기한다.
 * 이미 폐기된 토큰이 다시 오면(탈취 정황) 같은 familyId 세션을 전부 폐기한다.
 */
export async function rotateSession(
  db: AuthDb,
  refreshToken: string | null,
  meta: RequestMeta,
): Promise<RotatedSession> {
  if (!refreshToken) throw authFailed();

  const current = await db.session.findUnique({
    where: { tokenHash: hashRefreshToken(refreshToken) },
    select: {
      id: true,
      userId: true,
      familyId: true,
      expiresAt: true,
      revokedAt: true,
      user: { select: { id: true, role: true, deletedAt: true } },
    },
  });

  if (!current) throw authFailed();

  if (current.revokedAt) {
    // 재사용 감지: 이 체인은 신뢰할 수 없다 → 전부 폐기
    await db.session.updateMany({
      where: { familyId: current.familyId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    await logAuthEvent(db, AUTH_EVENTS.REUSE_DETECTED, current.userId, meta);
    throw authFailed();
  }

  if (current.expiresAt.getTime() <= Date.now() || current.user.deletedAt) throw authFailed();

  // 원자적 claim(CAS): revokedAt: null 조건이 걸린 상태에서만 갱신된다.
  // 동시에 같은 토큰으로 들어온 요청 중 단 하나만 count: 1을 받는다 — 나머지는 여기서 조용히 패배한다.
  const claim = await db.session.updateMany({
    where: { id: current.id, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  if (claim.count === 0) throw authFailed();

  const nextToken = generateRefreshToken();
  const expiresAt = refreshExpiry(); // sliding: 회전할 때마다 만료 연장
  const next = await db.session.create({
    data: {
      userId: current.userId,
      familyId: current.familyId,
      tokenHash: hashRefreshToken(nextToken),
      expiresAt,
    },
    select: { id: true },
  });

  await db.session.update({
    where: { id: current.id },
    data: { replacedById: next.id },
  });

  const accessToken = await signAccessToken({ userId: current.userId, role: current.user.role });
  await logAuthEvent(db, AUTH_EVENTS.REFRESH, current.userId, meta);

  return { userId: current.userId, role: current.user.role, accessToken, refreshToken: nextToken, expiresAt };
}

/** 로그아웃. 쿠키가 없거나 이미 폐기된 세션이면 조용히 넘어간다(멱등). */
export async function revokeSession(db: AuthDb, refreshToken: string | null, meta: RequestMeta): Promise<void> {
  if (!refreshToken) return;

  const current = await db.session.findUnique({
    where: { tokenHash: hashRefreshToken(refreshToken) },
    select: { id: true, userId: true, revokedAt: true },
  });
  if (!current || current.revokedAt) return;

  await db.session.update({ where: { id: current.id }, data: { revokedAt: new Date() } });
  await logAuthEvent(db, AUTH_EVENTS.LOGOUT, current.userId, meta);
}
