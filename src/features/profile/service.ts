import { z } from "zod";
import type { PrismaClient } from "@prisma/client";
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

/**
 * 공개 프로필용 상품 카드 — ProductCard(@/features/products/ProductCard)의 안전한 부분집합과 호환되게
 * 맞춘다. 판매자 정보는 이미 페이지 레벨에서 알고 있으니(이 프로필 자체가 그 판매자다) 여기엔 없다.
 */
export interface PublicProfileProductCard {
  id: string;
  title: string;
  price: number;
  category: string;
  status: string;
  thumbnail: string | null;
  regionLabel: string | null;
}

export interface PublicProfileWithProducts {
  profile: PublicProfile;
  /** 판매중/예약중 — 판매완료 제외. */
  active: PublicProfileProductCard[];
  /** 판매완료. */
  sold: PublicProfileProductCard[];
}

/** getPublicProfileWithProducts가 필요로 하는 DB 표면 — AuthDb에 상품 조회(product)만 얹는다. */
type ProfileProductsDb = AuthDb & Pick<PrismaClient, "product">;

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

/**
 * 공개 프로필 + 그 사람이 올린 상품(판매중/예약중 vs 판매완료로 분리). #7 — 공개 프로필 페이지에서
 * "이 판매자가 올린 상품"을 보여주기 위한 쿼리다. 삭제(soft delete)된 상품은 제외한다.
 * 프로필과 마찬가지로 없거나 탈퇴한 계정은 동일한 404.
 */
export async function getPublicProfileWithProducts(
  db: ProfileProductsDb,
  nickname: string,
): Promise<PublicProfileWithProducts> {
  const user = await db.user.findUnique({
    where: { nickname },
    select: {
      id: true,
      nickname: true,
      bio: true,
      regionCiphertext: true,
      phoneVerifiedAt: true,
      deletedAt: true,
      createdAt: true,
    },
  });
  if (!user || user.deletedAt) throw notFound();

  const profile: PublicProfile = {
    nickname: user.nickname,
    bio: user.bio,
    region: user.regionCiphertext ? decryptPII(user.regionCiphertext) : null,
    phoneVerified: user.phoneVerifiedAt != null,
    createdAt: user.createdAt,
  };

  const products = await db.product.findMany({
    where: { sellerId: user.id, deletedAt: null },
    select: {
      id: true,
      title: true,
      price: true,
      category: true,
      status: true,
      regionLabel: true,
      createdAt: true,
      images: { select: { path: true }, orderBy: { order: "asc" }, take: 1 },
    },
    orderBy: { createdAt: "desc" },
  });

  const active: PublicProfileProductCard[] = [];
  const sold: PublicProfileProductCard[] = [];
  for (const p of products) {
    const card: PublicProfileProductCard = {
      id: p.id,
      title: p.title,
      price: p.price,
      category: p.category,
      status: p.status,
      thumbnail: p.images[0]?.path ?? null,
      regionLabel: p.regionLabel,
    };
    (p.status === "SOLD" ? sold : active).push(card);
  }

  return { profile, active, sold };
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
