"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { CATEGORIES } from "./categories";
import { ProductCard, type ProductCardView } from "./ProductCard";

interface SearchResult {
  items: ProductCardView[];
  nextCursor: string | null;
}

/**
 * 반경 검색용 좌표는 계정에 저장된 위치(coarsened)를 서버에서 절대 내려주지 않으므로,
 * 브라우저 Geolocation API로 그 순간만 얻어 이 검색 요청 하나에만 실어 보낸다.
 * 어디에도 저장하지 않고, 실패/거부 시에는 조용히 좌표 없이 검색을 계속한다(반경 필터는 무시됨).
 */
function getPosition(): Promise<{ lat: number; lng: number } | null> {
  return new Promise((resolve) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      resolve(null);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => resolve(null),
      { timeout: 3000 },
    );
  });
}

export function ProductList() {
  const t = useTranslations("product");

  const [q, setQ] = useState("");
  const [category, setCategory] = useState("");
  const [minPrice, setMinPrice] = useState("");
  const [maxPrice, setMaxPrice] = useState("");
  const [radiusKm, setRadiusKm] = useState("");

  const [items, setItems] = useState<ProductCardView[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const buildParams = useCallback(async (cursor?: string) => {
    const params = new URLSearchParams();
    if (q.trim()) params.set("q", q.trim());
    if (category) params.set("category", category);
    if (minPrice) params.set("minPrice", minPrice);
    if (maxPrice) params.set("maxPrice", maxPrice);
    if (radiusKm) {
      params.set("radiusKm", radiusKm);
      const pos = await getPosition();
      if (pos) {
        params.set("lat", String(pos.lat));
        params.set("lng", String(pos.lng));
      }
    }
    if (cursor) params.set("cursor", cursor);
    return params;
  }, [q, category, minPrice, maxPrice, radiusKm]);

  const runSearch = useCallback(
    async (cursor?: string) => {
      setLoading(true);
      setError(null);
      try {
        const params = await buildParams(cursor);
        const res = await fetch(`/api/products?${params.toString()}`);
        if (!res.ok) {
          setError(t("failed"));
          return;
        }
        const body = (await res.json()) as SearchResult;
        setItems((prev) => (cursor ? [...prev, ...body.items] : body.items));
        setNextCursor(body.nextCursor);
      } catch {
        setError(t("failed"));
      } finally {
        setLoading(false);
      }
    },
    [buildParams, t],
  );

  useEffect(() => {
    void runSearch();
    // 마운트 시 한 번만 기본 목록을 불러온다 — 검색 조건은 폼 제출로만 다시 조회한다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    void runSearch();
  }

  return (
    <div className="flex w-full max-w-4xl flex-col gap-6">
      <form onSubmit={onSubmit} className="flex flex-wrap items-end gap-3" noValidate>
        <label className="flex flex-col gap-1 text-sm">
          {t("searchLabel")}
          <input value={q} onChange={(e) => setQ(e.target.value)} className="rounded border px-2 py-1" />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          {t("categoryLabel")}
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="rounded border px-2 py-1"
          >
            <option value="">{t("categoryAll")}</option>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {t(`category.${c}`)}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          {t("minPrice")}
          <input
            type="number"
            value={minPrice}
            onChange={(e) => setMinPrice(e.target.value)}
            className="rounded border px-2 py-1"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          {t("maxPrice")}
          <input
            type="number"
            value={maxPrice}
            onChange={(e) => setMaxPrice(e.target.value)}
            className="rounded border px-2 py-1"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          {t("radius")}
          <input
            type="number"
            value={radiusKm}
            onChange={(e) => setRadiusKm(e.target.value)}
            className="rounded border px-2 py-1"
          />
        </label>
        <button
          type="submit"
          disabled={loading}
          className="rounded bg-black px-3 py-2 text-white disabled:opacity-50"
        >
          {t("search")}
        </button>
      </form>

      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
        {items.map((p) => (
          <ProductCard key={p.id} product={p} />
        ))}
      </div>

      {items.length === 0 && !loading && !error && (
        <p className="text-sm text-zinc-500">{t("empty")}</p>
      )}

      {nextCursor && (
        <button
          type="button"
          onClick={() => void runSearch(nextCursor)}
          disabled={loading}
          className="self-center rounded border px-3 py-2 disabled:opacity-50"
        >
          {t("loadMore")}
        </button>
      )}
    </div>
  );
}
