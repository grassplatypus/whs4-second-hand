import { prisma } from "@/features/_shared/prisma";
import { withErrorHandling, AppError } from "@/features/_shared/error";
import { requireActiveUser } from "@/features/auth/rbac";
import { clearRefreshCookie } from "@/features/auth/cookies";
import { requestMeta } from "@/features/auth/audit";
import { requireRecentAuth } from "@/features/auth/twofactor/stepup";
import { withdraw } from "@/features/profile/account";

function stepUpRequired(): AppError {
  return new AppError("STEP_UP_REQUIRED", "본인 확인이 필요해요.", 401);
}

// 회원 탈퇴 — 민감 작업이라 step-up 재인증을 추가로 요구한다.
// step_up 쿠키는 발급된 userId에 바인딩되어 있어, 다른 유저(refresh 세션)의 재인증으로는 통과할 수 없다.
export const POST = withErrorHandling(async (req: Request) => {
  const current = await requireActiveUser(prisma, req);
  const recent = await requireRecentAuth(req);
  if (recent.userId !== current.userId) throw stepUpRequired();

  await withdraw(prisma, current.userId, requestMeta(req));
  // 계정은 이미 소프트 삭제됐고 서비스가 모든 세션을 폐기했다 — 클라이언트의 refresh 쿠키도 지운다.
  return Response.json({ ok: true }, { headers: { "set-cookie": clearRefreshCookie() } });
});
