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
