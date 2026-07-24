import { prisma } from "@/features/_shared/prisma";
import { withErrorHandling } from "@/features/_shared/error";
import { requireAdmin } from "@/features/auth/rbac";
import { getChatRepo } from "@/features/chat/repo";
import { dashboardStats } from "@/features/admin/service";

export const GET = withErrorHandling(async (req: Request) => {
  await requireAdmin(prisma, req);
  const stats = await dashboardStats(prisma, getChatRepo());
  return Response.json(stats);
});
