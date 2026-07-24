import { notFound, redirect } from "next/navigation";
import { cookies } from "next/headers";
import { prisma } from "@/features/_shared/prisma";
import { currentUserFromRefresh } from "@/features/auth/session";
import { REFRESH_COOKIE } from "@/features/auth/cookies";
import { getChatRepo } from "@/features/chat/repo";
import { ChatRoom } from "@/features/chat/ChatRoom";

/**
 * 참여자 격리는 서비스(listMessages 등)가 API 레벨에서도 강제하지만, 이 페이지는 렌더 전에
 * repo.getConversation으로 먼저 확인한다 — 제3자는 대화 존재 여부조차 알 수 없도록 404로 숨긴다.
 * chat/service.ts(백엔드)는 건드리지 않고 이미 노출된 repo 접근자만 사용한다.
 *
 * 상대의 원본 userId(otherId)는 클라이언트로 절대 넘기지 않는다(G8) — 닉네임만 조회해서 넘기고,
 * 차단/신고는 ChatRoom이 conversationId로 서버에 요청해 서버가 상대를 계산한다.
 */
export default async function ChatRoomPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const token = (await cookies()).get(REFRESH_COOKIE)?.value ?? null;
  const current = await currentUserFromRefresh(prisma, token);
  if (!current) redirect("/login?error=login_required");

  const conversation = await getChatRepo().getConversation(id);
  if (!conversation || (conversation.buyerId !== current.userId && conversation.sellerId !== current.userId)) {
    notFound();
  }

  const otherId = conversation.buyerId === current.userId ? conversation.sellerId : conversation.buyerId;
  const [other, product, blockedByMe, blockedByOther] = await Promise.all([
    prisma.user.findUnique({ where: { id: otherId }, select: { nickname: true } }),
    prisma.product.findFirst({ where: { id: conversation.productId }, select: { title: true } }),
    getChatRepo().isBlocked(current.userId, otherId),
    getChatRepo().isBlocked(otherId, current.userId),
  ]);

  return (
    <main className="flex flex-1 flex-col items-center py-12">
      <ChatRoom
        conversationId={conversation._id}
        otherNickname={other?.nickname ?? ""}
        productId={conversation.productId}
        productTitle={product?.title}
        initialBlocked={blockedByMe}
        blockedByOther={blockedByOther}
      />
    </main>
  );
}
