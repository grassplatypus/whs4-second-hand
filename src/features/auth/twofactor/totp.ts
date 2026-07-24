import { generateSecret, generateURI, verifySync } from "otplib";
import { getEnv } from "@/features/_shared/env";

// otplib v13은 `authenticator` 싱글턴이 없는 완전 재작성판(functional API)이라
// 브리프가 가정한 v12 스타일(`authenticator.options = { window: 1 }`)은 존재하지
// 않는다. 동일한 의도(기본 TOTP 주기 30초 기준 ±1 스텝, 즉 클라이언트-서버 시계
// 오차 허용)를 `epochTolerance`(초 단위, 대칭 허용)로 구현한다.
const TOTP_PERIOD_SECONDS = 30;
const EPOCH_TOLERANCE_SECONDS = TOTP_PERIOD_SECONDS; // ±1 스텝

export function generateTotpSecret(): string {
  return generateSecret();
}

export function totpUri(secret: string, accountEmail: string): string {
  return generateURI({ issuer: getEnv().TWO_FACTOR_ISSUER, label: accountEmail, secret });
}

export function verifyTotp(secret: string, code: string): boolean {
  try {
    return verifySync({ secret, token: code.trim(), epochTolerance: EPOCH_TOLERANCE_SECONDS }).valid;
  } catch {
    return false;
  }
}
