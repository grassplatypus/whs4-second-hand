import { cookies } from "next/headers";
import { prisma } from "@/features/_shared/prisma";
import { currentUserFromRefresh } from "@/features/auth/session";
import { REFRESH_COOKIE } from "@/features/auth/cookies";

export interface SessionUser {
  userId: string;
  nickname: string;
  role: "USER" | "SUSPENDED" | "ADMIN";
}

/**
 * 서버 컴포넌트(레이아웃·페이지)에서 현재 로그인 사용자를 얻는다.
 * 네비게이션 표시용 — 닉네임·role만. 이메일/전화 등 PII는 조회하지 않는다.
 * 미로그인·정지·탈퇴면 null.
 */
export async function getSessionUser(): Promise<SessionUser | null> {
  const token = (await cookies()).get(REFRESH_COOKIE)?.value ?? null;
  const current = await currentUserFromRefresh(prisma, token).catch(() => null);
  if (!current) return null;
  const user = await prisma.user.findUnique({
    where: { id: current.userId },
    select: { nickname: true, role: true, deletedAt: true },
  });
  if (!user || user.deletedAt || user.role === "SUSPENDED") return null;
  return { userId: current.userId, nickname: user.nickname, role: user.role as SessionUser["role"] };
}
