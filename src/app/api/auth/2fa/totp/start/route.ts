import { prisma } from "@/features/_shared/prisma";
import { withErrorHandling } from "@/features/_shared/error";
import { requireActiveUser } from "@/features/auth/rbac";
import { startTotpSetup } from "@/features/auth/twofactor/service";

export const POST = withErrorHandling(async (req: Request) => {
  const current = await requireActiveUser(prisma, req);
  const { secret, uri } = await startTotpSetup(prisma, current.userId);
  return Response.json({ secret, uri });
});
