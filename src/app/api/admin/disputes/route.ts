import { prisma } from "@/features/_shared/prisma";
import { withErrorHandling } from "@/features/_shared/error";
import { requireAdmin } from "@/features/auth/rbac";
import { listDisputedEscrows } from "@/features/admin/service";

// 조정 자체는 #5 POST /api/escrow/[id]/resolve(requireAdmin) 재사용.
export const GET = withErrorHandling(async (req: Request) => {
  await requireAdmin(prisma, req);
  const disputes = await listDisputedEscrows(prisma);
  return Response.json({ disputes });
});
