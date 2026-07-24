import { prisma } from "@/features/_shared/prisma";
import { withErrorHandling } from "@/features/_shared/error";
import { requireActiveUser } from "@/features/auth/rbac";
import { getMyProfile } from "@/features/profile/service";

export const GET = withErrorHandling(async (req: Request) => {
  const current = await requireActiveUser(prisma, req);

  const profile = await getMyProfile(prisma, current.userId);
  return Response.json(profile);
});
