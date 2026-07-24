import { prisma } from "@/features/_shared/prisma";
import { withErrorHandling, AppError } from "@/features/_shared/error";
import { currentUserFromRefresh } from "@/features/auth/session";
import { readRefreshCookie } from "@/features/auth/cookies";
import { getMyProfile } from "@/features/profile/service";

export const GET = withErrorHandling(async (req: Request) => {
  const current = await currentUserFromRefresh(prisma, readRefreshCookie(req));
  if (!current) throw new AppError("UNAUTHENTICATED", "로그인이 필요해요.", 401);

  const profile = await getMyProfile(prisma, current.userId);
  return Response.json(profile);
});
