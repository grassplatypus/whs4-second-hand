import { prisma } from "@/features/_shared/prisma";
import { withErrorHandling } from "@/features/_shared/error";
import { requireActiveUser } from "@/features/auth/rbac";
import { disputeEscrow } from "@/features/escrow/service";

// 분쟁 접수는 참여자만(서비스에서 강제). note는 선택.
export const POST = withErrorHandling(async (req: Request, ctx?: unknown) => {
  const current = await requireActiveUser(prisma, req);
  const { id } = await (ctx as { params: Promise<{ id: string }> }).params;
  const body = await req.json().catch(() => ({}));
  const note = typeof (body as { note?: unknown }).note === "string" ? (body as { note: string }).note : undefined;
  await disputeEscrow(prisma, current.userId, id, note);
  return Response.json({ ok: true });
});
