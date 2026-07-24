import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { prisma } from "@/features/_shared/prisma";
import { currentUserFromRefresh } from "@/features/auth/session";
import { REFRESH_COOKIE } from "@/features/auth/cookies";
import { PageContainer } from "@/features/shell/ui";
import { ProductForm } from "@/features/products/ProductForm";

// 로그인 가드 — 활성 사용자 여부(정지 등)는 실제 등록 요청 시 API(requireActiveUser)가 최종 판단한다.
export default async function NewProductPage() {
  const token = (await cookies()).get(REFRESH_COOKIE)?.value ?? null;
  const current = await currentUserFromRefresh(prisma, token);
  if (!current) redirect("/login?error=login_required");

  // 동네가 없으면 서버(createProduct)가 NO_LOCATION으로 막지만, 폼을 채우기 전에 미리 안내한다.
  const seller = await prisma.user.findUnique({
    where: { id: current.userId },
    select: { lat: true, lng: true },
  });
  const hasLocation = seller?.lat != null && seller?.lng != null;

  return (
    <PageContainer className="items-center">
      <ProductForm mode="create" hasLocation={hasLocation} />
    </PageContainer>
  );
}
