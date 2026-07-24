import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { getSessionUser } from "@/features/shell/getSessionUser";
import { redirect } from "next/navigation";

export default async function SettingsHubPage() {
  const t = await getTranslations("settings");
  const user = await getSessionUser();
  if (!user) redirect("/login?error=login_required");

  const items = [
    { href: "/settings/location", icon: "📍", key: "location" },
    { href: "/settings/phone", icon: "📱", key: "phone" },
    { href: "/settings/security", icon: "🔐", key: "security" },
    { href: "/settings/connections", icon: "🔗", key: "connections" },
    { href: "/mypage#account-management", icon: "👤", key: "account" },
  ] as const;

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 px-4 py-10">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">{t("title")}</h1>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">{t("subtitle")}</p>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {items.map((it) => (
          <Link
            key={it.href}
            href={it.href}
            className="flex items-start gap-3 rounded-xl border border-zinc-200 bg-white p-4 transition-shadow hover:shadow-md dark:border-zinc-800 dark:bg-zinc-900"
          >
            <span className="text-2xl">{it.icon}</span>
            <span className="flex flex-col">
              <span className="font-semibold text-zinc-900 dark:text-zinc-100">{t(it.key)}</span>
              <span className="text-xs text-zinc-500 dark:text-zinc-400">{t(`${it.key}Desc`)}</span>
            </span>
          </Link>
        ))}
      </div>
    </main>
  );
}
