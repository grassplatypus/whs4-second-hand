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

/** 세션 발급 전 단계 마커 — 토큰을 담지 않는다. 2FA 챌린지를 통과해야만 세션이 나간다. */
export interface OAuthTwoFactorChallengeResult {
  twoFactorRequired: true;
  method: string;
  userId: string;
}

export type OAuthLoginResult = (IssuedSession & { userId: string }) | OAuthTwoFactorChallengeResult;

export async function loginOrRegisterWithOAuth(
  db: AuthDb,
  provider: ProviderName,
  info: OAuthUserInfo,
  meta: RequestMeta,
): Promise<OAuthLoginResult> {
  const identity = await db.authIdentity.findUnique({
    where: { provider_providerUserId: { provider, providerUserId: info.providerUserId } },
    select: { userId: true, user: { select: { id: true, deletedAt: true, twoFactorMethod: true } } },
  });

  if (identity) {
    if (identity.user.deletedAt) throw new AppError("AUTH_FAILED", "다시 로그인해 주세요.", 401);
    // 기존 신원 로그인 경로: 2FA가 켜진 계정이면 세션 대신 챌린지를 반환한다 — OAuth로 2FA를 우회하지 못하게 한다.
    if (identity.user.twoFactorMethod !== "NONE") {
      await logAuthEvent(db, AUTH_EVENTS.TWO_FACTOR_CHALLENGE, identity.userId, meta);
      return { twoFactorRequired: true, method: identity.user.twoFactorMethod, userId: identity.userId };
    }
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
    // 빠른 경로: 대부분의 경우 이 시점에서 바로 걸러진다.
    throw new AppError("LAST_CREDENTIAL", "마지막 로그인 수단이라 해제할 수 없어요. 비밀번호를 먼저 설정해 주세요.", 409);
  }

  // 가드는 delete 자체의 WHERE 절에 인코딩해 DB에서 원자적으로 강제한다 (TOCTOU 방지).
  // 삭제 후에도 비밀번호가 있거나 다른 identity가 남아있을 때만 실제로 삭제된다.
  // 잔여 경합: READ COMMITTED 하에서 서로 다른 provider에 대한 완전 동시 unlink 두 건은
  // 각 문장의 관계 서브쿼리가 상대방 커밋 이전 상태를 볼 수 있어 이 가드를 통과할 수 있다.
  // 이를 완전히 막으려면 SERIALIZABLE + 행 잠금(`$transaction`)이 필요하며 `AuthDb`는 이를
  // 노출하지 않는다. 알려진 잔여 이슈로 트래킹한다.
  const removed = await db.authIdentity.deleteMany({
    where: {
      id: target.id,
      user: {
        OR: [
          { passwordHash: { not: null } },
          { identities: { some: { id: { not: target.id } } } },
        ],
      },
    },
  });
  if (removed.count === 0) {
    throw new AppError("LAST_CREDENTIAL", "마지막 로그인 수단이라 해제할 수 없어요. 비밀번호를 먼저 설정해 주세요.", 409);
  }
  await logAuthEvent(db, AUTH_EVENTS.OAUTH_UNLINK, userId, meta);
}
