import { prisma } from "@/features/_shared/prisma";
import { withErrorHandling } from "@/features/_shared/error";
import { requireAdmin } from "@/features/auth/rbac";
import { forceDeleteProduct } from "@/features/admin/service";

// 소유권 무시 강제 삭제(soft). 서비스에서 감사 로그.
export const POST = withErrorHandling(async (req: Request, ctx?: unknown) => {
  const admin = await requireAdmin(prisma, req);
  const { id } = await (ctx as { params: Promise<{ id: string }> }).params;
  await forceDeleteProduct(prisma, admin.userId, id);
  return Response.json({ ok: true });
});
