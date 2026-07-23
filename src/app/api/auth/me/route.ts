import { withErrorHandling } from "@/features/_shared/error";
import { requireUser } from "@/features/auth/context";

// 인증 컨텍스트가 실제로 동작하는지 보여주는 최소 보호 엔드포인트.
// 프로필 조회(닉네임·소개글 등)는 1c에서 확장한다.
export const GET = withErrorHandling(async (req: Request) => {
  const { userId, role } = await requireUser(req);
  return Response.json({ userId, role });
});
