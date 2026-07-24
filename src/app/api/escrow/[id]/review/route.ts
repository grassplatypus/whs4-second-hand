import { prisma } from "@/features/_shared/prisma";
import { withErrorHandling, AppError } from "@/features/_shared/error";
import { requireActiveUser } from "@/features/auth/rbac";
import { leaveReview } from "@/features/escrow/service";

// 참여자·RELEASED 상태·평점 검증은 서비스에서. target은 서비스가 escrow에서 도출(클라이언트 입력 아님).
export const POST = withErrorHandling(async (req: Request, ctx?: unknown) => {
  const current = await requireActiveUser(prisma, req);
  const { id } = await (ctx as { params: Promise<{ id: string }> }).params;
  const body = await req.json().catch(() => ({}));
  const { rating, comment } = body as { rating?: unknown; comment?: unknown };
  if (typeof rating !== "string") {
    throw new AppError("INVALID_INPUT", "후기 내용을 확인해 주세요.", 400);
  }
  await leaveReview(prisma, current.userId, id, { rating, comment: typeof comment === "string" ? comment : undefined });
  return Response.json({ ok: true });
});
