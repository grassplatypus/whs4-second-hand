import { prisma } from "@/features/_shared/prisma";
import { withErrorHandling } from "@/features/_shared/error";
import { requireActiveUser } from "@/features/auth/rbac";
import { restoreProduct } from "@/features/products/service";

type Ctx = { params: Promise<{ id: string }> };

// 숨긴 상품 복원 — 소유권 확인은 restoreProduct 내부(assertOwnerAnyState)에서 처리한다.
// 여기서는 인증만 게이트한다.
export const POST = withErrorHandling(async (req: Request, ctx?: unknown) => {
  const current = await requireActiveUser(prisma, req);
  const { id } = await (ctx as Ctx).params;
  await restoreProduct(prisma, current.userId, id);
  return Response.json({ ok: true });
});
