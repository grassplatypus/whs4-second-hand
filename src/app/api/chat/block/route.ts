import { prisma } from "@/features/_shared/prisma";
import { withErrorHandling, AppError } from "@/features/_shared/error";
import { requireActiveUser } from "@/features/auth/rbac";
import { getChatRepo } from "@/features/chat/repo";
import { blockUser } from "@/features/chat/service";

// 차단하는 쪽은 항상 인증된 userId — body로 blockerId를 흉내낼 수 없다.
export const POST = withErrorHandling(async (req: Request) => {
  const current = await requireActiveUser(prisma, req);
  const body = await req.json().catch(() => ({}));
  const { targetId } = body as { targetId?: unknown };
  if (typeof targetId !== "string") {
    throw new AppError("INVALID_INPUT", "대상을 지정해 주세요.", 400);
  }
  await blockUser(getChatRepo(), current.userId, targetId);
  return Response.json({ ok: true });
});
