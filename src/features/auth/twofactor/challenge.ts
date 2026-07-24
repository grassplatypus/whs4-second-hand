import { SignJWT, jwtVerify } from "jose";
import { getEnv } from "@/features/_shared/env";
import { readCookie } from "@/features/auth/cookies";

const CHALLENGE_TTL = "5m";
export const CHALLENGE_COOKIE = "2fa_challenge";

function key(): Uint8Array {
  return new TextEncoder().encode(getEnv().JWT_ACCESS_SECRET);
}

export async function signChallenge(userId: string, method: string): Promise<string> {
  return new SignJWT({ purpose: "2fa", method })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime(CHALLENGE_TTL)
    .sign(key());
}

export async function verifyChallenge(token: string): Promise<{ userId: string; method: string } | null> {
  try {
    const { payload } = await jwtVerify(token, key(), { algorithms: ["HS256"] });
    if (payload.purpose !== "2fa" || !payload.sub || typeof payload.method !== "string") return null;
    return { userId: payload.sub, method: payload.method };
  } catch {
    return null;
  }
}

function secure(): string {
  return getEnv().NODE_ENV === "production" ? "; Secure" : "";
}
export function challengeCookie(token: string): string {
  return `${CHALLENGE_COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=300${secure()}`;
}
export function clearChallengeCookie(): string {
  return `${CHALLENGE_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${secure()}`;
}
export function readChallengeCookie(req: Request): string | null {
  return readCookie(req, CHALLENGE_COOKIE);
}
