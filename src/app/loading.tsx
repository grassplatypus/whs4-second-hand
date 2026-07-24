import { getTranslations } from "next-intl/server";

export default async function Loading() {
  const t = await getTranslations("common");
  return (
    <main className="flex flex-1 items-center justify-center py-24" aria-busy="true" aria-live="polite">
      <span className="h-8 w-8 animate-spin rounded-full border-2 border-zinc-300 border-t-emerald-600" />
      <span className="sr-only">{t("loading")}</span>
    </main>
  );
}
