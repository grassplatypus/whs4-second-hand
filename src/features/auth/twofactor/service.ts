import { encryptPII, decryptPII } from "@/features/_shared/crypto";
import { AppError } from "@/features/_shared/error";
import { verifyPassword, dummyVerify } from "../password";
import { createSession, type IssuedSession } from "../session";
import { AUTH_EVENTS, logAuthEvent, type RequestMeta } from "../audit";
import { assertNotSuspended, type Role } from "../rbac";
import type { AuthDb } from "../db";
import { generateTotpSecret, totpUri, verifyTotp } from "./totp";
import { issueEmailOtp, verifyEmailOtp } from "./emailOtp";
import { getMailer, type Mailer } from "./mailer";

/** 2FA 코드 실패의 공용 에러 — 계정 존재 여부·수단·사유를 드러내지 않는다. */
function twoFactorFailed(): AppError {
  return new AppError("TWO_FACTOR_FAILED", "코드를 다시 확인해 주세요.", 401);
}

/** step-up 재인증 실패의 공용 에러 — 어떤 수단·왜 실패했는지 노출하지 않는다. */
function stepUpFailed(): AppError {
  return new AppError("STEP_UP_FAILED", "본인 확인에 실패했어요.", 401);
}

function authFailed(): AppError {
  return new AppError("AUTH_FAILED", "다시 로그인해 주세요.", 401);
}

async function accountEmailOf(db: AuthDb, userId: string): Promise<string> {
  const user = await db.user.findUnique({ where: { id: userId }, select: { emailCiphertext: true } });
  if (!user) throw authFailed();
  return decryptPII(user.emailCiphertext);
}

/** 저장된(암호화된) TOTP 시크릿을 복호화해 코드를 검증한다. 시크릿 없으면 실패. */
async function verifyTotpFor(db: AuthDb, userId: string, code: string): Promise<boolean> {
  const user = await db.user.findUnique({ where: { id: userId }, select: { totpSecret: true } });
  return !!user?.totpSecret && verifyTotp(decryptPII(user.totpSecret), code);
}

/**
 * TOTP 설정 시작. 시크릿을 새로 만들어 암호문으로만 저장한다(평문은 응답에만 실어 반환).
 * `twoFactorMethod`는 아직 바꾸지 않는다 — confirmTotp에서 코드 검증 후에만 전환.
 */
export async function startTotpSetup(db: AuthDb, userId: string): Promise<{ secret: string; uri: string }> {
  const user = await db.user.findUnique({ where: { id: userId }, select: { emailCiphertext: true } });
  if (!user) throw authFailed();
  const secret = generateTotpSecret();
  await db.user.update({ where: { id: userId }, data: { totpSecret: encryptPII(secret) } });
  return { secret, uri: totpUri(secret, decryptPII(user.emailCiphertext)) };
}

/** 설정 확정. 저장된 시크릿을 복호화해 코드를 검증하고 성공해야만 TOTP를 활성화한다. */
export async function confirmTotp(db: AuthDb, userId: string, code: string, meta: RequestMeta): Promise<void> {
  const ok = await verifyTotpFor(db, userId, code);
  if (!ok) throw twoFactorFailed();
  await db.user.update({ where: { id: userId }, data: { twoFactorMethod: "TOTP" } });
  await logAuthEvent(db, AUTH_EVENTS.TWO_FACTOR_ENABLED, userId, meta);
}

/** 이메일 OTP 설정 시작. 계정 이메일(복호화)로 SETUP 목적 코드를 발송한다. */
export async function startEmailOtpSetup(db: AuthDb, userId: string, mailer: Mailer): Promise<void> {
  const accountEmail = await accountEmailOf(db, userId);
  await issueEmailOtp(db, userId, "SETUP", mailer, accountEmail);
}

/** 이메일 OTP 설정 확정. 성공해야만 EMAIL 방식을 활성화한다. */
export async function confirmEmailOtpSetup(db: AuthDb, userId: string, code: string, meta: RequestMeta): Promise<void> {
  const ok = await verifyEmailOtp(db, userId, "SETUP", code);
  if (!ok) throw twoFactorFailed();
  // TOTP에서 EMAIL로 전환하는 경우를 대비해 남아 있을 수 있는 시크릿을 함께 지운다(disableTwoFactor와 대칭).
  await db.user.update({ where: { id: userId }, data: { twoFactorMethod: "EMAIL", totpSecret: null } });
  await logAuthEvent(db, AUTH_EVENTS.TWO_FACTOR_ENABLED, userId, meta);
}

/**
 * 2FA 해제. 호출자(라우트)가 step-up 재인증을 이미 강제했다고 가정한다 — 여기서는 강제하지 않는다.
 */
export async function disableTwoFactor(db: AuthDb, userId: string, meta: RequestMeta): Promise<void> {
  await db.user.update({ where: { id: userId }, data: { twoFactorMethod: "NONE", totpSecret: null } });
  await logAuthEvent(db, AUTH_EVENTS.TWO_FACTOR_DISABLED, userId, meta);
}

