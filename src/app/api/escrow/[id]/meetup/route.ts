import { prisma } from "@/features/_shared/prisma";
import { withErrorHandling, AppError } from "@/features/_shared/error";
import { requireActiveUser } from "@/features/auth/rbac";
import { setMeetup } from "@/features/escrow/service";

// 참여자·상태(ACCEPTED/FUNDED)·값 검증은 서비스에서. 행위자는 인증된 userId만.
export const POST = withErrorHandling(async (req: Request, ctx?: unknown) => {
  const current = await requireActiveUser(prisma, req);
  const { id } = await (ctx as { params: Promise<{ id: string }> }).params;
  const body = await req.json().catch(() => ({}));
  const { place, at } = body as { place?: unknown; at?: unknown };
  if (typeof place !== "string" || typeof at !== "string") {
    throw new AppError("INVALID_INPUT", "약속 정보를 확인해 주세요.", 400);
  }
  await setMeetup(prisma, current.userId, id, { place, at });
  return Response.json({ ok: true });
});
