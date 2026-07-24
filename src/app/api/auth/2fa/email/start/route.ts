import { prisma } from "@/features/_shared/prisma";
import { withErrorHandling, AppError } from "@/features/_shared/error";
import { currentUserFromRefresh } from "@/features/auth/session";
import { readRefreshCookie } from "@/features/auth/cookies";
import { startEmailOtpSetup } from "@/features/auth/twofactor/service";
import { getMailer } from "@/features/auth/twofactor/mailer";

export const POST = withErrorHandling(async (req: Request) => {
  const current = await currentUserFromRefresh(prisma, readRefreshCookie(req));
  if (!current) throw new AppError("UNAUTHENTICATED", "로그인이 필요해요.", 401);
  await startEmailOtpSetup(prisma, current.userId, getMailer());
  return Response.json({ ok: true });
});
