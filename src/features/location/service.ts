import { z } from "zod";
import { encryptPII, decryptPII } from "@/features/_shared/crypto";
import { AppError } from "@/features/_shared/error";
import { AUTH_EVENTS, logAuthEvent, type RequestMeta } from "@/features/auth/audit";
import type { AuthDb } from "@/features/auth/db";
import { coarsen, type Geocoder, type RegionInput } from "./geocoder/geocoder";
import { issuePhoneOtp, verifyPhoneOtp } from "./phone/phoneOtp";
import type { Sms } from "./phone/sms";

export const locationSchema = z.object({
  sido: z.string().trim().min(1),
  sigungu: z.string().trim().min(1),
  dong: z.string().trim().min(1),
});

export async function setLocation(
  db: AuthDb,
  userId: string,
  input: RegionInput,
  geocoder: Geocoder,
  meta: RequestMeta,
): Promise<{ region: string }> {
  const result = await geocoder.geocode(input);
  const { lat, lng } = coarsen(result.lat, result.lng); // 저장 직전 반올림 — 정확좌표 저장 금지
  await db.user.update({
    where: { id: userId },
    data: { lat, lng, regionCiphertext: encryptPII(result.region) },
  });
  await logAuthEvent(db, AUTH_EVENTS.LOCATION_SET, userId, meta);
  return { region: result.region }; // 좌표는 반환하지 않는다
}

export async function startPhoneVerification(
  db: AuthDb,
  userId: string,
  sms: Sms,
  meta: RequestMeta,
): Promise<void> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { phoneCiphertext: true, phoneBlindIndex: true },
  });
  if (!user?.phoneCiphertext || !user.phoneBlindIndex) {
    throw new AppError("NO_PHONE", "등록된 전화번호가 없어요.", 400);
  }
  await issuePhoneOtp(db, userId, decryptPII(user.phoneCiphertext), user.phoneBlindIndex, sms, meta);
}

export async function confirmPhoneVerification(
  db: AuthDb,
  userId: string,
  code: string,
  meta: RequestMeta,
): Promise<void> {
  const ok = await verifyPhoneOtp(db, userId, code);
  if (!ok) {
    await logAuthEvent(db, AUTH_EVENTS.PHONE_VERIFY_FAIL, userId, meta);
    throw new AppError("PHONE_VERIFY_FAILED", "코드를 다시 확인해 주세요.", 401);
  }
  const me = await db.user.findUnique({ where: { id: userId }, select: { phoneBlindIndex: true } });
  if (me?.phoneBlindIndex) {
    const other = await db.user.findFirst({
      where: { phoneBlindIndex: me.phoneBlindIndex, phoneVerifiedAt: { not: null }, id: { not: userId } },
      select: { id: true },
    });
    if (other) throw new AppError("PHONE_TAKEN", "이미 인증된 전화번호예요.", 409);
  }
  await db.user.update({ where: { id: userId }, data: { phoneVerifiedAt: new Date() } });
  await logAuthEvent(db, AUTH_EVENTS.PHONE_VERIFIED, userId, meta);
}
