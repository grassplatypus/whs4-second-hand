import { prisma } from "@/features/_shared/prisma";
import { withErrorHandling } from "@/features/_shared/error";
import { requireActiveUser } from "@/features/auth/rbac";
import { requestMeta } from "@/features/auth/audit";
import { verifyStepUpReauth } from "@/features/auth/twofactor/service";
import { signStepUp, stepUpCookie } from "@/features/auth/twofactor/stepup";

export const POST = withErrorHandling(async (req: Request) => {
  const current = await requireActiveUser(prisma, req);
  await verifyStepUpReauth(prisma, current.userId, await req.json().catch(() => ({})), requestMeta(req));
  return Response.json({ ok: true }, { headers: { "set-cookie": stepUpCookie(await signStepUp(current.userId)) } });
});
