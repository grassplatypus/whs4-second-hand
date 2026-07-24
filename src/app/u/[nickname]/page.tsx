import { notFound } from "next/navigation";
import { prisma } from "@/features/_shared/prisma";
import { AppError } from "@/features/_shared/error";
import { getPublicProfileWithProducts } from "@/features/profile/service";
import { PublicProfile } from "@/features/profile/PublicProfile";

export default async function PublicProfilePage({
  params,
}: {
  params: Promise<{ nickname: string }>;
}) {
  const { nickname } = await params;

  let result;
  try {
    result = await getPublicProfileWithProducts(prisma, nickname);
  } catch (err) {
    // 없거나 탈퇴(soft delete)한 계정 모두 동일하게 404 — 존재 여부를 구분하지 않는다.
    if (err instanceof AppError && err.code === "NOT_FOUND") notFound();
    throw err;
  }

  const { profile, active, sold } = result;

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col items-center gap-6 px-4 py-12">
      <PublicProfile profile={{ ...profile, createdAt: profile.createdAt.toISOString(), active, sold }} />
    </main>
  );
}
