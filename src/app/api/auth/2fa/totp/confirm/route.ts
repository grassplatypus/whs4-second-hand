import { prisma } from "@/features/_shared/prisma";
import { withErrorHandling, AppError } from "@/features/_shared/error";
import { currentUserFromRefresh } from "@/features/auth/session";
import { readRefreshCookie } from "@/features/auth/cookies";
import { requestMeta } from "@/features/auth/audit";
import { confirmTotp } from "@/features/auth/twofactor/service";

function codeOf(body: unknown): string {
  const value = (body as { code?: unknown } | null)?.code;
  return typeof value === "string" ? value : "";
}

export const POST = withErrorHandling(async (req: Request) => {
  const current = await currentUserFromRefresh(prisma, readRefreshCookie(req));
  if (!current) throw new AppError("UNAUTHENTICATED", "로그인이 필요해요.", 401);
  const body = await req.json().catch(() => ({}));
  await confirmTotp(prisma, current.userId, codeOf(body), requestMeta(req));
  return Response.json({ ok: true });
});
