import { prisma } from "@/features/_shared/prisma";
import { withErrorHandling } from "@/features/_shared/error";
import { requireActiveUser } from "@/features/auth/rbac";
import { getEscrow } from "@/features/escrow/service";

// 참여자 격리는 서비스에서(제3자 403). 여기서는 인증만.
export const GET = withErrorHandling(async (req: Request, ctx?: unknown) => {
  const current = await requireActiveUser(prisma, req);
  const { id } = await (ctx as { params: Promise<{ id: string }> }).params;
  const escrow = await getEscrow(prisma, current.userId, id);
  return Response.json(escrow);
});
