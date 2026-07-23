import { z } from "zod";

// 수집 최소화: 아래 필드 외에는 가입 시 아무것도 받지 않는다(상세주소 미수집).
// 숫자 9자 이상을 요구한다(하이픈만으로는 통과 못 하게) — 그렇지 않으면 숫자 0개짜리 값도
// 통과해 전화 blind index가 빈 문자열로 겹치는 유저가 생긴다.
const PHONE_PATTERN = /^(?=(?:\D*\d){9,})[0-9-]{9,20}$/;

export const registerSchema = z
  .object({
    email: z.email(),
    phone: z.string().regex(PHONE_PATTERN, "전화번호 형식이 올바르지 않아요."),
    nickname: z.string().trim().min(2).max(20),
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
    // registerSchema와 같은 규칙: 여기서 "쓸 수 있어요"였던 닉네임이 가입 단계에서
    // 400으로 막히면 안 된다(1자/25자 닉네임 불일치 버그).
    nickname: z.string().trim().min(2).max(20).optional(),
    email: z.email().optional(),
  })
  .refine((v) => Boolean(v.nickname) !== Boolean(v.email), {
    message: "nickname 또는 email 중 하나만 보내 주세요.",
  });
