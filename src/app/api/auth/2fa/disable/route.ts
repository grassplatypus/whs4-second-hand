import { prisma } from "@/features/_shared/prisma";
import { withErrorHandling } from "@/features/_shared/error";
import { requestMeta } from "@/features/auth/audit";
import { requireRecentAuth } from "@/features/auth/twofactor/stepup";
import { disableTwoFactor } from "@/features/auth/twofactor/service";

export const POST = withErrorHandling(async (req: Request) => {
  const recent = await requireRecentAuth(req); // step_up 쿠키 없으면 401 STEP_UP_REQUIRED
  await disableTwoFactor(prisma, recent.userId, requestMeta(req));
  return Response.json({ ok: true });
});
