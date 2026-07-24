import { prisma } from "@/features/_shared/prisma";
import { withErrorHandling } from "@/features/_shared/error";
import { requireAdmin } from "@/features/auth/rbac";
import { suspendUser } from "@/features/admin/service";

// 자기·타관리자 정지 금지는 서비스에서 강제. 관리자 id는 인증에서만.
export const POST = withErrorHandling(async (req: Request, ctx?: unknown) => {
  const admin = await requireAdmin(prisma, req);
  const { id } = await (ctx as { params: Promise<{ id: string }> }).params;
  await suspendUser(prisma, admin.userId, id);
  return Response.json({ ok: true });
});
