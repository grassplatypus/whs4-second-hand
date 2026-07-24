import { prisma } from "@/features/_shared/prisma";
import { withErrorHandling } from "@/features/_shared/error";
import { requireAdmin } from "@/features/auth/rbac";
import { liftSuspension } from "@/features/admin/service";

export const POST = withErrorHandling(async (req: Request, ctx?: unknown) => {
  const admin = await requireAdmin(prisma, req);
  const { id } = await (ctx as { params: Promise<{ id: string }> }).params;
  await liftSuspension(prisma, admin.userId, id);
  return Response.json({ ok: true });
});
