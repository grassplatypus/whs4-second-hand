import { prisma } from "@/features/_shared/prisma";
import { withErrorHandling } from "@/features/_shared/error";
import { getPublicProfile } from "@/features/profile/service";

// 공개 엔드포인트 — 인증 불필요. getPublicProfile의 안전한 부분집합만 내려간다.
export const GET = withErrorHandling(async (_req: Request, ctx?: unknown) => {
  const { nickname } = await (ctx as { params: Promise<{ nickname: string }> }).params;
  const profile = await getPublicProfile(prisma, decodeURIComponent(nickname));
  return Response.json(profile);
});
