import { getTranslations } from "next-intl/server";
import { ProductList } from "@/features/products/ProductList";

// 공개 페이지 — 인증 불필요. 초기 목록은 ProductList가 클라이언트에서 조회한다.
export default async function ProductsPage() {
  const t = await getTranslations("product");

  return (
    <main className="flex flex-1 flex-col items-center gap-6 py-12">
      <h1 className="text-2xl font-semibold">{t("listTitle")}</h1>
      <ProductList />
    </main>
  );
}
