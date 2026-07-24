import { prisma } from "@/features/_shared/prisma";
import { withErrorHandling, AppError } from "@/features/_shared/error";
import { requireActiveUser } from "@/features/auth/rbac";
import { requestMeta } from "@/features/auth/audit";
import { requireRecentAuth } from "@/features/auth/twofactor/stepup";
import { setPassword } from "@/features/profile/account";

function stepUpRequired(): AppError {
  return new AppError("STEP_UP_REQUIRED", "본인 확인이 필요해요.", 401);
}

// OAuth 전용 계정의 최초 비밀번호 설정 — 민감 작업이라 step-up 재인증을 추가로 요구한다.
// step_up 쿠키는 발급된 userId에 바인딩되어 있어, 다른 유저(refresh 세션)의 재인증으로는 통과할 수 없다.
export const POST = withErrorHandling(async (req: Request) => {
  const current = await requireActiveUser(prisma, req);
  const recent = await requireRecentAuth(req);
  if (recent.userId !== current.userId) throw stepUpRequired();

  const raw = await req.json().catch(() => ({}));
  const password = (raw as { password?: unknown }).password;
  if (typeof password !== "string") throw new AppError("INVALID_INPUT", "비밀번호를 입력해 주세요.", 400);

  await setPassword(prisma, current.userId, password, requestMeta(req));
  return Response.json({ ok: true });
});
