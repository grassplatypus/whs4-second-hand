import { getTranslations } from "next-intl/server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { prisma } from "@/features/_shared/prisma";
import { currentUserFromRefresh } from "@/features/auth/session";
import { REFRESH_COOKIE } from "@/features/auth/cookies";
import { PhoneVerify } from "@/features/location/PhoneVerify";

export default async function PhonePage() {
  const t = await getTranslations("phone");
  const token = (await cookies()).get(REFRESH_COOKIE)?.value ?? null;
  const current = await currentUserFromRefresh(prisma, token);
  if (!current) redirect("/login?error=login_required");

  const user = await prisma.user.findUnique({
    where: { id: current.userId },
    select: { phoneVerifiedAt: true },
  });

  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-6 py-12">
      <h1 className="text-2xl font-semibold">{t("title")}</h1>
      <PhoneVerify initialVerified={Boolean(user?.phoneVerifiedAt)} />
    </main>
  );
}
