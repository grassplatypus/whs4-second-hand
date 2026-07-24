import { prisma } from "@/features/_shared/prisma";
import { withErrorHandling } from "@/features/_shared/error";
import { requireActiveUser } from "@/features/auth/rbac";
import { refundEscrow } from "@/features/escrow/service";

// 반환은 판매자만(서비스에서 강제). 금액 입력 없음.
export const POST = withErrorHandling(async (req: Request, ctx?: unknown) => {
  const current = await requireActiveUser(prisma, req);
  const { id } = await (ctx as { params: Promise<{ id: string }> }).params;
  await refundEscrow(prisma, current.userId, id);
  return Response.json({ ok: true });
});
