import { encryptPII, emailIndex, phoneIndex } from "@/features/_shared/crypto";
import { AppError } from "@/features/_shared/error";
import { uniqueViolationOn } from "@/features/_shared/prisma-error";
import { hashPassword } from "./password";
import { registerSchema, availabilitySchema } from "./schema";
import { AUTH_EVENTS, logAuthEvent, type RequestMeta } from "./audit";
import type { AuthDb } from "./db";

function parseOrThrow<T>(schema: { safeParse: (v: unknown) => { success: boolean; data?: T } }, raw: unknown): T {
  const parsed = schema.safeParse(raw);
  if (!parsed.success || !parsed.data) {
    // 어떤 필드가 왜 틀렸는지는 흘리지 않는다(열거 방지). 폼이 클라이언트에서 1차 안내.
    throw new AppError("INVALID_INPUT", "입력한 내용을 다시 확인해 주세요.", 400);
  }
  return parsed.data;
}

export async function registerUser(
  db: AuthDb,
  raw: unknown,
  meta: RequestMeta,
): Promise<{ userId: string }> {
  const input = parseOrThrow(registerSchema, raw);

  const blindEmail = emailIndex(input.email);
  const existing = await db.user.findFirst({
    where: { OR: [{ emailBlindIndex: blindEmail }, { nickname: input.nickname }] },
    select: { id: true, nickname: true },
  });
  if (existing) {
    throw existing.nickname === input.nickname
      ? new AppError("NICKNAME_TAKEN", "이미 쓰고 있는 닉네임이에요.", 409)
      : new AppError("EMAIL_TAKEN", "이미 가입된 이메일이에요.", 409);
  }

  let user: { id: string };
  try {
    user = await db.user.create({
      data: {
        nickname: input.nickname,
        passwordHash: await hashPassword(input.password),
        emailCiphertext: encryptPII(input.email),
        emailBlindIndex: blindEmail,
        phoneCiphertext: encryptPII(input.phone),
        phoneBlindIndex: phoneIndex(input.phone),
        consentedAt: new Date(), // 동의 캡처(PIPA 제15조)
      },
      select: { id: true },
    });
  } catch (err) {
    // 동시 가입 경합: 읽기 체크를 통과한 뒤 create에서 고유 제약에 걸린 경우.
    if (uniqueViolationOn(err, "nickname")) {
      throw new AppError("NICKNAME_TAKEN", "이미 쓰고 있는 닉네임이에요.", 409);
    }
    if (uniqueViolationOn(err, "emailBlindIndex")) {
      throw new AppError("EMAIL_TAKEN", "이미 가입된 이메일이에요.", 409);
    }
    throw err;
  }

  await logAuthEvent(db, AUTH_EVENTS.REGISTER, user.id, meta);
  return { userId: user.id };
}

export async function checkAvailability(db: AuthDb, raw: unknown): Promise<{ available: boolean }> {
  const query = parseOrThrow(availabilitySchema, raw);
  const where = query.nickname
    ? { nickname: query.nickname }
    : { emailBlindIndex: emailIndex(query.email!) };

  const found = await db.user.findFirst({ where, select: { id: true } });
  return { available: found === null };
}
