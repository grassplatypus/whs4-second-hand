import { prisma } from "@/features/_shared/prisma";
import { withErrorHandling } from "@/features/_shared/error";
import { revokeSession } from "@/features/auth/session";
import { readRefreshCookie, clearRefreshCookie } from "@/features/auth/cookies";
import { requestMeta } from "@/features/auth/audit";

export const POST = withErrorHandling(async (req: Request) => {
  await revokeSession(prisma, readRefreshCookie(req), requestMeta(req));
  return Response.json({ ok: true }, { headers: { "set-cookie": clearRefreshCookie() } });
});
