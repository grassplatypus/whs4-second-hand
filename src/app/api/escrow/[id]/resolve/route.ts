import { prisma } from "@/features/_shared/prisma";
import { withErrorHandling, AppError } from "@/features/_shared/error";
import { requireAdmin } from "@/features/auth/rbac";
import { resolveDispute } from "@/features/escrow/service";

// 분쟁 조정은 관리자만 — requireAdmin으로 게이트(서비스는 DISPUTED 소스·원자성만 담당).
export const POST = withErrorHandling(async (req: Request, ctx?: unknown) => {
  const admin = await requireAdmin(prisma, req);
  const { id } = await (ctx as { params: Promise<{ id: string }> }).params;
  const body = await req.json().catch(() => ({}));
  const { resolution } = body as { resolution?: unknown };
  if (resolution !== "release" && resolution !== "refund") {
    throw new AppError("INVALID_INPUT", "조정 결과를 확인해 주세요.", 400);
  }
  await resolveDispute(prisma, admin.userId, id, resolution);
  return Response.json({ ok: true });
});
