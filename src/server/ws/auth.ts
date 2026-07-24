import { verifyAccessToken } from "@/features/auth/tokens";

export interface SocketAuth {
  userId: string;
}

/**
 * 소켓 핸드셰이크에 실린 access token을 검증한다.
 * 토큰이 없거나(undefined) 서명/만료/형식이 무효면 항상 null을 반환한다 — 이 경우
 * 호출자(WS 미들웨어)는 연결을 거부해야 한다(#0 스텁처럼 accept-all이면 안 됨).
 */
export async function authenticateSocket(token: string | undefined): Promise<SocketAuth | null> {
  if (!token) return null;
  const claims = await verifyAccessToken(token);
  if (!claims) return null;
  return { userId: claims.userId };
}
