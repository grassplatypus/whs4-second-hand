import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { prisma } from "@/features/_shared/prisma";
import { currentUserFromRefresh } from "@/features/auth/session";
import { REFRESH_COOKIE } from "@/features/auth/cookies";

/**
 * 관리자 페이지 서버 가드. 인증이 없으면 로그인으로, ADMIN이 아니거나 탈퇴 계정이면 홈으로 돌린다.
 * DB에서 role을 새로 읽는다 — 토큰의 role은 stale일 수 있다(rbac와 동일 원칙).
 * 라우트 핸들러는 requireAdmin으로 별도 방어하므로 여기 통과가 데이터 접근을 뚫진 않는다.
 */
export async function requireAdminPage(): Promise<{ userId: string }> {
  const token = (await cookies()).get(REFRESH_COOKIE)?.value ?? null;
  const current = await currentUserFromRefresh(prisma, token);
  if (!current) redirect("/login?error=login_required");

  const user = await prisma.user.findUnique({
    where: { id: current.userId },
    select: { role: true, deletedAt: true },
  });
  if (!user || user.deletedAt || user.role !== "ADMIN") redirect("/");

  return { userId: current.userId };
}
