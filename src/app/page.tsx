import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { prisma } from "@/features/_shared/prisma";
import { searchProducts } from "@/features/products/search";
import { ProductCard } from "@/features/products/ProductCard";
import { getSessionUser } from "@/features/shell/getSessionUser";

export default async function Home() {
  const t = await getTranslations("home");
  const user = await getSessionUser();
  const { items } = await searchProducts(prisma, { limit: 8 }).catch(() => ({ items: [] }));

  return (
    <main className="flex flex-1 flex-col">
      {/* 히어로 */}
      <section className="border-b border-zinc-200 bg-gradient-to-b from-emerald-50 to-zinc-50 dark:border-zinc-800 dark:from-emerald-950/30 dark:to-zinc-950">
        <div className="mx-auto flex max-w-5xl flex-col items-center gap-6 px-4 py-16 text-center sm:py-24">
          <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300">
            {t("badge")}
          </span>
          <h1 className="text-4xl font-bold tracking-tight text-zinc-900 sm:text-5xl dark:text-zinc-50">
            {t("title")}
          </h1>
          <p className="max-w-xl text-lg text-zinc-600 dark:text-zinc-400">{t("subtitle")}</p>
          <div className="flex flex-wrap items-center justify-center gap-3">
            <Link
              href="/products"
              className="rounded-lg bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-emerald-700"
            >
              {t("ctaBrowse")}
            </Link>
            {user ? (
              <Link
                href="/products/new"
                className="rounded-lg border border-zinc-300 bg-white px-5 py-2.5 text-sm font-semibold text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200"
              >
                {t("ctaSell")}
              </Link>
            ) : (
              <Link
                href="/signup"
                className="rounded-lg border border-zinc-300 bg-white px-5 py-2.5 text-sm font-semibold text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200"
              >
                {t("ctaStart")}
              </Link>
            )}
          </div>
        </div>
      </section>

      {/* 특징 */}
      <section className="mx-auto grid w-full max-w-5xl grid-cols-1 gap-4 px-4 py-10 sm:grid-cols-3">
        {(["featLocation", "featEscrow", "featChat"] as const).map((k) => (
          <div key={k} className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
            <div className="mb-2 text-2xl">{t(`${k}.icon`)}</div>
            <h3 className="font-semibold text-zinc-900 dark:text-zinc-100">{t(`${k}.title`)}</h3>
            <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">{t(`${k}.desc`)}</p>
          </div>
        ))}
      </section>

      {/* 최근 상품 */}
      <section className="mx-auto w-full max-w-5xl px-4 pb-16">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-xl font-bold text-zinc-900 dark:text-zinc-100">{t("recent")}</h2>
          <Link href="/products" className="text-sm font-medium text-emerald-700 hover:underline dark:text-emerald-400">
            {t("seeAll")} →
          </Link>
        </div>
        {items.length === 0 ? (
          <p className="rounded-xl border border-dashed border-zinc-300 py-12 text-center text-sm text-zinc-500 dark:border-zinc-700">
            {t("empty")}
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {items.map((p) => (
              <ProductCard key={p.id} product={p} />
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
