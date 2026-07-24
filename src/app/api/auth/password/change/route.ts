import { prisma } from "@/features/_shared/prisma";
import { withErrorHandling, AppError } from "@/features/_shared/error";
import { requireActiveUser } from "@/features/auth/rbac";
import { readRefreshCookie } from "@/features/auth/cookies";
import { hashRefreshToken } from "@/features/auth/tokens";
import { requestMeta } from "@/features/auth/audit";
import { requireRecentAuth } from "@/features/auth/twofactor/stepup";
import { changePassword } from "@/features/profile/account";

function stepUpRequired(): AppError {
  return new AppError("STEP_UP_REQUIRED", "본인 확인이 필요해요.", 401);
}

function authFailed(): AppError {
  return new AppError("AUTH_FAILED", "다시 로그인해 주세요.", 401);
}

// 비밀번호 변경 — 민감 작업이라 step-up 재인증을 추가로 요구한다.
// step_up 쿠키는 발급된 userId에 바인딩되어 있어, 다른 유저(refresh 세션)의 재인증으로는 통과할 수 없다.
export const POST = withErrorHandling(async (req: Request) => {
  const token = readRefreshCookie(req);
  const current = await requireActiveUser(prisma, req);
  const recent = await requireRecentAuth(req);
  if (recent.userId !== current.userId) throw stepUpRequired();

  // currentUserFromRefresh가 이미 이 세션이 유효함을 확인했다 — 여기서는 changePassword가
  // "보존할" 세션의 id만 필요해서 같은 토큰으로 세션 row를 다시 조회한다.
  const session = await prisma.session.findUnique({
    where: { tokenHash: hashRefreshToken(token as string) },
    select: { id: true },
  });
  if (!session) throw authFailed();

  const raw = await req.json().catch(() => ({}));
  const currentPassword = (raw as { currentPassword?: unknown }).currentPassword;
  const newPassword = (raw as { newPassword?: unknown }).newPassword;
  if (typeof currentPassword !== "string" || typeof newPassword !== "string") {
    throw new AppError("INVALID_INPUT", "비밀번호를 입력해 주세요.", 400);
  }

  await changePassword(prisma, current.userId, currentPassword, newPassword, session.id, requestMeta(req));
  return Response.json({ ok: true });
});
