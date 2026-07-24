import { prisma } from "@/features/_shared/prisma";
import { withErrorHandling } from "@/features/_shared/error";
import { requireActiveUser } from "@/features/auth/rbac";
import { requestMeta } from "@/features/auth/audit";
import { confirmTotp } from "@/features/auth/twofactor/service";

function codeOf(body: unknown): string {
  const value = (body as { code?: unknown } | null)?.code;
  return typeof value === "string" ? value : "";
}

export const POST = withErrorHandling(async (req: Request) => {
  const current = await requireActiveUser(prisma, req);
  const body = await req.json().catch(() => ({}));
  await confirmTotp(prisma, current.userId, codeOf(body), requestMeta(req));
  return Response.json({ ok: true });
});
