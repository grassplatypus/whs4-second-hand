import { prisma } from "@/features/_shared/prisma";
import { withErrorHandling, AppError } from "@/features/_shared/error";
import { requireActiveUser } from "@/features/auth/rbac";
import { getChatRepo } from "@/features/chat/repo";
import { reportMessage, reportUser } from "@/features/chat/service";

// 신고자는 항상 인증된 userId — body로 reporterId를 실어 보낼 수 없다.
export const POST = withErrorHandling(async (req: Request) => {
  const current = await requireActiveUser(prisma, req);
  const body = await req.json().catch(() => ({}));
  const { targetType, targetId, reason } = body as {
    targetType?: unknown;
    targetId?: unknown;
    reason?: unknown;
  };
  if (
    (targetType !== "message" && targetType !== "user") ||
    typeof targetId !== "string" ||
    typeof reason !== "string"
  ) {
    throw new AppError("INVALID_INPUT", "신고 정보를 확인해 주세요.", 400);
  }

  if (targetType === "message") {
    await reportMessage(getChatRepo(), current.userId, targetId, reason);
  } else {
    await reportUser(getChatRepo(), current.userId, targetId, reason);
  }
  return Response.json({ ok: true });
});
