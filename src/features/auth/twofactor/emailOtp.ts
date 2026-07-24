import bcrypt from "bcryptjs";
import { randomInt } from "node:crypto";
import { AppError } from "@/features/_shared/error";
import { AUTH_EVENTS, logAuthEvent, type RequestMeta } from "../audit";
import type { AuthDb } from "../db";
import type { OtpPurpose } from "@prisma/client";
import type { Mailer } from "./mailer";

const CODE_TTL_MS = 5 * 60 * 1000;
const RESEND_MIN_MS = 30 * 1000;

function sixDigits(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

export async function issueEmailOtp(
  db: AuthDb,
  userId: string,
  purpose: OtpPurpose,
  mailer: Mailer,
  accountEmail: string,
  meta: RequestMeta = { ip: null, ua: null },
): Promise<void> {
  const recent = await db.emailOtp.findFirst({
    where: { userId, purpose, consumedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
  });
  if (recent && Date.now() - recent.createdAt.getTime() < RESEND_MIN_MS) {
    throw new AppError("OTP_TOO_SOON", "잠시 후 다시 시도해 주세요.", 429);
  }
  // 기존 미소비 코드 무효화(활성 1개 유지)
  await db.emailOtp.updateMany({
    where: { userId, purpose, consumedAt: null },
    data: { consumedAt: new Date() },
  });

  const code = sixDigits();
  await db.emailOtp.create({
    data: {
      userId,
      purpose,
      codeHash: await bcrypt.hash(code, 10),
      expiresAt: new Date(Date.now() + CODE_TTL_MS),
    },
    select: { id: true },
  });
  // 코드 평문은 메일 본문에만. 로그·감사 금지.
  await mailer.send(accountEmail, "인증 코드", `인증 코드: ${code} (5분 안에 입력해 주세요)`);
  await logAuthEvent(db, AUTH_EVENTS.OTP_SENT, userId, meta);
}

export async function verifyEmailOtp(
  db: AuthDb,
  userId: string,
  purpose: OtpPurpose,
  code: string,
): Promise<boolean> {
  const candidates = await db.emailOtp.findMany({
    where: { userId, purpose, consumedAt: null, expiresAt: { gt: new Date() } },
    select: { id: true, codeHash: true },
  });
  for (const c of candidates) {
    if (await bcrypt.compare(code.trim(), c.codeHash)) {
      await db.emailOtp.update({ where: { id: c.id }, data: { consumedAt: new Date() } });
      return true;
    }
  }
  return false;
}
