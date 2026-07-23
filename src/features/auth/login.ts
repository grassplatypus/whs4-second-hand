import { emailIndex } from "@/features/_shared/crypto";
import { AppError } from "@/features/_shared/error";
import { verifyPassword, dummyVerify } from "./password";
import { signAccessToken, ACCESS_TTL_SECONDS } from "./tokens";
import { loginSchema } from "./schema";
import { createSession } from "./session";
import { AUTH_EVENTS, logAuthEvent, type RequestMeta } from "./audit";
import type { AuthDb } from "./db";

export interface LoginResult {
  accessToken: string;
  expiresIn: number;
  refreshToken: string;
  refreshExpiresAt: Date;
}

/** 실패 사유(계정 없음/비번 틀림/탈퇴/소셜전용)를 구분하지 않는다 — 계정 존재 여부 누출 방지. */
function authFailed(): AppError {
  return new AppError("AUTH_FAILED", "이메일이나 비밀번호를 다시 확인해 주세요.", 401);
}

export async function loginUser(db: AuthDb, raw: unknown, meta: RequestMeta): Promise<LoginResult> {
  const parsed = loginSchema.safeParse(raw);
  if (!parsed.success) {
    await logAuthEvent(db, AUTH_EVENTS.LOGIN_FAIL, null, meta);
    throw authFailed();
  }

  const user = await db.user.findFirst({
    where: { emailBlindIndex: emailIndex(parsed.data.email) },
    select: { id: true, role: true, passwordHash: true, deletedAt: true },
  });

  const ok =
    user && !user.deletedAt && user.passwordHash
      ? await verifyPassword(parsed.data.password, user.passwordHash)
      : await dummyVerify(parsed.data.password); // 계정 없음/소셜전용도 같은 비용을 치른다

  if (!ok || !user) {
    await logAuthEvent(db, AUTH_EVENTS.LOGIN_FAIL, user?.id ?? null, meta);
    throw authFailed();
  }

  const session = await createSession(db, user.id);
  const accessToken = await signAccessToken({ userId: user.id, role: user.role });
  await logAuthEvent(db, AUTH_EVENTS.LOGIN, user.id, meta);

  return {
    accessToken,
    expiresIn: ACCESS_TTL_SECONDS,
    refreshToken: session.refreshToken,
    refreshExpiresAt: session.expiresAt,
  };
}
