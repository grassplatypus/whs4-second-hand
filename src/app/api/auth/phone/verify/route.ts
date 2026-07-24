import { prisma } from "@/features/_shared/prisma";
import { withErrorHandling, AppError } from "@/features/_shared/error";
import { requireActiveUser } from "@/features/auth/rbac";
import { requestMeta } from "@/features/auth/audit";
import { confirmPhoneVerification } from "@/features/location/service";

export const POST = withErrorHandling(async (req: Request) => {
  const current = await requireActiveUser(prisma, req);

  const raw = await req.json().catch(() => null);
  const code = raw && typeof raw === "object" && typeof (raw as { code?: unknown }).code === "string"
    ? (raw as { code: string }).code
    : null;
  if (!code) throw new AppError("INVALID_INPUT", "입력을 확인해 주세요.", 400);

  await confirmPhoneVerification(prisma, current.userId, code, requestMeta(req));
  return Response.json({ ok: true });
});
