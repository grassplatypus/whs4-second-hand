import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { prisma } from "@/features/_shared/prisma";
import { currentUserFromRefresh } from "@/features/auth/session";
import { REFRESH_COOKIE } from "@/features/auth/cookies";
import { PageContainer, PageHeader } from "@/features/shell/ui";
import { listOwnProducts } from "@/features/products/service";
import { MyProductList } from "@/features/products/MyProductList";

// 로그인 가드 — 판매자 본인의 전체 상품(숨김 포함)만 보여준다. 숨긴 상품에 다시 접근해
// 복원할 수 있는 유일한 화면(공개 목록/상세는 숨긴 상품을 절대 보여주지 않는다).
export default async function MyProductsPage() {
  const t = await getTranslations("product");

  const token = (await cookies()).get(REFRESH_COOKIE)?.value ?? null;
  const current = await currentUserFromRefresh(prisma, token);
  if (!current) redirect("/login?error=login_required");

  const items = await listOwnProducts(prisma, current.userId);
  // Date는 서버→클라이언트 컴포넌트 경계에서 문자열로 넘긴다(직렬화 모호함을 피한다).
  const view = items.map((p) => ({ ...p, createdAt: p.createdAt.toISOString() }));

  return (
    <PageContainer size="lg" className="items-center">
      <PageHeader title={t("myListingsTitle")} />
      <MyProductList initialItems={view} />
    </PageContainer>
  );
}
