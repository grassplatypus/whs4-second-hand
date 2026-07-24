import { prisma } from "@/features/_shared/prisma";
import { withErrorHandling, AppError } from "@/features/_shared/error";
import { currentUserFromRefresh } from "@/features/auth/session";
import { readRefreshCookie } from "@/features/auth/cookies";
import { requestMeta } from "@/features/auth/audit";
import { verifyStepUpReauth } from "@/features/auth/twofactor/service";
import { signStepUp, stepUpCookie } from "@/features/auth/twofactor/stepup";

export const POST = withErrorHandling(async (req: Request) => {
  const current = await currentUserFromRefresh(prisma, readRefreshCookie(req));
  if (!current) throw new AppError("UNAUTHENTICATED", "로그인이 필요해요.", 401);
  await verifyStepUpReauth(prisma, current.userId, await req.json().catch(() => ({})), requestMeta(req));
  return Response.json({ ok: true }, { headers: { "set-cookie": stepUpCookie(await signStepUp(current.userId)) } });
});
