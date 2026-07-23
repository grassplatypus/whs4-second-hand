import { getTranslations } from "next-intl/server";
import { LoginForm } from "@/features/auth/LoginForm";

export default async function LoginPage() {
  const t = await getTranslations("auth");
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-6 py-12">
      <h1 className="text-2xl font-semibold">{t("loginTitle")}</h1>
      <LoginForm />
    </main>
  );
}
