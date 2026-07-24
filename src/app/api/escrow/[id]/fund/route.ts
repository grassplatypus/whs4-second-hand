import { prisma } from "@/features/_shared/prisma";
import { withErrorHandling } from "@/features/_shared/error";
import { requireActiveUser } from "@/features/auth/rbac";
import { fundEscrow } from "@/features/escrow/service";

// 구매자 강제·상품 SELLING 재확인(이중보관 방지)은 서비스에서. 금액 입력 없음(서버 보관 금액만 정산).
export const POST = withErrorHandling(async (req: Request, ctx?: unknown) => {
  const current = await requireActiveUser(prisma, req);
  const { id } = await (ctx as { params: Promise<{ id: string }> }).params;
  await fundEscrow(prisma, current.userId, id);
  return Response.json({ ok: true });
});
