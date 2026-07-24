import { prisma } from "@/features/_shared/prisma";
import { withErrorHandling, AppError } from "@/features/_shared/error";
import { requireActiveUser } from "@/features/auth/rbac";
import { getChatRepo } from "@/features/chat/repo";
import { checkConversationNumber } from "@/features/chat/service";

/**
 * 거래 상대가 알려준 계좌·전화번호에 사기 신고 이력이 있는지 확인한다(데모: 흉내 조회).
 *
 * 아무 번호나 조회하는 창구가 되지 않도록, **그 대화에서 실제로 오간 번호만** 확인해 준다.
 * (서버가 대화 내용을 다시 훑어 대조하고, 참여자가 아니면 403.)
 */
export const POST = withErrorHandling(async (req: Request) => {
  const current = await requireActiveUser(prisma, req);
  const body = await req.json().catch(() => ({}));
  const { conversationId, value } = body as { conversationId?: unknown; value?: unknown };

  if (typeof conversationId !== "string" || !conversationId) {
    throw new AppError("INVALID_INPUT", "확인할 대화를 알려 주세요.", 400);
  }
  if (typeof value !== "string" || value.length > 40) {
    throw new AppError("INVALID_INPUT", "번호를 다시 확인해 주세요.", 400);
  }

  const result = await checkConversationNumber(getChatRepo(), current.userId, conversationId, value);
  return Response.json(result);
});
