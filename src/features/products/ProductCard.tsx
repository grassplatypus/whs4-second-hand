"use client";

import { useTranslations } from "next-intl";

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

export function ProductCard({ product }: { product: ProductCardView }) {
  const t = useTranslations("product");
  const priceLabel = product.price === 0 ? t("free") : `${product.price.toLocaleString()}${t("won")}`;

  return (
    <a
      href={`/products/${product.id}`}
      className="flex flex-col gap-1 rounded border p-2 hover:shadow"
    >
      <div className="flex aspect-square w-full items-center justify-center overflow-hidden rounded bg-zinc-100">
        {product.thumbnail ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={`/api/media/${product.thumbnail}`}
            alt={product.title}
            className="h-full w-full object-cover"
          />
        ) : (
          <span className="text-xs text-zinc-400">{t("noImage")}</span>
        )}
      </div>
      <span className="text-sm font-medium">{product.title}</span>
      <span className="text-sm">{priceLabel}</span>
      <div className="flex flex-wrap items-center gap-1 text-xs text-zinc-500">
        <span>{t(`status.${product.status}`)}</span>
        {product.regionLabel && <span>{product.regionLabel}</span>}
        {product.distanceKm != null && (
          <span>
            {Math.round(product.distanceKm * 10) / 10} {t("km")}
          </span>
        )}
      </div>
    </a>
  );
}
