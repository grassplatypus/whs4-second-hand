import { prisma } from "@/features/_shared/prisma";
import { withErrorHandling } from "@/features/_shared/error";
import { requireActiveUser } from "@/features/auth/rbac";
import { getChatRepo } from "@/features/chat/repo";
import { leaveConversation } from "@/features/chat/service";

// 방 나가기 — 내 목록에서만 사라진다(상대는 그대로). 참여자 확인은 서비스에서.
export const POST = withErrorHandling(async (req: Request, ctx?: unknown) => {
  const current = await requireActiveUser(prisma, req);
  const { id } = await (ctx as { params: Promise<{ id: string }> }).params;
  await leaveConversation(getChatRepo(), current.userId, id);
  return Response.json({ ok: true });
});