interface StepUpRaw {
  method?: unknown;
  password?: unknown;
  code?: unknown;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/**
 * step-up 재인증 한 번의 검증. password/totp/email 세 수단을 지원한다.
 * 어떤 이유로 실패하든(계정에 비번 없음, 코드 틀림, 알 수 없는 수단) 동일한 일반 에러만 던진다 —
 * 실패 사유·시도한 수단을 호출자에게 노출하지 않는다.
 */
async function checkStepUp(db: AuthDb, userId: string, raw: unknown): Promise<boolean> {
  const r = (raw ?? {}) as StepUpRaw;
  switch (r.method) {
    case "password": {
      const user = await db.user.findUnique({ where: { id: userId }, select: { passwordHash: true } });
      const plain = asString(r.password);
      // OAuth-only(비번 없음) 계정도 동일한 bcrypt 비용을 치르게 해 타이밍으로 구분되지 않게 한다.
      return user?.passwordHash ? verifyPassword(plain, user.passwordHash) : dummyVerify(plain);
    }
    case "totp":
      return verifyTotpFor(db, userId, asString(r.code));
    case "email":
      return verifyEmailOtp(db, userId, "STEP_UP", asString(r.code));
    default:
      return false;
  }
}

export async function verifyStepUpReauth(db: AuthDb, userId: string, raw: unknown, meta: RequestMeta): Promise<void> {
  const ok = await checkStepUp(db, userId, raw);
  if (!ok) {
    await logAuthEvent(db, AUTH_EVENTS.STEP_UP_FAIL, userId, meta);
    throw stepUpFailed();
  }
  await logAuthEvent(db, AUTH_EVENTS.STEP_UP_SUCCESS, userId, meta);
}

/**
 * 로그인 2FA 챌린지 완료. 사용자의 활성 수단(EMAIL/TOTP)에 맞춰 코드를 검증하고,
 * 성공한 경우에만 새 세션을 발급한다.
 *
 * 이메일 OTP는 모든 유저의 로그인 폴백이다(DoD 5) — TOTP 유저도 인증기를 잃으면 이메일로
 * 발송된 LOGIN_2FA 코드로 통과할 수 있다(resend 라우트가 항상 발송). 그래서 TOTP 분기는
 * TOTP 코드 *또는* 이메일 코드 중 하나만 맞으면 통과한다. 어느 경로로 성공했는지는 호출자에게
 * 노출하지 않는다(응답·감사 모두 TWO_FACTOR_SUCCESS로 동일).
 */
export async function completeLoginTwoFactor(
  db: AuthDb,
  userId: string,
  method: string,
  raw: unknown,
  mailer: Mailer,
  meta: RequestMeta,
): Promise<IssuedSession> {
  void mailer; // 시그니처 일관성을 위해 받되, 코드 검증에는 메일 발송이 필요 없다(재발송은 sendLoginOtp).
  const code = asString((raw as { code?: unknown })?.code);
  // fail-closed: 알려진 두 수단(EMAIL/TOTP) 외의 값은 어떤 시크릿 상태와도 무관하게 즉시 실패 처리한다 —
  // 오탈자·오래된 값·조작된 값이 TOTP 검증으로 새는 다운그레이드 경로를 막는다.
  let ok: boolean;
  switch (method) {
    case "EMAIL":
      ok = await verifyEmailOtp(db, userId, "LOGIN_2FA", code);
      break;
    case "TOTP":
      // 이메일 폴백: TOTP 코드가 틀려도 유효한 LOGIN_2FA 이메일 코드면 통과시킨다.
      ok = (await verifyTotpFor(db, userId, code)) || (await verifyEmailOtp(db, userId, "LOGIN_2FA", code));
      break;
    default:
      ok = false;
  }
  if (!ok) {
    await logAuthEvent(db, AUTH_EVENTS.TWO_FACTOR_FAIL, userId, meta);
    throw twoFactorFailed();
  }
  // 코드는 맞았지만, 챌린지 대기 중 계정이 정지/탈퇴됐을 수 있다 — 세션 발급 전 DB-fresh로 마지막 확인.
  // (코드 검증 자체는 통과했으므로 TWO_FACTOR_FAIL이 아니라 별도의 403으로 막는다.)
  const user = await db.user.findUnique({ where: { id: userId }, select: { role: true, deletedAt: true } });
  if (!user) throw twoFactorFailed();
  assertNotSuspended({ role: user.role as Role, deletedAt: user.deletedAt });
  const session = await createSession(db, userId);
  await logAuthEvent(db, AUTH_EVENTS.TWO_FACTOR_SUCCESS, userId, meta);
  return session;
}

/** 로그인 2FA 챌린지 중 이메일 코드 재발송. */
export async function sendLoginOtp(db: AuthDb, userId: string, meta: RequestMeta): Promise<void> {
  const accountEmail = await accountEmailOf(db, userId);
  // 발송 자체의 감사(OTP_SENT)는 issueEmailOtp가 남긴다 — 호출자의 ip/ua를 그대로 싣는다.
  await issueEmailOtp(db, userId, "LOGIN_2FA", getMailer(), accountEmail, meta);
}

/**
 * step-up 재인증용 이메일 OTP 발송. 비번이 없는(OAuth-only) 계정이 password/totp step-up을 쓸 수 없을 때의
 * 유일한 통로다 — sendLoginOtp와 대칭이지만 purpose가 STEP_UP.
 */
export async function sendStepUpOtp(db: AuthDb, userId: string, meta: RequestMeta): Promise<void> {
  const accountEmail = await accountEmailOf(db, userId);
  // 발송 자체의 감사(OTP_SENT)는 issueEmailOtp가 남긴다 — 호출자의 ip/ua를 그대로 싣는다.
  await issueEmailOtp(db, userId, "STEP_UP", getMailer(), accountEmail, meta);
}
