import { prisma } from "@/features/_shared/prisma";
import { withErrorHandling } from "@/features/_shared/error";
import { loginUser } from "@/features/auth/login";
import { refreshCookie } from "@/features/auth/cookies";
import { requestMeta } from "@/features/auth/audit";

export const POST = withErrorHandling(async (req: Request) => {
  const { accessToken, expiresIn, refreshToken, refreshExpiresAt } = await loginUser(
    prisma,
    await req.json(),
    requestMeta(req),
  );

  return Response.json(
    { accessToken, expiresIn },
    { headers: { "set-cookie": refreshCookie(refreshToken, refreshExpiresAt) } },
  );
});
