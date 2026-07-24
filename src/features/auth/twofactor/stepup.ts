import { SignJWT, jwtVerify } from "jose";
import { getEnv } from "@/features/_shared/env";
import { AppError } from "@/features/_shared/error";
import { readCookie } from "@/features/auth/cookies";

const STEPUP_TTL = "10m";
export const STEPUP_COOKIE = "step_up";

function key(): Uint8Array {
  return new TextEncoder().encode(getEnv().JWT_ACCESS_SECRET);
}

export async function signStepUp(userId: string): Promise<string> {
  return new SignJWT({ purpose: "step_up" })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime(STEPUP_TTL)
    .sign(key());
}

export async function verifyStepUp(token: string): Promise<{ userId: string } | null> {
  try {
    const { payload } = await jwtVerify(token, key(), { algorithms: ["HS256"] });
    if (payload.purpose !== "step_up" || !payload.sub) return null;
    return { userId: payload.sub };
  } catch {
    return null;
  }
}

function secure(): string {
  return getEnv().NODE_ENV === "production" ? "; Secure" : "";
}
export function stepUpCookie(token: string): string {
  return `${STEPUP_COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=600${secure()}`;
}
export function clearStepUpCookie(): string {
  return `${STEPUP_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${secure()}`;
}
export function readStepUpCookie(req: Request): string | null {
  return readCookie(req, STEPUP_COOKIE);
}

export async function requireRecentAuth(req: Request): Promise<{ userId: string }> {
  const token = readStepUpCookie(req);
  const v = token ? await verifyStepUp(token) : null;
  if (!v) throw new AppError("STEP_UP_REQUIRED", "본인 확인이 필요해요.", 401);
  return v;
}
