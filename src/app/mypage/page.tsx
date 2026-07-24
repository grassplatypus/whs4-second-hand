import { getTranslations } from "next-intl/server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { prisma } from "@/features/_shared/prisma";
import { currentUserFromRefresh } from "@/features/auth/session";
import { REFRESH_COOKIE } from "@/features/auth/cookies";
import { PageContainer, PageHeader } from "@/features/shell/ui";
import { getMyProfile, getPurchasedProducts } from "@/features/profile/service";
import { MyPage } from "@/features/profile/MyPage";
import { PurchasedList } from "@/features/profile/PurchasedList";
import { PasswordForm } from "@/features/profile/PasswordForm";
import { NicknameForm } from "@/features/profile/NicknameForm";
import { WithdrawForm } from "@/features/profile/WithdrawForm";

export default async function MyPagePage() {
  const t = await getTranslations("profile");
  const token = (await cookies()).get(REFRESH_COOKIE)?.value ?? null;
  const current = await currentUserFromRefresh(prisma, token);
  if (!current) redirect("/login?error=login_required");

  const [profile, purchased] = await Promise.all([
    getMyProfile(prisma, current.userId),
    getPurchasedProducts(prisma, current.userId),
  ]);

  return (
    <PageContainer>
      <PageHeader title={t("mypageTitle")} />
      <MyPage initialProfile={{ ...profile, createdAt: profile.createdAt.toISOString() }} />

      <PurchasedList items={purchased} />

      <section id="account-management" className="flex flex-col gap-6 border-t border-zinc-200 pt-8 dark:border-zinc-800">
        <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">{t("accountManagement")}</h2>
        <PasswordForm hasPassword={profile.hasPassword} />
        <NicknameForm initialNickname={profile.nickname} />
        <WithdrawForm />
      </section>
    </PageContainer>
  );
}
