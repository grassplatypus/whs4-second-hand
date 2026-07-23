import { randomUUID } from "node:crypto";
import { generateRefreshToken, hashRefreshToken, refreshExpiry } from "./tokens";
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
