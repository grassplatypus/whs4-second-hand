import { prisma } from "@/features/_shared/prisma";
import { withErrorHandling, AppError } from "@/features/_shared/error";
import { requireActiveUser } from "@/features/auth/rbac";
import { getChatRepo } from "@/features/chat/repo";
import { unblockUser } from "@/features/chat/service";

// 차단 해제하는 쪽도 항상 인증된 userId를 사용한다.
export const POST = withErrorHandling(async (req: Request) => {
  const current = await requireActiveUser(prisma, req);
  const body = await req.json().catch(() => ({}));
  const { targetId } = body as { targetId?: unknown };
  if (typeof targetId !== "string") {
    throw new AppError("INVALID_INPUT", "대상을 지정해 주세요.", 400);
  }
  await unblockUser(getChatRepo(), current.userId, targetId);
  return Response.json({ ok: true });
});
