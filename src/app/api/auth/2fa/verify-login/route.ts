import { prisma } from "@/features/_shared/prisma";
import { withErrorHandling, AppError } from "@/features/_shared/error";
import { requestMeta } from "@/features/auth/audit";
import { refreshCookie } from "@/features/auth/cookies";
import { readChallengeCookie, verifyChallenge, clearChallengeCookie } from "@/features/auth/twofactor/challenge";
import { completeLoginTwoFactor } from "@/features/auth/twofactor/service";
import { getMailer } from "@/features/auth/twofactor/mailer";

export const POST = withErrorHandling(async (req: Request) => {
  const challenge = await verifyChallenge(readChallengeCookie(req) ?? "");
  if (!challenge) throw new AppError("TWO_FACTOR_FAILED", "코드를 다시 확인해 주세요.", 401);
  const session = await completeLoginTwoFactor(
    prisma,
    challenge.userId,
    challenge.method,
    await req.json().catch(() => ({})),
    getMailer(),
    requestMeta(req),
  );
  return Response.json(
    { ok: true },
    {
      headers: [
        ["set-cookie", refreshCookie(session.refreshToken, session.expiresAt)],
        ["set-cookie", clearChallengeCookie()],
      ],
    },
  );
});
