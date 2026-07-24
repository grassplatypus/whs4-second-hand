import { prisma } from "@/features/_shared/prisma";
import { withErrorHandling, AppError } from "@/features/_shared/error";
import { requireAdmin } from "@/features/auth/rbac";
import { getChatRepo } from "@/features/chat/repo";
import { resolveReport } from "@/features/admin/service";

export const POST = withErrorHandling(async (req: Request, ctx?: unknown) => {
  const admin = await requireAdmin(prisma, req);
  const { id } = await (ctx as { params: Promise<{ id: string }> }).params;
  const body = await req.json().catch(() => ({}));
  const { action } = body as { action?: unknown };
  if (action !== "resolve" && action !== "dismiss") {
    throw new AppError("INVALID_INPUT", "처리 방식을 확인해 주세요.", 400);
  }
  await resolveReport(getChatRepo(), prisma, admin.userId, id, action);
  return Response.json({ ok: true });
});
