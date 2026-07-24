import { prisma } from "@/features/_shared/prisma";
import { withErrorHandling } from "@/features/_shared/error";
import { requireActiveUser } from "@/features/auth/rbac";
import { startEmailOtpSetup } from "@/features/auth/twofactor/service";
import { getMailer } from "@/features/auth/twofactor/mailer";

export const POST = withErrorHandling(async (req: Request) => {
  const current = await requireActiveUser(prisma, req);
  await startEmailOtpSetup(prisma, current.userId, getMailer());
  return Response.json({ ok: true });
});
