import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { getEnv } from "@/features/_shared/env";

export const STATE_COOKIE = "oauth_state";
const STATE_TTL_MS = 10 * 60 * 1000;

export interface StatePayload {
  nonce: string;
  mode: "login" | "link";
  provider: string;
  userId?: string;
  exp: number;
}

function sign(json: string): string {
  return createHmac("sha256", getEnv().OAUTH_STATE_SECRET).update(json).digest("base64url");
}

export function signState(p: { mode: "login" | "link"; provider: string; userId?: string }): string {
  const payload: StatePayload = { ...p, nonce: randomUUID(), exp: Date.now() + STATE_TTL_MS };
  const json = JSON.stringify(payload);
  return `${Buffer.from(json).toString("base64url")}.${sign(json)}`;
}

export function verifyState(raw: string | null, expectedProvider: string): StatePayload | null {
  if (!raw) return null;
  const [body, sig] = raw.split(".");
  if (!body || !sig) return null;

  let json: string;
  try {
    json = Buffer.from(body, "base64url").toString("utf8");
  } catch {
    return null;
  }

  const expected = sign(json);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  let payload: StatePayload;
  try {
    payload = JSON.parse(json);
  } catch {
    return null;
  }
  if (payload.provider !== expectedProvider) return null;
  if (typeof payload.exp !== "number" || payload.exp < Date.now()) return null;
  return payload;
}

function secure(): string {
  return getEnv().NODE_ENV === "production" ? "; Secure" : "";
}

export function stateCookie(state: string): string {
  return `${STATE_COOKIE}=${state}; HttpOnly; SameSite=Lax; Path=/; Max-Age=600${secure()}`;
}

export function clearStateCookie(): string {
  return `${STATE_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${secure()}`;
}

export function readStateCookie(req: Request): string | null {
  const header = req.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === STATE_COOKIE) return rest.join("=") || null;
  }
  return null;
}
