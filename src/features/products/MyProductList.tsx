"use client";

import { useState } from "react";
import { useTranslations, useFormatter } from "next-intl";
import { Card, Button, EmptyState } from "@/features/shell/ui";

export interface MyProductItem {
  id: string;
  title: string;
  price: number;
  category: string;
  status: string;
  thumbnail: string | null;
  isHidden: boolean;
  createdAt: string;
}

/**
 * 판매자 본인의 전체 상품(숨김 포함) 목록. 공개 목록/상세는 숨긴(soft-deleted) 상품을 절대
 * 보여주지 않으므로, 이 화면이 유일하게 "숨긴 상품에 다시 접근해 복원"할 수 있는 통로다.
 */
export function MyProductList({ initialItems }: { initialItems: MyProductItem[] }) {
  const t = useTranslations("product");
  const format = useFormatter();
  const [items, setItems] = useState(initialItems);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function hide(id: string) {
    setError(null);
    setPendingId(id);
    try {
      const res = await fetch(`/api/products/${id}`, { method: "DELETE" });
      if (!res.ok) {
        setError(t("failed"));
        return;
      }
      setItems((prev) => prev.map((p) => (p.id === id ? { ...p, isHidden: true } : p)));
    } catch {
      setError(t("failed"));
    } finally {
      setPendingId(null);
    }
  }

  async function restore(id: string) {
    setError(null);
    setPendingId(id);
    try {
      const res = await fetch(`/api/products/${id}/restore`, { method: "POST" });
      if (!res.ok) {
        setError(t("failed"));
        return;
      }
      setItems((prev) => prev.map((p) => (p.id === id ? { ...p, isHidden: false } : p)));
    } catch {
      setError(t("failed"));
    } finally {
      setPendingId(null);
    }
  }

  if (items.length === 0) {
    return <EmptyState icon="📦" title={t("myListingsEmpty")} />;
  }

  return (
    <div className="flex w-full max-w-3xl flex-col gap-3">
      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}
      <ul className="flex flex-col gap-3">
        {items.map((item) => {
          const priceLabel = item.price === 0 ? t("free") : `${format.number(item.price)}${t("won")}`;
          const busy = pendingId === item.id;
          return (
            <li key={item.id}>
              <Card className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-col gap-1">
                  <div className="flex items-center gap-2">
                    {item.isHidden && (
                      <span className="rounded-full bg-zinc-200 px-2 py-0.5 text-xs font-semibold text-zinc-600 dark:bg-zinc-700 dark:text-zinc-300">
                        {t("hiddenBadge")}
                      </span>
                    )}
                    {!item.isHidden ? (
                      <a
                        href={`/products/${item.id}`}
                        className="font-medium text-zinc-900 hover:underline dark:text-zinc-100"
                      >
                        {item.title}
                      </a>
                    ) : (
                      <span className="font-medium text-zinc-500 dark:text-zinc-400">{item.title}</span>
                    )}
                  </div>
                  <span className="text-sm text-zinc-600 dark:text-zinc-400">{priceLabel}</span>
                </div>
                {!item.isHidden ? (
                  <Button type="button" variant="secondary" disabled={busy} onClick={() => void hide(item.id)}>
                    {t("hideButton")}
                  </Button>
                ) : (
                  <Button type="button" variant="secondary" disabled={busy} onClick={() => void restore(item.id)}>
                    {t("restoreButton")}
                  </Button>
                )}
              </Card>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
