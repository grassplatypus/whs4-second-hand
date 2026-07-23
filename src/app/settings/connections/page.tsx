import { getTranslations } from "next-intl/server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { prisma } from "@/features/_shared/prisma";
import { currentUserFromRefresh } from "@/features/auth/session";
import { REFRESH_COOKIE } from "@/features/auth/cookies";
import { ConnectionsManager } from "@/features/auth/ConnectionsManager";

export default async function ConnectionsPage() {
  const t = await getTranslations("auth.oauth");
  const token = (await cookies()).get(REFRESH_COOKIE)?.value ?? null;
  const current = await currentUserFromRefresh(prisma, token);
  if (!current) redirect("/login?error=login_required");

  const identities = await prisma.authIdentity.findMany({
    where: { userId: current.userId },
    select: { provider: true },
  });

  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-6 py-12">
      <h1 className="text-2xl font-semibold">{t("connections")}</h1>
      <ConnectionsManager connected={identities.map((i) => i.provider)} />
    </main>
  );
}
