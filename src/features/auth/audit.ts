import type { AuthDb } from "./db";

export const AUTH_EVENTS = {
  REGISTER: "REGISTER",
  LOGIN: "LOGIN",
  LOGIN_FAIL: "LOGIN_FAIL",
  REFRESH: "REFRESH",
  REUSE_DETECTED: "REUSE_DETECTED",
  LOGOUT: "LOGOUT",
  OAUTH_LOGIN: "OAUTH_LOGIN",
  OAUTH_REGISTER: "OAUTH_REGISTER",
  OAUTH_LINK: "OAUTH_LINK",
  OAUTH_UNLINK: "OAUTH_UNLINK",
  OAUTH_FAIL: "OAUTH_FAIL",
  TWO_FACTOR_ENABLED: "TWO_FACTOR_ENABLED",
  TWO_FACTOR_DISABLED: "TWO_FACTOR_DISABLED",
  TWO_FACTOR_CHALLENGE: "TWO_FACTOR_CHALLENGE",
  TWO_FACTOR_SUCCESS: "TWO_FACTOR_SUCCESS",
  TWO_FACTOR_FAIL: "TWO_FACTOR_FAIL",
  STEP_UP_SUCCESS: "STEP_UP_SUCCESS",
  STEP_UP_FAIL: "STEP_UP_FAIL",
  OTP_SENT: "OTP_SENT",
  PHONE_OTP_SENT: "PHONE_OTP_SENT",
  PHONE_VERIFIED: "PHONE_VERIFIED",
  PHONE_VERIFY_FAIL: "PHONE_VERIFY_FAIL",
  LOCATION_SET: "LOCATION_SET",
} as const;

export type AuthEvent = (typeof AUTH_EVENTS)[keyof typeof AUTH_EVENTS];

export interface RequestMeta {
  ip: string | null;
  ua: string | null;
}

export function requestMeta(req: Request): RequestMeta {
  const forwarded = req.headers.get("x-forwarded-for");
  return {
    ip: forwarded ? (forwarded.split(",")[0]?.trim() || null) : null,
    ua: req.headers.get("user-agent"),
  };
}

/**
 * PIPA 접근기록. userId·이벤트·ip·ua만 남긴다 — 이메일/전화 등 PII 평문 금지.
 * 감사 기록 실패가 로그인/가입을 실패시키면 안 되므로 예외를 삼킨다.
 */
export async function logAuthEvent(
  db: AuthDb,
  event: AuthEvent,
  userId: string | null,
  meta: RequestMeta,
): Promise<void> {
  try {
    await db.authAuditLog.create({ data: { event, userId, ip: meta.ip, ua: meta.ua } });
  } catch (err) {
    console.error("[AUDIT] 기록 실패", { event, userId, err });
  }
}
