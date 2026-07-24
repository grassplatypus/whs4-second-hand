import { prisma } from "@/features/_shared/prisma";
import { withErrorHandling, AppError } from "@/features/_shared/error";
import { requestMeta } from "@/features/auth/audit";
import { readChallengeCookie, verifyChallenge } from "@/features/auth/twofactor/challenge";
import { sendLoginOtp } from "@/features/auth/twofactor/service";

export const POST = withErrorHandling(async (req: Request) => {
  const challenge = await verifyChallenge(readChallengeCookie(req) ?? "");
  if (!challenge) throw new AppError("TWO_FACTOR_FAILED", "코드를 다시 확인해 주세요.", 401);
  if (challenge.method === "EMAIL") {
    await sendLoginOtp(prisma, challenge.userId, requestMeta(req));
  }
  return Response.json({ ok: true });
});
