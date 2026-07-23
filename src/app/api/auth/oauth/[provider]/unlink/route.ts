import { withErrorHandling, AppError } from "@/features/_shared/error";
import { prisma } from "@/features/_shared/prisma";
import { getAdapter } from "@/features/auth/oauth/provider";
import { unlinkIdentity } from "@/features/auth/oauth/link";
import { currentUserFromRefresh } from "@/features/auth/session";
import { readRefreshCookie } from "@/features/auth/cookies";
import { requestMeta } from "@/features/auth/audit";

// 쿠키 기반 상태변경 POST. SameSite=Lax가 교차 사이트 POST에서 쿠키를 막아 CSRF 방어.
export const POST = withErrorHandling(async (req: Request, ctx?: unknown) => {
  const { provider } = await (ctx as { params: Promise<{ provider: string }> }).params;
  const name = getAdapter(provider).provider; // 검증 겸 정규화
  const current = await currentUserFromRefresh(prisma, readRefreshCookie(req));
  if (!current) throw new AppError("UNAUTHENTICATED", "로그인이 필요해요.", 401);
  await unlinkIdentity(prisma, current.userId, name, requestMeta(req));
  return Response.json({ ok: true });
});
