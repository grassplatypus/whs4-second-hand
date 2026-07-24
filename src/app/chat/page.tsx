import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { prisma } from "@/features/_shared/prisma";
import { currentUserFromRefresh } from "@/features/auth/session";
import { REFRESH_COOKIE } from "@/features/auth/cookies";
import { ChatList } from "@/features/chat/ChatList";

// 로그인한 사용자만 — 자기 대화 목록만 보여준다(ChatList가 인증 세션으로 GET /api/chat/conversations를 부른다).
export default async function ChatListPage() {
  const token = (await cookies()).get(REFRESH_COOKIE)?.value ?? null;
  const current = await currentUserFromRefresh(prisma, token);
  if (!current) redirect("/login?error=login_required");

  return (
    <main className="flex flex-1 flex-col items-center py-12">
      <ChatList />
    </main>
  );
}
