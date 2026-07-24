import { prisma } from "@/features/_shared/prisma";
import { withErrorHandling } from "@/features/_shared/error";
import { requireActiveUser } from "@/features/auth/rbac";
import { requestMeta } from "@/features/auth/audit";
import { getSms } from "@/features/location/phone/sms";
import { startPhoneVerification } from "@/features/location/service";

export const POST = withErrorHandling(async (req: Request) => {
  const current = await requireActiveUser(prisma, req);

  await startPhoneVerification(prisma, current.userId, getSms(), requestMeta(req));
  return Response.json({ ok: true });
});
