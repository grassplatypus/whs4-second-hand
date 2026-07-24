import type { ProductStatus } from "@prisma/client";
import { prisma } from "@/features/_shared/prisma";
import { withErrorHandling, AppError } from "@/features/_shared/error";
import { requireActiveUser } from "@/features/auth/rbac";
import { changeStatus } from "@/features/products/status";

const VALID_STATUSES = new Set<ProductStatus>(["SELLING", "RESERVED", "SOLD"]);

function isProductStatus(value: unknown): value is ProductStatus {
  return typeof value === "string" && VALID_STATUSES.has(value as ProductStatus);
}

// 소유권/전이 규칙 확인은 changeStatus 내부에서 처리한다 — 여기서는 인증 + 입력 형태만 게이트한다.
export const POST = withErrorHandling(async (req: Request, ctx?: unknown) => {
  const current = await requireActiveUser(prisma, req);
  const { id } = await (ctx as { params: Promise<{ id: string }> }).params;
  const body = await req.json().catch(() => ({}));
  const status = (body as { status?: unknown }).status;
  if (!isProductStatus(status)) {
    throw new AppError("INVALID_INPUT", "상태 값이 올바르지 않아요.", 400);
  }
  await changeStatus(prisma, current.userId, id, status);
  return Response.json({ ok: true });
});
