import { getTranslations } from "next-intl/server";
import { TwoFactorChallenge } from "@/features/auth/TwoFactorChallenge";

// challenge 쿠키(HttpOnly)가 로그인 라우트에서 이미 심어졌다고 전제한다 — 여기서는
// 읽거나 검증하지 않는다(서버 컴포넌트는 얇게, 검증은 /2fa/verify-login이 담당).
export default async function TwoFactorChallengePage() {
  const t = await getTranslations("auth.twofactor");

  return (
    <main className="flex flex-1 flex-col items-center gap-6 px-4 py-12">
      <h1 className="text-2xl font-semibold">{t("challengeTitle")}</h1>
      <TwoFactorChallenge />
    </main>
  );
}
