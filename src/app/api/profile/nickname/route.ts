import { prisma } from "@/features/_shared/prisma";
import { withErrorHandling, AppError } from "@/features/_shared/error";
import { currentUserFromRefresh } from "@/features/auth/session";
import { readRefreshCookie } from "@/features/auth/cookies";
import { requestMeta } from "@/features/auth/audit";
import { requireRecentAuth } from "@/features/auth/twofactor/stepup";
import { changeNickname } from "@/features/profile/account";

function stepUpRequired(): AppError {
  return new AppError("STEP_UP_REQUIRED", "본인 확인이 필요해요.", 401);
}

// 닉네임 변경은 민감 작업 — step-up 재인증을 추가로 요구한다.
// step_up 쿠키는 발급된 userId에 바인딩되어 있어, 다른 유저(refresh 세션)의 재인증으로는 통과할 수 없다.
export const POST = withErrorHandling(async (req: Request) => {
  const current = await currentUserFromRefresh(prisma, readRefreshCookie(req));
  if (!current) throw new AppError("UNAUTHENTICATED", "로그인이 필요해요.", 401);
  const recent = await requireRecentAuth(req);
  if (recent.userId !== current.userId) throw stepUpRequired();

  const raw = await req.json().catch(() => ({}));
  const nickname = (raw as { nickname?: unknown }).nickname;
  if (typeof nickname !== "string") throw new AppError("INVALID_INPUT", "닉네임을 입력해 주세요.", 400);

  await changeNickname(prisma, current.userId, nickname, requestMeta(req));
  return Response.json({ ok: true });
});
