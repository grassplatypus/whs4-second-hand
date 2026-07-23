import { prisma } from "@/features/_shared/prisma";
import { withErrorHandling } from "@/features/_shared/error";
import { rotateSession } from "@/features/auth/session";
import { readRefreshCookie, refreshCookie } from "@/features/auth/cookies";
import { requestMeta } from "@/features/auth/audit";
import { ACCESS_TTL_SECONDS } from "@/features/auth/tokens";

export const POST = withErrorHandling(async (req: Request) => {
  const rotated = await rotateSession(prisma, readRefreshCookie(req), requestMeta(req));

  return Response.json(
    { accessToken: rotated.accessToken, expiresIn: ACCESS_TTL_SECONDS },
    { headers: { "set-cookie": refreshCookie(rotated.refreshToken, rotated.expiresAt) } },
  );
});
