import bcrypt from "bcryptjs";
import { randomInt } from "node:crypto";
import { AppError } from "@/features/_shared/error";
import { AUTH_EVENTS, logAuthEvent, type RequestMeta } from "@/features/auth/audit";
import type { AuthDb } from "@/features/auth/db";
import type { Sms } from "./sms";

const CODE_TTL_MS = 5 * 60 * 1000;
const RESEND_MIN_MS = 30 * 1000;

function sixDigits(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

export async function issuePhoneOtp(
  db: AuthDb,
  userId: string,
  phonePlaintext: string,
  phoneBlindIndex: string,
  sms: Sms,
  meta: RequestMeta = { ip: null, ua: null },
): Promise<void> {
  const recent = await db.phoneOtp.findFirst({
    where: { userId, consumedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
  });
  if (recent && Date.now() - recent.createdAt.getTime() < RESEND_MIN_MS) {
    throw new AppError("OTP_TOO_SOON", "잠시 후 다시 시도해 주세요.", 429);
  }
  // 기존 미소비 코드 무효화(활성 1개 유지)
  await db.phoneOtp.updateMany({
    where: { userId, consumedAt: null },
    data: { consumedAt: new Date() },
  });

  const code = sixDigits();
  await db.phoneOtp.create({
    data: {
      userId,
      phoneBlindIndex,
      codeHash: await bcrypt.hash(code, 10),
      expiresAt: new Date(Date.now() + CODE_TTL_MS),
    },
    select: { id: true },
  });
  // 코드 평문은 SMS 본문에만. 로그·감사 금지.
  await sms.send(phonePlaintext, code);
  await logAuthEvent(db, AUTH_EVENTS.PHONE_OTP_SENT, userId, meta);
}

export async function verifyPhoneOtp(db: AuthDb, userId: string, code: string): Promise<boolean> {
  const candidates = await db.phoneOtp.findMany({
    where: { userId, consumedAt: null, expiresAt: { gt: new Date() } },
    select: { id: true, codeHash: true },
  });
  for (const c of candidates) {
    if (await bcrypt.compare(code.trim(), c.codeHash)) {
      await db.phoneOtp.update({ where: { id: c.id }, data: { consumedAt: new Date() } });
      return true;
    }
  }
  return false;
}
