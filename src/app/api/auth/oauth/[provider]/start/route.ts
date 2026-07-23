import { NextResponse } from "next/server";
import { getEnv } from "@/features/_shared/env";
import { prisma } from "@/features/_shared/prisma";
import { getAdapter } from "@/features/auth/oauth/provider";
import { signState, stateCookie } from "@/features/auth/oauth/state";
import { currentUserFromRefresh } from "@/features/auth/session";
import { readRefreshCookie } from "@/features/auth/cookies";

// 리다이렉트 기반이라 withErrorHandling(JSON) 대신 자체 try/catch로 실패를 리다이렉트로 변환한다.
export async function GET(req: Request, ctx: { params: Promise<{ provider: string }> }) {
  const base = getEnv().APP_BASE_URL;
  try {
    const { provider } = await ctx.params;
    const adapter = getAdapter(provider); // 미지원 provider → AppError → catch
    const url = new URL(req.url);
    const link = url.searchParams.get("link") === "1";
    const mockHint = url.searchParams.get("mock_as") ?? undefined;

    let userId: string | undefined;
    if (link) {
      const current = await currentUserFromRefresh(prisma, readRefreshCookie(req));
      if (!current) return NextResponse.redirect(`${base}/login?error=login_required`);
      userId = current.userId;
    }

    const state = signState({ mode: link ? "link" : "login", provider: adapter.provider, userId });
    const res = NextResponse.redirect(adapter.authorizeUrl(state, mockHint));
    res.headers.append("set-cookie", stateCookie(state));
    return res;
  } catch {
    return NextResponse.redirect(`${base}/login?error=oauth_failed`);
  }
}
