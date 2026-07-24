import { prisma } from "@/features/_shared/prisma";
import { withErrorHandling, AppError } from "@/features/_shared/error";
import { requireActiveUser } from "@/features/auth/rbac";
import { getChatRepo } from "@/features/chat/repo";
import { reportMessage, reportUser, reportConversationCounterparty } from "@/features/chat/service";

/**
 * 신고자는 항상 인증된 userId — body로 reporterId를 실어 보낼 수 없다.
 * targetType="message"는 messageId(targetId)를 받는다.
 * targetType="user"는 conversationId(선호 — ChatRoom은 이 경로만 쓴다. 상대의 원본 userId를
 * 클라이언트가 알 필요도, 보낼 필요도 없다 #5/G8)를 우선 쓰고, 없으면 targetId(다른 신고 진입점을
 * 위한 하위 호환 — 예: 채팅 맥락이 없는 관리자/프로필 신고 흐름)로 폴백한다.
 */
export const POST = withErrorHandling(async (req: Request) => {
  const current = await requireActiveUser(prisma, req);
  const body = await req.json().catch(() => ({}));
  const { targetType, reason } = body as { targetType?: unknown; reason?: unknown };
  if ((targetType !== "message" && targetType !== "user") || typeof reason !== "string") {
    throw new AppError("INVALID_INPUT", "신고 정보를 확인해 주세요.", 400);
  }

  if (targetType === "message") {
    const { targetId } = body as { targetId?: unknown };
    if (typeof targetId !== "string") {
      throw new AppError("INVALID_INPUT", "신고 정보를 확인해 주세요.", 400);
    }
    await reportMessage(getChatRepo(), current.userId, targetId, reason);
  } else {
    const { conversationId, targetId } = body as { conversationId?: unknown; targetId?: unknown };
    if (typeof conversationId === "string") {
      await reportConversationCounterparty(getChatRepo(), current.userId, conversationId, reason);
    } else if (typeof targetId === "string") {
      await reportUser(getChatRepo(), current.userId, targetId, reason);
    } else {
      throw new AppError("INVALID_INPUT", "신고 정보를 확인해 주세요.", 400);
    }
  }
  return Response.json({ ok: true });
});
