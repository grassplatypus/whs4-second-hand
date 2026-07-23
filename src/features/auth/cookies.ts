import { getEnv } from "@/features/_shared/env";

export const REFRESH_COOKIE = "refresh_token";

/** refresh 원본은 JS에서 못 읽는 HttpOnly 쿠키로만 오간다. */
export function refreshCookie(token: string, expiresAt: Date): string {
  const secure = getEnv().NODE_ENV === "production" ? "; Secure" : ""; // dev는 http라 Secure면 쿠키가 버려짐
  return `${REFRESH_COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Expires=${expiresAt.toUTCString()}${secure}`;
}

export function clearRefreshCookie(): string {
  const secure = getEnv().NODE_ENV === "production" ? "; Secure" : "";
  return `${REFRESH_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${secure}`;
}

export function readRefreshCookie(req: Request): string | null {
  const header = req.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === REFRESH_COOKIE) return rest.join("=") || null;
  }
  return null;
}
