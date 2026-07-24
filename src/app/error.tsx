"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";

export default function Error({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const t = useTranslations("errors");
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-4 px-4 py-24 text-center">
      <span className="text-5xl">😵</span>
      <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">{t("errorTitle")}</h1>
      <p className="text-sm text-zinc-500 dark:text-zinc-400">{t("errorBody")}</p>
      <div className="mt-2 flex gap-2">
        <button
          type="button"
          onClick={() => reset()}
          className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700"
        >
          {t("retry")}
        </button>
        <Link href="/" className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-semibold text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-900">
          {t("goHome")}
        </Link>
      </div>
    </main>
  );
}
