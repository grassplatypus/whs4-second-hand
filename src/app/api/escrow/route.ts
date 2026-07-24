import { prisma } from "@/features/_shared/prisma";
import { withErrorHandling, AppError } from "@/features/_shared/error";
import { requireActiveUser } from "@/features/auth/rbac";
import { requestEscrow, listEscrows } from "@/features/escrow/service";

// 자기거래·판매중·금액 검증은 서비스에서. 여기서는 인증 + 입력 형태만 게이트한다.
// 구매자는 항상 인증된 userId — body로 buyerId를 실을 수 없다.
export const POST = withErrorHandling(async (req: Request) => {
  const current = await requireActiveUser(prisma, req);
  const body = await req.json().catch(() => ({}));
  const { productId, amount } = body as { productId?: unknown; amount?: unknown };
  if (typeof productId !== "string" || typeof amount !== "number") {
    throw new AppError("INVALID_INPUT", "상품과 금액을 확인해 주세요.", 400);
  }
  const result = await requestEscrow(prisma, current.userId, productId, amount);
  return Response.json(result, { status: 201 });
});

// 내 거래 목록 — 인증된 본인이 참여한 거래만.
export const GET = withErrorHandling(async (req: Request) => {
  const current = await requireActiveUser(prisma, req);
  const escrows = await listEscrows(prisma, current.userId);
  return Response.json({ escrows });
});
