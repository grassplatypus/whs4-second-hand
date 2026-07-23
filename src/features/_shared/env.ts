import { z } from "zod";

const schema = z.object({
  DATABASE_URL: z.string().url().or(z.string().startsWith("postgresql://")),
  JWT_ACCESS_SECRET: z.string().min(16),
  JWT_REFRESH_SECRET: z.string().min(16),
  AES_KEY: z.string().length(32),
  BLIND_INDEX_KEY: z.string().min(32),
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
