import { prisma } from "@/features/_shared/prisma";
import { withErrorHandling, AppError } from "@/features/_shared/error";
import { requireActiveUser } from "@/features/auth/rbac";
import { requestMeta } from "@/features/auth/audit";
import { changeNickname } from "@/features/profile/account";

// 닉네임 변경 — 민감도가 낮아 step-up 재인증을 요구하지 않는다(사용자 요청).
// 고유성 검증(409 NICKNAME_TAKEN)은 changeNickname이 그대로 강제한다.
export const POST = withErrorHandling(async (req: Request) => {
  const current = await requireActiveUser(prisma, req);

  const raw = await req.json().catch(() => ({}));
  const nickname = (raw as { nickname?: unknown }).nickname;
  if (typeof nickname !== "string") throw new AppError("INVALID_INPUT", "닉네임을 입력해 주세요.", 400);

  await changeNickname(prisma, current.userId, nickname, requestMeta(req));
  return Response.json({ ok: true });
});
