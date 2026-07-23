import { AppError } from "@/features/_shared/error";
import { verifyAccessToken, type AuthClaims } from "./tokens";

/**
 * access 토큰만 보고 판단하는 무상태 인증 컨텍스트.
 * 권한 게이트(SUSPENDED 차단 등)는 #2 RBAC 몫 — 여기서는 신원만 제공한다.
 */
export async function getCurrentUser(req: Request): Promise<AuthClaims | null> {
  const header = req.headers.get("authorization");
  if (!header) return null;
  // RFC 7235: auth-scheme은 대소문자 구분이 없다("Bearer"/"bearer"/"BEARER" 모두 유효).
  const match = /^bearer\s+(.+)$/i.exec(header);
  if (!match) return null;
  return verifyAccessToken(match[1].trim());
}

export async function requireUser(req: Request): Promise<AuthClaims> {
  const user = await getCurrentUser(req);
  if (!user) throw new AppError("UNAUTHENTICATED", "로그인이 필요해요.", 401);
  return user;
}
