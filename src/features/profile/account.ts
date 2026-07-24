import { z } from "zod";
import { AppError } from "@/features/_shared/error";
import { uniqueViolationOn } from "@/features/_shared/prisma-error";
import { hashPassword, verifyPassword, dummyVerify } from "@/features/auth/password";
import { AUTH_EVENTS, logAuthEvent, type RequestMeta } from "@/features/auth/audit";
import type { AuthDb } from "@/features/auth/db";
import { assertWithdrawable, defaultWithdrawGuard, type WithdrawGuard } from "./withdrawable";

// register.ts의 registerSchema와 같은 제약(비번 8~72바이트, 닉네임 2~20 trim)을 그대로 미러링한다.
export const passwordSchema = z.string().min(8).max(72);
export const nicknameSchema = z.string().trim().min(2).max(20);

function invalidPassword(): AppError {
  return new AppError("INVALID_INPUT", "비밀번호는 8자 이상 72자 이하로 입력해 주세요.", 400);
}

function invalidNickname(): AppError {
  return new AppError("INVALID_INPUT", "닉네임은 2자 이상 20자 이하로 입력해 주세요.", 400);
}

function authFailed(): AppError {
  return new AppError("AUTH_FAILED", "다시 로그인해 주세요.", 401);
}

/**
 * OAuth 전용 계정에 최초 비밀번호를 설정한다. ext-1의 "마지막 인증수단" 갭을 닫는
 * 지점이다 — 비밀번호가 생기면 소셜 계정을 안전하게 연동 해제할 수 있게 된다.
 * 이미 비밀번호가 있는 계정은 거부한다(변경은 changePassword가 담당).
 */
export async function setPassword(
  db: AuthDb,
  userId: string,
  newPassword: string,
  meta: RequestMeta,
): Promise<void> {
  const parsed = passwordSchema.safeParse(newPassword);
  if (!parsed.success) throw invalidPassword();

  const user = await db.user.findUnique({ where: { id: userId }, select: { passwordHash: true } });
  if (!user) throw new AppError("NOT_FOUND", "사용자를 찾을 수 없어요.", 404);
  if (user.passwordHash != null) {
    throw new AppError("PASSWORD_EXISTS", "이미 비밀번호가 설정돼 있어요. 비밀번호 변경을 이용해 주세요.", 409);
  }

  await db.user.update({ where: { id: userId }, data: { passwordHash: await hashPassword(parsed.data) } });
  await logAuthEvent(db, AUTH_EVENTS.PASSWORD_SET, userId, meta);
}

/**
 * 기존 비밀번호를 검증하고 새 비밀번호로 바꾼다. 성공 시 현재 세션을 제외한 나머지
 * 세션을 전부 폐기한다(비번 변경 = 다른 곳의 세션 탈취 가능성 차단). 틀린 경우 계정
 * 존재/비번 유무를 구분하지 못하는 일반 401만 던진다(열거 방지 — dummyVerify로 같은
 * bcrypt 비용을 치른다).
 */
export async function changePassword(
  db: AuthDb,
  userId: string,
  currentPassword: string,
  newPassword: string,
  currentSessionId: string,
  meta: RequestMeta,
): Promise<void> {
  const parsed = passwordSchema.safeParse(newPassword);
  if (!parsed.success) throw invalidPassword();

  const user = await db.user.findUnique({ where: { id: userId }, select: { passwordHash: true } });
  const ok = user?.passwordHash != null
    ? await verifyPassword(currentPassword, user.passwordHash)
    : await dummyVerify(currentPassword);
  if (!ok) throw authFailed();

  await db.user.update({ where: { id: userId }, data: { passwordHash: await hashPassword(parsed.data) } });
  await db.session.updateMany({
    where: { userId, id: { not: currentSessionId }, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  await logAuthEvent(db, AUTH_EVENTS.PASSWORD_CHANGED, userId, meta);
}

/**
 * 닉네임 변경. 대부분의 중복은 update 전 읽기 체크로 걸러 409를 던진다(방어적 이중화 —
 * P2002 매핑에만 기대지 않는다). update와의 사이 경합(TOCTOU)은 P2002 캐치가 백스톱한다.
 */
export async function changeNickname(
  db: AuthDb,
  userId: string,
  nickname: string,
  meta: RequestMeta,
): Promise<void> {
  const parsed = nicknameSchema.safeParse(nickname);
  if (!parsed.success) throw invalidNickname();

  const taken = await db.user.findFirst({
    where: { nickname: parsed.data, id: { not: userId } },
    select: { id: true },
  });
  if (taken) {
    throw new AppError("NICKNAME_TAKEN", "이미 쓰고 있는 닉네임이에요.", 409);
  }

  try {
    await db.user.update({ where: { id: userId }, data: { nickname: parsed.data } });
  } catch (err) {
    if (uniqueViolationOn(err, "nickname")) {
      throw new AppError("NICKNAME_TAKEN", "이미 쓰고 있는 닉네임이에요.", 409);
    }
    throw err;
  }

  await logAuthEvent(db, AUTH_EVENTS.NICKNAME_CHANGED, userId, meta);
}

/**
 * 회원 탈퇴(소프트 삭제). guard를 먼저 통과해야 한다 — #3/#5/#7이 거래중·판매완료
 * 7일·에스크로·예약중 규칙을 WithdrawGuard로 주입한다. 통과 시 deletedAt을 찍고
 * 모든 세션을 폐기한다.
 */
export async function withdraw(
  db: AuthDb,
  userId: string,
  meta: RequestMeta,
  guard: WithdrawGuard = defaultWithdrawGuard,
): Promise<void> {
  await assertWithdrawable(db, userId, guard);

  await db.user.update({ where: { id: userId }, data: { deletedAt: new Date() } });
  await db.session.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
  await logAuthEvent(db, AUTH_EVENTS.ACCOUNT_WITHDRAWN, userId, meta);
}
