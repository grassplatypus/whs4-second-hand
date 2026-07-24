import { prisma } from "@/features/_shared/prisma";
import { withErrorHandling, AppError } from "@/features/_shared/error";
import { requestMeta } from "@/features/auth/audit";
import { readChallengeCookie, verifyChallenge } from "@/features/auth/twofactor/challenge";
import { sendLoginOtp } from "@/features/auth/twofactor/service";

// 이메일은 모든 2FA 유저(EMAIL·TOTP)의 로그인 폴백이다(DoD 5) — 챌린지에 바인딩된 method와
// 무관하게 항상 LOGIN_2FA 이메일 코드를 발송한다. TOTP 유저가 인증기를 잃어도 이메일로 통과할 수
// 있는 유일한 계정 복구 경로가 이것이다.
export const POST = withErrorHandling(async (req: Request) => {
  const challenge = await verifyChallenge(readChallengeCookie(req) ?? "");
  if (!challenge) throw new AppError("TWO_FACTOR_FAILED", "코드를 다시 확인해 주세요.", 401);
  await sendLoginOtp(prisma, challenge.userId, requestMeta(req));
  return Response.json({ ok: true });
});
