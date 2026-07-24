import { getTranslations } from "next-intl/server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { prisma } from "@/features/_shared/prisma";
import { currentUserFromRefresh } from "@/features/auth/session";
import { REFRESH_COOKIE } from "@/features/auth/cookies";
import { PageHeader } from "@/features/shell/ui";
import { getMyProfile } from "@/features/profile/service";
import { MyPage } from "@/features/profile/MyPage";
import { PasswordForm } from "@/features/profile/PasswordForm";
import { NicknameForm } from "@/features/profile/NicknameForm";
import { WithdrawForm } from "@/features/profile/WithdrawForm";

export default async function MyPagePage() {
  const t = await getTranslations("profile");
  const token = (await cookies()).get(REFRESH_COOKIE)?.value ?? null;
  const current = await currentUserFromRefresh(prisma, token);
  if (!current) redirect("/login?error=login_required");

  const profile = await getMyProfile(prisma, current.userId);

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-8 px-4 py-12">
      <PageHeader title={t("mypageTitle")} />
      <MyPage initialProfile={{ ...profile, createdAt: profile.createdAt.toISOString() }} />

      <section id="account-management" className="flex flex-col gap-6 border-t border-zinc-200 pt-8 dark:border-zinc-800">
        <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">{t("accountManagement")}</h2>
        <PasswordForm hasPassword={profile.hasPassword} />
        <NicknameForm initialNickname={profile.nickname} />
        <WithdrawForm />
      </section>
    </main>
  );
}
