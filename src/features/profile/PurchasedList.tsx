"use client";

import { useTranslations } from "next-intl";
import { EmptyState } from "@/features/shell/ui";
import { ProductCard, type ProductCardView } from "@/features/products/ProductCard";

/**
 * GET이 아니라 서버 컴포넌트(mypage/page.tsx)가 getPurchasedProducts로 직접 조회해 내려주는
 * 안전한 부분집합과 같은 모양이다. 구매 이력은 철저히 본인 전용 — 공개 프로필에는 절대 쓰지 않는다.
 */
export interface PurchasedProductView {
  id: string;
  title: string;
  price: number;
  category: string;
  status: string;
  thumbnail: string | null;
  regionLabel: string | null;
}

function toCardView(p: PurchasedProductView): ProductCardView {
  return { ...p, distanceKm: null };
}

export function PurchasedList({ items }: { items: PurchasedProductView[] }) {
  const t = useTranslations("profile");

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">{t("purchasedListings")}</h2>
      {items.length > 0 ? (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
          {items.map((p) => (
            <ProductCard key={p.id} product={toCardView(p)} />
          ))}
        </div>
      ) : (
        <EmptyState icon="📦" title={t("noPurchasedListings")} />
      )}
    </section>
  );
}
