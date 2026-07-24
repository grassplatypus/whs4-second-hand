import { prisma } from "@/features/_shared/prisma";
import { withErrorHandling } from "@/features/_shared/error";
import { revokeSession } from "@/features/auth/session";
import { readRefreshCookie, clearRefreshCookie } from "@/features/auth/cookies";
import { requestMeta } from "@/features/auth/audit";
import { clearStepUpCookie } from "@/features/auth/twofactor/stepup";
import { clearChallengeCookie } from "@/features/auth/twofactor/challenge";

export const POST = withErrorHandling(async (req: Request) => {
  await revokeSession(prisma, readRefreshCookie(req), requestMeta(req));
  const res = Response.json({ ok: true }, { headers: { "set-cookie": clearRefreshCookie() } });
  // 로그아웃 후에도 step_up/2fa_challenge 쿠키가 남아있으면 공유 브라우저에서
  // 다른 사용자의 세션이 이전 사용자의 재인증 상태를 물려받을 수 있다 — 함께 지운다.
  res.headers.append("set-cookie", clearStepUpCookie());
  res.headers.append("set-cookie", clearChallengeCookie());
  return res;
});
