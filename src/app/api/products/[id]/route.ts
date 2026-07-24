import { prisma } from "@/features/_shared/prisma";
import { withErrorHandling } from "@/features/_shared/error";
import { requireActiveUser } from "@/features/auth/rbac";
import { getProduct, updateProduct, deleteProduct } from "@/features/products/service";

type Ctx = { params: Promise<{ id: string }> };

// 공개 엔드포인트 — 인증 불필요. getProduct의 안전한 부분집합만 내려간다.
export const GET = withErrorHandling(async (_req: Request, ctx?: unknown) => {
  const { id } = await (ctx as Ctx).params;
  const product = await getProduct(prisma, id);
  return Response.json(product);
});

// 소유권 확인은 updateProduct 내부(assertOwner)에서 처리한다 — 여기서는 인증만 게이트한다.
export const PATCH = withErrorHandling(async (req: Request, ctx?: unknown) => {
  const current = await requireActiveUser(prisma, req);
  const { id } = await (ctx as Ctx).params;
  const body = await req.json().catch(() => ({}));
  await updateProduct(prisma, current.userId, id, body);
  return Response.json({ ok: true });
});

// 소유권 확인은 deleteProduct 내부(assertOwner)에서 처리한다.
export const DELETE = withErrorHandling(async (req: Request, ctx?: unknown) => {
  const current = await requireActiveUser(prisma, req);
  const { id } = await (ctx as Ctx).params;
  await deleteProduct(prisma, current.userId, id);
  return Response.json({ ok: true });
});
