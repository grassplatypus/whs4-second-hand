import { prisma } from "@/features/_shared/prisma";
import { withErrorHandling, AppError } from "@/features/_shared/error";
import { requireActiveUser } from "@/features/auth/rbac";
import { counterEscrow } from "@/features/escrow/service";

// 참여자·차례·금액 검증은 서비스에서. 행위자는 인증된 userId만.
export const POST = withErrorHandling(async (req: Request, ctx?: unknown) => {
  const current = await requireActiveUser(prisma, req);
  const { id } = await (ctx as { params: Promise<{ id: string }> }).params;
  const body = await req.json().catch(() => ({}));
  const { amount } = body as { amount?: unknown };
  if (typeof amount !== "number") throw new AppError("INVALID_INPUT", "금액을 확인해 주세요.", 400);
  await counterEscrow(prisma, current.userId, id, amount);
  return Response.json({ ok: true });
});
