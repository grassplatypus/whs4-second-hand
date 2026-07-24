import { prisma } from "@/features/_shared/prisma";
import { withErrorHandling, AppError } from "@/features/_shared/error";
import { requireActiveUser } from "@/features/auth/rbac";
import { requestMeta } from "@/features/auth/audit";
import { updateBio } from "@/features/profile/service";

export const PATCH = withErrorHandling(async (req: Request) => {
  const current = await requireActiveUser(prisma, req);

  const raw = await req.json().catch(() => ({}));
  const bio = (raw as { bio?: unknown }).bio;
  if (typeof bio !== "string") throw new AppError("INVALID_INPUT", "소개글을 입력해 주세요.", 400);
  await updateBio(prisma, current.userId, bio, requestMeta(req));
  return Response.json({ ok: true });
});
