import { getTranslations } from "next-intl/server";
import { LoginForm } from "@/features/auth/LoginForm";

// OAuth 콜백/시작 라우트가 붙이는 error 슬러그 → auth.oauth 카탈로그 키
const ERROR_KEYS: Record<string, string> = {
  email_exists: "emailExists",
  login_required: "loginRequired",
  oauth_failed: "failed",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const t = await getTranslations("auth");
  const tOauth = await getTranslations("auth.oauth");
  const { error } = await searchParams;
  const errorSlug = Array.isArray(error) ? error[0] : error;
  const key = errorSlug ? ERROR_KEYS[errorSlug] : undefined;
  const oauthError = key ? tOauth(key) : undefined;

  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-6 py-12">
      <h1 className="text-2xl font-semibold">{t("loginTitle")}</h1>
      <LoginForm oauthError={oauthError} />
    </main>
  );
}
