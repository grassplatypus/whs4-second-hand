import { createCipheriv, createDecipheriv, createHmac, randomBytes } from "node:crypto";
import { getEnv } from "./env";
import { AppError } from "./error";

const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12; // GCM 권장 길이

function aesKey(): Buffer {
  // AES_KEY는 env 스키마에서 정확히 32자로 검증됨 → 32바이트 = AES-256 키
  return Buffer.from(getEnv().AES_KEY, "utf8");
}

/** AES-256-GCM으로 PII를 암호화한다. 출력: base64(iv).base64(authTag).base64(ciphertext) */
export function encryptPII(plain: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, aesKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return [iv.toString("base64"), cipher.getAuthTag().toString("base64"), ciphertext.toString("base64")].join(".");
}

/** 역변환. authTag가 맞지 않으면(변조) 예외를 던진다. */
export function decryptPII(payload: string): string {
  const parts = payload.split(".");
  if (parts.length !== 3) {
    throw new AppError("DECRYPT_FAILED", "데이터를 읽을 수 없어요.", 500);
  }
  const [iv, tag, ciphertext] = parts;
  try {
    const decipher = createDecipheriv(ALGORITHM, aesKey(), Buffer.from(iv, "base64"));
    decipher.setAuthTag(Buffer.from(tag, "base64"));
    return Buffer.concat([decipher.update(Buffer.from(ciphertext, "base64")), decipher.final()]).toString("utf8");
  } catch {
    // 원인(키 불일치/변조)을 밖으로 흘리지 않는다
    throw new AppError("DECRYPT_FAILED", "데이터를 읽을 수 없어요.", 500);
  }
}

export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

export function normalizePhone(value: string): string {
  return value.replace(/\D/g, "");
}

/** 결정적 HMAC-SHA256 인덱스. 암호문은 매번 달라지므로 조회·유니크는 이 값으로 한다. */
function blindIndex(normalized: string): string {
  return createHmac("sha256", getEnv().BLIND_INDEX_KEY).update(normalized).digest("hex");
}

export function emailIndex(email: string): string {
  return blindIndex(normalizeEmail(email));
}

export function phoneIndex(phone: string): string {
  return blindIndex(normalizePhone(phone));
}
