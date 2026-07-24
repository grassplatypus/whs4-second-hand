import { getTranslations } from "next-intl/server";
import { AuthShell } from "@/features/shell/ui";
import { SignupForm } from "@/features/auth/SignupForm";

export default async function SignupPage() {
  const t = await getTranslations("auth");
  return (
    <AuthShell title={t("signupTitle")} subtitle={t("signupSubtitle")}>
      <SignupForm />
    </AuthShell>
  );
}
