"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Card, Field, Input, Select, Button, EmptyState } from "@/features/shell/ui";
import { CATEGORIES } from "./categories";
import { ProductCard, type ProductCardView } from "./ProductCard";

interface SearchResult {
  items: ProductCardView[];
  nextCursor: string | null;
}

const STATUS_FILTERS = ["", "SELLING", "RESERVED", "SOLD"] as const;
type StatusFilter = (typeof STATUS_FILTERS)[number];

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

function SkeletonGrid() {
  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
      {Array.from({ length: 8 }).map((_, i) => (
        <div
          key={i}
          className="flex flex-col overflow-hidden rounded-xl border border-zinc-200 dark:border-zinc-800"
        >
          <div className="aspect-square w-full animate-pulse bg-zinc-200 dark:bg-zinc-800" />
          <div className="flex flex-col gap-2 p-3">
            <div className="h-4 w-3/4 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800" />
            <div className="h-4 w-1/2 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function ProductList() {
  const t = useTranslations("product");

  const [q, setQ] = useState("");
  const [category, setCategory] = useState("");
  const [minPrice, setMinPrice] = useState("");
  const [maxPrice, setMaxPrice] = useState("");
  const [radiusKm, setRadiusKm] = useState("");
  const [status, setStatus] = useState<StatusFilter>("");

  const [items, setItems] = useState<ProductCardView[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [locationDenied, setLocationDenied] = useState(false);

  const buildParams = useCallback(
    async (cursor?: string) => {
      const params = new URLSearchParams();
      if (q.trim()) params.set("q", q.trim());
      if (category) params.set("category", category);
      if (minPrice) params.set("minPrice", minPrice);
      if (maxPrice) params.set("maxPrice", maxPrice);
      if (status) params.set("status", status);
      if (radiusKm) {
        params.set("radiusKm", radiusKm);
        const pos = await getPosition();
        if (pos) {
          params.set("lat", String(pos.lat));
          params.set("lng", String(pos.lng));
          setLocationDenied(false);
        } else {
          setLocationDenied(true);
        }
      } else {
        setLocationDenied(false);
      }
      if (cursor) params.set("cursor", cursor);
      return params;
    },
    [q, category, minPrice, maxPrice, radiusKm, status],
  );

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

  const isFirstStatusRender = useRef(true);
  useEffect(() => {
    // 상태 필터는 다른 조건과 달리 클릭 즉시 재조회한다(검색 버튼을 기다리지 않는다).
    if (isFirstStatusRender.current) {
      isFirstStatusRender.current = false;
      return;
    }
    void runSearch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    void runSearch();
  }

  function resetFilters() {
    setQ("");
    setCategory("");
    setMinPrice("");
    setMaxPrice("");
    setRadiusKm("");
    setStatus("");
    void runSearch();
  }

  return (
    <div className="flex w-full max-w-5xl flex-col gap-6">
      <Card className="flex flex-col gap-4">
        <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Field label={t("searchLabel")}>
              <Input value={q} onChange={(e) => setQ(e.target.value)} />
            </Field>
            <Field label={t("categoryLabel")}>
              <Select value={category} onChange={(e) => setCategory(e.target.value)}>
                <option value="">{t("categoryAll")}</option>
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {t(`category.${c}`)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t("minPrice")}>
              <Input type="number" min={0} value={minPrice} onChange={(e) => setMinPrice(e.target.value)} />
            </Field>
            <Field label={t("maxPrice")}>
              <Input type="number" min={0} value={maxPrice} onChange={(e) => setMaxPrice(e.target.value)} />
            </Field>
            <Field label={t("radius")}>
              <Input type="number" min={0} value={radiusKm} onChange={(e) => setRadiusKm(e.target.value)} />
              {locationDenied && (
                <span className="text-xs text-amber-600 dark:text-amber-400">{t("locationDenied")}</span>
              )}
            </Field>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <div role="group" aria-label={t("statusFilterLabel")} className="flex flex-wrap gap-2">
              {STATUS_FILTERS.map((s) => (
                <button
                  key={s || "ALL"}
                  type="button"
                  aria-pressed={status === s}
                  onClick={() => setStatus(s)}
                  className={`rounded-full border px-3 py-1.5 text-sm font-medium transition-colors ${
                    status === s
                      ? "border-emerald-600 bg-emerald-600 text-white"
                      : "border-zinc-300 bg-white text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800"
                  }`}
                >
                  {s ? t(`status.${s}`) : t("statusAll")}
                </button>
              ))}
            </div>
            <Button type="submit" disabled={loading}>
              {t("search")}
            </Button>
          </div>
        </form>
      </Card>

      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}

      {loading && items.length === 0 && !error && <SkeletonGrid />}

      {!loading && items.length === 0 && !error && (
        <EmptyState
          icon="🔍"
          title={t("empty")}
          action={
            <div className="flex gap-2">
              <Button type="button" variant="secondary" onClick={resetFilters}>
                {t("resetFilters")}
              </Button>
              <a
                href="/products/new"
                className="inline-flex items-center justify-center rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-emerald-700"
              >
                {t("emptyCta")}
              </a>
            </div>
          }
        />
      )}

      {items.length > 0 && (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
          {items.map((p) => (
            <ProductCard key={p.id} product={p} />
          ))}
        </div>
      )}

      {nextCursor && (
        <Button
          type="button"
          variant="secondary"
          onClick={() => void runSearch(nextCursor)}
          disabled={loading}
          aria-busy={loading}
          className="self-center"
        >
          {t("loadMore")}
        </Button>
      )}
    </div>
  );
}
