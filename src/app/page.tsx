import { getTranslations } from "next-intl/server";
import { prisma } from "@/features/_shared/prisma";
import { checkHealth } from "@/features/_shared/health";
import { HealthStatus } from "@/features/health/HealthStatus";
import { LocaleToggle } from "@/features/health/LocaleToggle";

export default async function Home() {
  const t = await getTranslations("health");
  const health = await checkHealth(prisma).catch(() => ({ db: false }));

  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-4 bg-zinc-50 font-sans dark:bg-black">
      <h1 className="text-3xl font-semibold tracking-tight text-black dark:text-zinc-50">
        {t("title")}
      </h1>
      <HealthStatus db={health.db} />
      <LocaleToggle />
    </main>
  );
}
