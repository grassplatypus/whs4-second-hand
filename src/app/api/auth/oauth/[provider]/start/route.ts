import { randomUUID } from "node:crypto";
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
    // 데모: 실 OAuth가 없어 신원은 목 힌트에서 파생된다. UI 클릭엔 mock_as가 없으므로 요청마다
    // 고유 힌트를 부여해 매 소셜 로그인/연결이 별개 신원이 되게 한다 — 공유된 고정 신원이
    // "이미 다른 계정에 연결됨" 충돌을 일으키던 문제를 없앤다. (E2E는 명시 mock_as를 넘겨 무영향.)
    const mockHint = url.searchParams.get("mock_as") ?? `demo-${randomUUID()}`;

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
