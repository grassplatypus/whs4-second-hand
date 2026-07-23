import { prisma } from "@/features/_shared/prisma";
import { withErrorHandling } from "@/features/_shared/error";
import { checkAvailability } from "@/features/auth/register";

// POST + JSON 본문: GET 쿼리스트링에 이메일을 실으면 액세스 로그·프록시 로그·브라우저
// 히스토리·Referer에 평문 PII가 남는다 — 리뷰 수정 2.
export const POST = withErrorHandling(async (req: Request) => {
  const raw = await req.json().catch(() => null);
  return Response.json(await checkAvailability(prisma, raw));
});
