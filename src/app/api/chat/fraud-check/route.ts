import { prisma } from "@/features/_shared/prisma";
import { withErrorHandling, AppError } from "@/features/_shared/error";
import { requireActiveUser } from "@/features/auth/rbac";
import { getFraudLookup } from "@/features/chat/fraud-lookup";

/**
 * 거래 상대의 계좌·전화번호에 사기 신고 이력이 있는지 확인한다(데모: 목업 조회).
 * 로그인한 사용자만 쓸 수 있고, 조회한 값은 저장하지 않는다 — 결과만 돌려준다.
 */
export const POST = withErrorHandling(async (req: Request) => {
  await requireActiveUser(prisma, req);
  const body = await req.json().catch(() => ({}));
  const { kind, value } = body as { kind?: unknown; value?: unknown };

  if (kind !== "phone" && kind !== "account") {
    throw new AppError("INVALID_INPUT", "확인할 종류를 골라 주세요.", 400);
  }
  if (typeof value !== "string" || value.length > 40) {
    throw new AppError("INVALID_INPUT", "번호를 다시 확인해 주세요.", 400);
  }
  const digits = value.replace(/\D/g, "");
  if (digits.length < 8 || digits.length > 16) {
    throw new AppError("INVALID_INPUT", "번호를 다시 확인해 주세요.", 400);
  }

  const result = await getFraudLookup().check(kind, digits);
  return Response.json({ reported: result.reported, count: result.count });
});
