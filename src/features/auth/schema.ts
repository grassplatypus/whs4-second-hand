import { z } from "zod";

// 수집 최소화: 아래 필드 외에는 가입 시 아무것도 받지 않는다(상세주소 미수집).
export const registerSchema = z
  .object({
    email: z.email(),
    phone: z.string().regex(/^[0-9-]{9,20}$/, "전화번호 형식이 올바르지 않아요."),
    nickname: z.string().min(2).max(20),
    password: z.string().min(8).max(72), // bcrypt 입력 상한 72바이트
    passwordConfirm: z.string(),
    consent: z.literal(true), // 미동의 가입 차단(PIPA 제15조)
  })
  .refine((v) => v.password === v.passwordConfirm, {
    message: "비밀번호가 서로 달라요.",
    path: ["passwordConfirm"],
  });

export type RegisterInput = z.infer<typeof registerSchema>;

export const loginSchema = z.object({
  email: z.email(),
  password: z.string().min(1),
});

export type LoginInput = z.infer<typeof loginSchema>;

export const availabilitySchema = z
  .object({
    nickname: z.string().min(1).optional(),
    email: z.email().optional(),
  })
  .refine((v) => Boolean(v.nickname) !== Boolean(v.email), {
    message: "nickname 또는 email 중 하나만 보내 주세요.",
  });
