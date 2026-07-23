import { z } from "zod";

const schema = z.object({
  DATABASE_URL: z.string().url().or(z.string().startsWith("postgresql://")),
  JWT_ACCESS_SECRET: z.string().min(16),
  // JWT_REFRESH_SECRET 없음: refresh 토큰은 서명이 아니라 랜덤 바이트+SHA-256 해시로
  // 결정된다(session.ts) — 어떤 코드도 이 시크릿을 읽지 않아 제거했다(최종 리뷰 수정 #6).
  AES_KEY: z.string().refine((val) => Buffer.byteLength(val, "utf8") === 32, {
    message: "must be exactly 32 bytes in UTF-8",
  }),
  BLIND_INDEX_KEY: z.string().refine((val) => Buffer.byteLength(val, "utf8") >= 32, {
    message: "must be at least 32 bytes in UTF-8",
  }),
  WS_PORT: z.coerce.number().int().positive(),
  NODE_ENV: z.enum(["development", "production", "test"]),
});

export type Env = z.infer<typeof schema>;

export function parseEnv(raw: NodeJS.ProcessEnv | Record<string, unknown>): Env {
  const result = schema.safeParse(raw);
  if (!result.success) {
    throw new Error("환경변수 검증 실패: " + result.error.issues.map((i) => i.path.join(".")).join(", "));
  }
  return result.data;
}

let cached: Env | null = null;
export function getEnv(): Env {
  if (!cached) cached = parseEnv(process.env);
  return cached;
}
