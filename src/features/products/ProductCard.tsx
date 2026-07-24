"use client";

import { useTranslations, useFormatter } from "next-intl";

/**
 * GET /api/products가 내려주는 카드 안전 부분집합과 정확히 같은 모양이다.
 * 판매자 정보(닉네임 포함 그 무엇도)와 정확 좌표는 API 응답에도 없고 이 타입에도 없다 —
 * 여기서 절대 그런 필드를 추가하거나 다른 곳에서 가져와 표시하지 않는다.
 */
export interface ProductCardView {
  id: string;
  title: string;
  price: number;
  category: string;
  status: string;
  thumbnail: string | null;
  regionLabel: string | null;
  distanceKm: number | null;
}

const STATUS_STYLE: Record<string, string> = {
  SELLING: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300",
  RESERVED: "bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-300",
  SOLD: "bg-zinc-200 text-zinc-600 dark:bg-zinc-700 dark:text-zinc-300",
};

const SAMPLE_CATEGORIES = new Set([
  "DIGITAL", "APPLIANCE", "FURNITURE", "CLOTHING", "BOOK", "BEAUTY", "SPORTS", "ETC",
]);

export function ProductCard({ product }: { product: ProductCardView }) {
  const t = useTranslations("product");
  const format = useFormatter();
  const priceLabel = product.price === 0 ? t("free") : `${format.number(product.price)}${t("won")}`;
  // 실제 업로드 이미지가 있으면 그걸, 없으면 카테고리 예시 이미지(public/samples)를 폴백으로 쓴다.
  const imgSrc = product.thumbnail
    ? `/api/media/${product.thumbnail}`
    : SAMPLE_CATEGORIES.has(product.category)
      ? `/samples/${product.category}.webp`
      : null;

  return (
    <a
      href={`/products/${product.id}`}
      className="group flex flex-col overflow-hidden rounded-xl border border-zinc-200 bg-white transition-shadow hover:shadow-md dark:border-zinc-800 dark:bg-zinc-900"
    >
      <div className="relative flex aspect-square w-full items-center justify-center overflow-hidden bg-zinc-100 dark:bg-zinc-800">
        {imgSrc ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={imgSrc}
            alt={product.title}
            className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-105"
          />
        ) : (
          <span className="text-xs text-zinc-400">{t("noImage")}</span>
        )}
        <span
          className={`absolute left-2 top-2 rounded-full px-2 py-0.5 text-xs font-semibold ${
            STATUS_STYLE[product.status] ?? "bg-zinc-200 text-zinc-600"
          }`}
        >
          {t(`status.${product.status}`)}
        </span>
      </div>
      <div className="flex flex-col gap-1 p-3">
        <span className="line-clamp-1 text-sm font-medium text-zinc-900 dark:text-zinc-100">{product.title}</span>
        <span className="text-base font-bold text-zinc-900 dark:text-zinc-50">{priceLabel}</span>
        <div className="flex flex-wrap items-center gap-x-2 text-xs text-zinc-500">
          {product.regionLabel && <span>{product.regionLabel}</span>}
          {product.distanceKm != null && (
            <span>{Math.round(product.distanceKm * 10) / 10} {t("km")}</span>
          )}
        </div>
      </div>
    </a>
  );
}
