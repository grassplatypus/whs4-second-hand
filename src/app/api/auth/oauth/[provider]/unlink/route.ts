import { withErrorHandling, AppError } from "@/features/_shared/error";
import { prisma } from "@/features/_shared/prisma";
import { getAdapter } from "@/features/auth/oauth/provider";
import { unlinkIdentity } from "@/features/auth/oauth/link";
import { currentUserFromRefresh } from "@/features/auth/session";
import { readRefreshCookie } from "@/features/auth/cookies";
import { requestMeta } from "@/features/auth/audit";
import { requireRecentAuth } from "@/features/auth/twofactor/stepup";

function stepUpRequired(): AppError {
  return new AppError("STEP_UP_REQUIRED", "본인 확인이 필요해요.", 401);
}

// 쿠키 기반 상태변경 POST. SameSite=Lax가 교차 사이트 POST에서 쿠키를 막아 CSRF 방어.
export const POST = withErrorHandling(async (req: Request, ctx?: unknown) => {
  const { provider } = await (ctx as { params: Promise<{ provider: string }> }).params;
  const name = getAdapter(provider).provider; // 검증 겸 정규화
  const current = await currentUserFromRefresh(prisma, readRefreshCookie(req));
  if (!current) throw new AppError("UNAUTHENTICATED", "로그인이 필요해요.", 401);
  // 소셜 연동 해제는 민감 작업 — step-up 재인증을 추가로 요구한다.
  // step_up 쿠키는 발급된 userId에 바인딩되어 있어, 다른 유저(refresh 세션)의 재인증으로는 통과할 수 없다.
  const recent = await requireRecentAuth(req);
  if (recent.userId !== current.userId) throw stepUpRequired();
  await unlinkIdentity(prisma, current.userId, name, requestMeta(req));
  return Response.json({ ok: true });
});
