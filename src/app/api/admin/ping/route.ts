import { prisma } from "@/features/_shared/prisma";
import { withErrorHandling } from "@/features/_shared/error";
import { requireAdmin } from "@/features/auth/rbac";

export const GET = withErrorHandling(async (req: Request) => {
  await requireAdmin(prisma, req);
  return Response.json({ ok: true });
});
