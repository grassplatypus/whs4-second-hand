import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { prisma } from "@/features/_shared/prisma";
import { currentUserFromRefresh } from "@/features/auth/session";
import { REFRESH_COOKIE } from "@/features/auth/cookies";
import { PageContainer } from "@/features/shell/ui";
import { EscrowRoom } from "@/features/escrow/EscrowRoom";

/**
 * 로그인한 사용자만. 참여자 격리(제3자 403/404)는 서비스가 GET /api/escrow/[id]에서 강제하므로,
 * 이 페이지는 인증만 확인하고 escrowId를 클라이언트 컴포넌트로 넘긴다.
 */
export default async function EscrowRoomPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const token = (await cookies()).get(REFRESH_COOKIE)?.value ?? null;
  const current = await currentUserFromRefresh(prisma, token);
  if (!current) redirect("/login?error=login_required");

  return (
    <PageContainer className="items-center">
      <EscrowRoom escrowId={id} />
    </PageContainer>
  );
}
