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

/** 범용 쿠키 리더. 신규 모듈(challenge/step-up)은 이걸 쓴다. 기존 refresh/oauth-state 리더는 범위 밖(그대로 둔다). */
export function readCookie(req: Request, name: string): string | null {
  const header = req.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const [partName, ...rest] = part.trim().split("=");
    if (partName === name) return rest.join("=") || null;
  }
  return null;
}
