import { notFound } from "next/navigation";
import { prisma } from "@/features/_shared/prisma";
import { AppError } from "@/features/_shared/error";
import { PageContainer } from "@/features/shell/ui";
import { getPublicProfileWithProducts, getReceivedReviews } from "@/features/profile/service";
import { PublicProfile } from "@/features/profile/PublicProfile";

export default async function PublicProfilePage({
  params,
}: {
  params: Promise<{ nickname: string }>;
}) {
  const { nickname } = await params;

  let result;
  let reviews;
  try {
    [result, reviews] = await Promise.all([
      getPublicProfileWithProducts(prisma, nickname),
      getReceivedReviews(prisma, nickname),
    ]);
  } catch (err) {
    // 없거나 탈퇴(soft delete)한 계정 모두 동일하게 404 — 존재 여부를 구분하지 않는다.
    if (err instanceof AppError && err.code === "NOT_FOUND") notFound();
    throw err;
  }

  const { profile, active, sold } = result;

  return (
    <PageContainer className="items-center">
      <PublicProfile
        profile={{
          ...profile,
          createdAt: profile.createdAt.toISOString(),
          active,
          sold,
          reviews: {
            summary: reviews.summary,
            items: reviews.items.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() })),
          },
        }}
      />
    </PageContainer>
  );
}
