import { prisma } from "@/features/_shared/prisma";
import { withErrorHandling, AppError } from "@/features/_shared/error";
import { requireAdmin } from "@/features/auth/rbac";
import { getChatRepo } from "@/features/chat/repo";
import { listDormantConversations, deleteDormantConversations } from "@/features/chat/service";

/** 휴면 방 목록 — 양쪽 모두 나갔고 그 뒤 새 메시지가 없는 방만. */
export const GET = withErrorHandling(async (req: Request) => {
  await requireAdmin(prisma, req);
  const rooms = await listDormantConversations(getChatRepo());
  return Response.json({ rooms });
});

/**
 * 휴면 방 삭제 — 개별(ids 한 건) 또는 일괄(ids 여러 건), all=true면 전체 휴면 방.
 * 휴면이 아닌 방은 서비스가 걸러내므로 실수로 사용 중인 대화가 지워지지 않는다.
 */
export const DELETE = withErrorHandling(async (req: Request) => {
  await requireAdmin(prisma, req);
  const body = await req.json().catch(() => ({}));
  const { ids, all } = body as { ids?: unknown; all?: unknown };
  const repo = getChatRepo();

  let targets: string[];
  if (all === true) {
    targets = (await listDormantConversations(repo)).map((r) => r.conversationId);
  } else if (Array.isArray(ids) && ids.every((v) => typeof v === "string") && ids.length > 0 && ids.length <= 500) {
    targets = ids as string[];
  } else {
    throw new AppError("INVALID_INPUT", "삭제할 방을 골라 주세요.", 400);
  }

  const deleted = await deleteDormantConversations(repo, targets);
  return Response.json({ deleted });
});
