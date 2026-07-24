import { getTranslations } from "next-intl/server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { prisma } from "@/features/_shared/prisma";
import { currentUserFromRefresh } from "@/features/auth/session";
import { REFRESH_COOKIE } from "@/features/auth/cookies";
import { decryptPII } from "@/features/_shared/crypto";
import { LocationSettings } from "@/features/location/LocationSettings";

export default async function LocationPage() {
  const t = await getTranslations("location");
  const token = (await cookies()).get(REFRESH_COOKIE)?.value ?? null;
  const current = await currentUserFromRefresh(prisma, token);
  if (!current) redirect("/login?error=login_required");

  // 좌표(lat/lng)는 절대 조회하지 않는다 — 동네 문자열만 복호화해서 보여준다.
  const user = await prisma.user.findUnique({
    where: { id: current.userId },
    select: { regionCiphertext: true },
  });
  const region = user?.regionCiphertext ? decryptPII(user.regionCiphertext) : null;

  return (
    <main className="flex flex-1 flex-col items-center gap-6 px-4 py-12">
      <h1 className="text-2xl font-semibold">{t("title")}</h1>
      <LocationSettings initialRegion={region} />
    </main>
  );
}
