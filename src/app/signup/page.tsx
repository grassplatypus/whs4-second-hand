import { getTranslations } from "next-intl/server";
import { SignupForm } from "@/features/auth/SignupForm";

export default async function SignupPage() {
  const t = await getTranslations("auth");
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-6 py-12">
      <h1 className="text-2xl font-semibold">{t("signupTitle")}</h1>
      <SignupForm />
    </main>
  );
}
