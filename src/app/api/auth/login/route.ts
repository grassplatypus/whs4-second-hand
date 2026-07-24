import { prisma } from "@/features/_shared/prisma";
import { withErrorHandling } from "@/features/_shared/error";
import { loginUser } from "@/features/auth/login";
import { refreshCookie } from "@/features/auth/cookies";
import { requestMeta } from "@/features/auth/audit";
import { signChallenge, challengeCookie } from "@/features/auth/twofactor/challenge";

export const POST = withErrorHandling(async (req: Request) => {
  const raw = await req.json().catch(() => null);
  const result = await loginUser(prisma, raw, requestMeta(req));

  if ("twoFactorRequired" in result) {
    const token = await signChallenge(result.userId, result.method);
    return Response.json(
      { twoFactorRequired: true, method: result.method },
      { headers: { "set-cookie": challengeCookie(token) } },
    );
  }

  const { accessToken, expiresIn, refreshToken, refreshExpiresAt } = result;
  return Response.json(
    { accessToken, expiresIn },
    { headers: { "set-cookie": refreshCookie(refreshToken, refreshExpiresAt) } },
  );
});
