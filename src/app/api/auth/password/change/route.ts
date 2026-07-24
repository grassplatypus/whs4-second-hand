import { prisma } from "@/features/_shared/prisma";
import { withErrorHandling, AppError } from "@/features/_shared/error";
import { requireActiveUser } from "@/features/auth/rbac";
import { readRefreshCookie } from "@/features/auth/cookies";
import { hashRefreshToken } from "@/features/auth/tokens";
import { requestMeta } from "@/features/auth/audit";
import { changePassword } from "@/features/profile/account";

function authFailed(): AppError {
  return new AppError("AUTH_FAILED", "다시 로그인해 주세요.", 401);
}

// 비밀번호 변경 — 사용자 요청에 따라 step-up(재인증 쿠키) 대신 그 자리에서 현재 비밀번호를
// 검증하는 표준 재인증 방식을 쓴다. changePassword(profile/account.ts)가 currentPassword를
// bcrypt로 검증하므로, 여기서는 로그인 여부만 확인하고 나머지는 서비스에 맡긴다.
export const POST = withErrorHandling(async (req: Request) => {
  const token = readRefreshCookie(req);
  const current = await requireActiveUser(prisma, req);

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
