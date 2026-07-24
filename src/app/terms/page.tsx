import Link from "next/link";
import { getTranslations } from "next-intl/server";

export default async function TermsPage() {
  const t = await getTranslations("terms");
  const sections = ["s1", "s2", "s3", "s4", "s5", "s6"] as const;
  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-10">
      <h1 className="mb-6 text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">{t("title")}</h1>
      <div className="flex flex-col gap-6">
        {sections.map((s) => (
          <section key={s}>
            <h2 className="mb-1 font-semibold text-zinc-900 dark:text-zinc-100">{t(`${s}Title`)}</h2>
            <p className="text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">{t(`${s}Body`)}</p>
          </section>
        ))}
      </div>
      <div className="mt-8">
        <Link href="/signup" className="text-sm font-medium text-emerald-700 hover:underline dark:text-emerald-400">
          ← {t("back")}
        </Link>
      </div>
    </main>
  );
}
