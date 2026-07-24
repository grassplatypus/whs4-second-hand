import { NextResponse } from "next/server";
import { AppError } from "@/features/_shared/error";
import { getEnv } from "@/features/_shared/env";
import { prisma } from "@/features/_shared/prisma";
import { getAdapter } from "@/features/auth/oauth/provider";
import { verifyState, readStateCookie, clearStateCookie } from "@/features/auth/oauth/state";
import { loginOrRegisterWithOAuth, linkIdentity } from "@/features/auth/oauth/link";
import { refreshCookie } from "@/features/auth/cookies";
import { requestMeta } from "@/features/auth/audit";
import { signChallenge, challengeCookie } from "@/features/auth/twofactor/challenge";

// AppError.code → 리다이렉트 쿼리(사용자에게 코드만 노출, 카탈로그가 문자열 매핑)
const ERROR_QUERY: Record<string, string> = {
  OAUTH_EMAIL_EXISTS: "email_exists",
  IDENTITY_TAKEN: "identity_taken",
};

export async function GET(req: Request, ctx: { params: Promise<{ provider: string }> }) {
  const base = getEnv().APP_BASE_URL;
  let mode: "login" | "link" = "login";
  try {
    const { provider } = await ctx.params;
    const adapter = getAdapter(provider);
    const url = new URL(req.url);
    const code = url.searchParams.get("code");
    const rawState = url.searchParams.get("state");
    const cookieState = readStateCookie(req);

    // double-submit: 쿼리 state와 쿠키 state가 정확히 같아야 한다
    if (!code || !rawState || !cookieState || rawState !== cookieState) {
      return redirect(`${base}/login?error=oauth_failed`);
    }
    const state = verifyState(rawState, adapter.provider);
    if (!state) return redirect(`${base}/login?error=oauth_failed`);
    mode = state.mode;

    const info = await adapter.exchange(code);
    const meta = requestMeta(req);

    if (mode === "link") {
      if (!state.userId) return redirect(`${base}/login?error=login_required`);
      await linkIdentity(prisma, state.userId, adapter.provider, info, meta);
      return redirect(`${base}/settings/connections?linked=${provider}`);
    }

    const result = await loginOrRegisterWithOAuth(prisma, adapter.provider, info, meta);
    if ("twoFactorRequired" in result) {
      const token = await signChallenge(result.userId, result.method);
      const res = redirect(`${base}/login/2fa`);
      res.headers.append("set-cookie", challengeCookie(token));
      return res;
    }
    const res = redirect(`${base}/`);
    res.headers.append("set-cookie", refreshCookie(result.refreshToken, result.expiresAt));
    return res;
  } catch (err) {
    const q = err instanceof AppError ? (ERROR_QUERY[err.code] ?? "oauth_failed") : "oauth_failed";
    const target = mode === "link" ? "/settings/connections" : "/login";
    return redirect(`${base}${target}?error=${q}`);
  }
}

// 콜백은 성공·실패 모두 state 쿠키를 지운다(일회용).
function redirect(to: string): NextResponse {
  const res = NextResponse.redirect(to);
  res.headers.append("set-cookie", clearStateCookie());
  return res;
}
