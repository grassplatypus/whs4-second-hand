import { prisma } from "@/features/_shared/prisma";
import { withErrorHandling, AppError } from "@/features/_shared/error";
import { requireActiveUser } from "@/features/auth/rbac";
import { requestMeta } from "@/features/auth/audit";
import { requireRecentAuth } from "@/features/auth/twofactor/stepup";
import { disableTwoFactor } from "@/features/auth/twofactor/service";

function stepUpRequired(): AppError {
  return new AppError("STEP_UP_REQUIRED", "본인 확인이 필요해요.", 401);
}

// 2FA 비활성화 — 민감 작업이라 step-up 재인증을 추가로 요구한다.
// step_up 쿠키는 발급된 userId에 바인딩되어 있어, 다른 유저(refresh 세션)의 재인증으로는 통과할 수 없다.
export const POST = withErrorHandling(async (req: Request) => {
  const current = await requireActiveUser(prisma, req); // 정지·삭제 계정 실시간 차단(refresh 세션 기준)
  const recent = await requireRecentAuth(req); // step_up 쿠키 없으면 401 STEP_UP_REQUIRED
  if (recent.userId !== current.userId) throw stepUpRequired();
  await disableTwoFactor(prisma, current.userId, requestMeta(req));
  return Response.json({ ok: true });
});
