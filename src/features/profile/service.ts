import { z } from "zod";
import { decryptPII } from "@/features/_shared/crypto";
import { AppError } from "@/features/_shared/error";
import { AUTH_EVENTS, logAuthEvent, type RequestMeta } from "@/features/auth/audit";
import type { AuthDb } from "@/features/auth/db";

export interface MyProfile {
  nickname: string;
  bio: string | null;
  region: string | null;
  phoneVerified: boolean;
  twoFactorMethod: string;
  identities: string[];
  hasPassword: boolean;
  createdAt: Date;
}

/** 공개 프로필 — 이 안전한 부분집합 외에는 절대 추가하지 않는다(이메일/전화/식별정보/좌표 금지). */
export interface PublicProfile {
  nickname: string;
  bio: string | null;
  region: string | null;
  phoneVerified: boolean;
  createdAt: Date;
}

function notFound(): AppError {
  return new AppError("NOT_FOUND", "사용자를 찾을 수 없어요.", 404);
}

/**
 * 본인 프로필 조회. 이메일/전화는 절대 복호화·반환하지 않는다 — 존재/인증 배지만 내려준다.
 * region은 동네 수준 문자열로만 복호화해 반환한다(좌표는 아예 조회하지 않는다).
 */
export async function getMyProfile(db: AuthDb, userId: string): Promise<MyProfile> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: {
      nickname: true,
      bio: true,
      regionCiphertext: true,
      phoneVerifiedAt: true,
      twoFactorMethod: true,
      passwordHash: true,
      deletedAt: true,
      createdAt: true,
    },
  });
  if (!user || user.deletedAt) throw notFound();

  const identities = await db.authIdentity.findMany({ where: { userId }, select: { provider: true } });

  return {
    nickname: user.nickname,
    bio: user.bio,
    region: user.regionCiphertext ? decryptPII(user.regionCiphertext) : null,
    phoneVerified: user.phoneVerifiedAt != null,
    twoFactorMethod: user.twoFactorMethod,
    identities: identities.map((i) => i.provider),
    hasPassword: user.passwordHash != null,
    createdAt: user.createdAt,
  };
}

/**
 * 타인에게 보이는 공개 프로필. 안전한 부분집합만 조회·반환한다 — 이메일/전화/식별정보/좌표는
 * select에도 넣지 않고, 반환 객체 리터럴에도 절대 옮기지 않는다(구조적으로 새어나갈 수 없게).
 * 없거나 탈퇴(soft delete)한 계정은 존재 여부를 구분하지 않고 동일한 404를 던진다.
 */
export async function getPublicProfile(db: AuthDb, nickname: string): Promise<PublicProfile> {
  const user = await db.user.findUnique({
    where: { nickname },
    select: {
      nickname: true,
      bio: true,
      regionCiphertext: true,
      phoneVerifiedAt: true,
      deletedAt: true,
      createdAt: true,
    },
  });
  if (!user || user.deletedAt) throw notFound();

  return {
    nickname: user.nickname,
    bio: user.bio,
    region: user.regionCiphertext ? decryptPII(user.regionCiphertext) : null,
    phoneVerified: user.phoneVerifiedAt != null,
    createdAt: user.createdAt,
  };
}

export const bioSchema = z.string().trim().max(500, "소개글은 500자 이하로 적어 주세요.");

export async function updateBio(db: AuthDb, userId: string, bio: string, meta: RequestMeta): Promise<void> {
  const parsed = bioSchema.safeParse(bio);
  if (!parsed.success) {
    throw new AppError("INVALID_INPUT", "소개글은 500자 이하로 적어 주세요.", 400);
  }
  await db.user.update({ where: { id: userId }, data: { bio: parsed.data } });
  await logAuthEvent(db, AUTH_EVENTS.PROFILE_UPDATED, userId, meta);
}
