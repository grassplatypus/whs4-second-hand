import { getTranslations } from "next-intl/server";
import { PageContainer, PageHeader } from "@/features/shell/ui";
import { ProductList } from "@/features/products/ProductList";

// 공개 페이지 — 인증 불필요. 초기 목록은 ProductList가 클라이언트에서 조회한다.
export default async function ProductsPage() {
  const t = await getTranslations("product");

  return (
    <PageContainer size="lg">
      <PageHeader title={t("listTitle")} />
      <ProductList />
    </PageContainer>
  );
}
