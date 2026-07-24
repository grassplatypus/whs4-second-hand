import { prisma } from "@/features/_shared/prisma";
import { withErrorHandling } from "@/features/_shared/error";
import { requireActiveBearer } from "@/features/auth/rbac";

// 인증 컨텍스트가 실제로 동작하는지 보여주는 최소 보호 엔드포인트.
// access 토큰의 role은 최대 15분 stale할 수 있어, DB-fresh로 신원·정지 여부를 다시 확인한다.
// 프로필 조회(닉네임·소개글 등)는 1c에서 확장한다.
export const GET = withErrorHandling(async (req: Request) => {
  const { userId, role } = await requireActiveBearer(prisma, req);
  return Response.json({ userId, role });
});
