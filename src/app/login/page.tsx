import { getTranslations } from "next-intl/server";
import { AuthShell } from "@/features/shell/ui";
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
  const { error, signup } = await searchParams;
  const errorSlug = Array.isArray(error) ? error[0] : error;
  const key = errorSlug ? ERROR_KEYS[errorSlug] : undefined;
  const oauthError = key ? tOauth(key) : undefined;
  const signupDone = (Array.isArray(signup) ? signup[0] : signup) === "done";

  return (
    <AuthShell title={t("loginTitle")} subtitle={t("loginSubtitle")}>
      {signupDone && (
        <p role="status" className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
          {t("signupDone")}
        </p>
      )}
      <LoginForm oauthError={oauthError} />
    </AuthShell>
  );
}
