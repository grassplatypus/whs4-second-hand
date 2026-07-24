import { getTranslations } from "next-intl/server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { prisma } from "@/features/_shared/prisma";
import { currentUserFromRefresh } from "@/features/auth/session";
import { REFRESH_COOKIE } from "@/features/auth/cookies";
import { ConnectionsManager } from "@/features/auth/ConnectionsManager";

// OAuth 콜백 라우트가 붙이는 error 슬러그 → auth.oauth 카탈로그 키
const ERROR_KEYS: Record<string, string> = {
  identity_taken: "identityTaken",
  oauth_failed: "failed",
};

export default async function ConnectionsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const t = await getTranslations("auth.oauth");
  const token = (await cookies()).get(REFRESH_COOKIE)?.value ?? null;
  const current = await currentUserFromRefresh(prisma, token);
  if (!current) redirect("/login?error=login_required");

  const identities = await prisma.authIdentity.findMany({
    where: { userId: current.userId },
    select: { provider: true },
  });

  const { error } = await searchParams;
  const errorSlug = Array.isArray(error) ? error[0] : error;
  const key = errorSlug ? ERROR_KEYS[errorSlug] : undefined;
  const initialError = key ? t(key) : undefined;

  return (
    <main className="flex flex-1 flex-col items-center gap-6 px-4 py-12">
      <h1 className="text-2xl font-semibold">{t("connections")}</h1>
      <ConnectionsManager connected={identities.map((i) => i.provider)} initialError={initialError} />
    </main>
  );
}
