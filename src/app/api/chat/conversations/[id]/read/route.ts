import { prisma } from "@/features/_shared/prisma";
import { withErrorHandling } from "@/features/_shared/error";
import { requireActiveUser } from "@/features/auth/rbac";
import { getChatRepo } from "@/features/chat/repo";
import { markConversationRead } from "@/features/chat/service";

// 방을 열어봤다고 표시 — 안 읽은 수가 0이 되고 상대에게 읽음으로 보인다.
export const POST = withErrorHandling(async (req: Request, ctx?: unknown) => {
  const current = await requireActiveUser(prisma, req);
  const { id } = await (ctx as { params: Promise<{ id: string }> }).params;
  await markConversationRead(getChatRepo(), current.userId, id);
  return Response.json({ ok: true });
});
