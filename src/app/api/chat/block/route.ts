import { prisma } from "@/features/_shared/prisma";
import { withErrorHandling, AppError } from "@/features/_shared/error";
import { requireActiveUser } from "@/features/auth/rbac";
import { getChatRepo } from "@/features/chat/repo";
import { blockConversationCounterparty } from "@/features/chat/service";

// 차단하는 쪽은 항상 인증된 userId — body로 blockerId를 흉내낼 수 없다.
// 대상은 conversationId로만 받는다 — 상대의 원본 userId를 클라이언트가 알 필요도, 보낼 필요도 없다.
export const POST = withErrorHandling(async (req: Request) => {
  const current = await requireActiveUser(prisma, req);
  const body = await req.json().catch(() => ({}));
  const { conversationId } = body as { conversationId?: unknown };
  if (typeof conversationId !== "string") {
    throw new AppError("INVALID_INPUT", "대화를 지정해 주세요.", 400);
  }
  await blockConversationCounterparty(getChatRepo(), current.userId, conversationId);
  return Response.json({ ok: true });
});
