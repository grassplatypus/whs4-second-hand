import { prisma } from "@/features/_shared/prisma";
import { withErrorHandling, AppError } from "@/features/_shared/error";
import { requireActiveUser } from "@/features/auth/rbac";
import { getChatRepo } from "@/features/chat/repo";
import { startConversation, listConversations } from "@/features/chat/service";

// 참여자/차단/첫 메시지 검증은 전부 서비스에서 처리한다 — 여기서는 인증 + 입력 형태만 게이트한다.
export const POST = withErrorHandling(async (req: Request) => {
  const current = await requireActiveUser(prisma, req);
  const body = await req.json().catch(() => ({}));
  const { productId, firstText } = body as { productId?: unknown; firstText?: unknown };
  if (typeof productId !== "string" || typeof firstText !== "string") {
    throw new AppError("INVALID_INPUT", "상품과 첫 메시지를 입력해 주세요.", 400);
  }
  const result = await startConversation(getChatRepo(), prisma, current.userId, productId, firstText);
  return Response.json(result, { status: 201 });
});

// 내 대화 목록 — 인증된 사용자 본인의 대화만 조회한다(다른 사용자 id를 받지 않는다).
export const GET = withErrorHandling(async (req: Request) => {
  const current = await requireActiveUser(prisma, req);
  const conversations = await listConversations(getChatRepo(), prisma, current.userId);
  return Response.json({ conversations });
});
