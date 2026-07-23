import { createHash, randomBytes } from "node:crypto";
import { SignJWT, jwtVerify } from "jose";
import { getEnv } from "@/features/_shared/env";

export const ACCESS_TTL_SECONDS = 15 * 60;
export const REFRESH_TTL_DAYS = 14;

export interface AuthClaims {
  userId: string;
  role: string;
}

/** 매 호출마다 getEnv()로 검증된 값을 읽는다. 모듈 스코프에 캐시하지 않는다(빈 fallback 재발 방지). */
function accessKey(): Uint8Array {
  return new TextEncoder().encode(getEnv().JWT_ACCESS_SECRET);
}

export async function signAccessToken(claims: AuthClaims): Promise<string> {
  return new SignJWT({ role: claims.role })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(claims.userId)
    .setIssuedAt()
    .setExpirationTime(`${ACCESS_TTL_SECONDS}s`)
    .sign(accessKey());
}

/** 검증 실패(서명·만료·형식)는 전부 null. 원인을 구분해 흘리지 않는다. */
export async function verifyAccessToken(token: string): Promise<AuthClaims | null> {
  try {
    const { payload } = await jwtVerify(token, accessKey(), { algorithms: ["HS256"] });
    if (!payload.sub || typeof payload.role !== "string") return null;
    return { userId: payload.sub, role: payload.role };
  } catch {
    return null;
  }
}

/** refresh 원본은 쿠키에만 존재한다. DB에는 아래 해시만 저장한다. */
export function generateRefreshToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashRefreshToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function refreshExpiry(now: Date = new Date()): Date {
  return new Date(now.getTime() + REFRESH_TTL_DAYS * 24 * 60 * 60 * 1000);
}
