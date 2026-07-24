import { prisma } from "@/features/_shared/prisma";
import { withErrorHandling } from "@/features/_shared/error";
import { requireActiveUser } from "@/features/auth/rbac";
import { requestMeta } from "@/features/auth/audit";
import { sendStepUpOtp } from "@/features/auth/twofactor/service";

export const POST = withErrorHandling(async (req: Request) => {
  const current = await requireActiveUser(prisma, req);
  await sendStepUpOtp(prisma, current.userId, requestMeta(req));
  return Response.json({ ok: true });
});
