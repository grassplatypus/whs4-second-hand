"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";

/** 안전거래 상태 — 카탈로그 라벨 키와 1:1. 서버 enum을 그대로 화면에 쓰지 않는다. */
export type EscrowStatus =
  | "REQUESTED"
  | "ACCEPTED"
  | "FUNDED"
  | "RELEASED"
  | "REFUNDED"
  | "CANCELLED"
  | "DISPUTED";

/**
 * GET /api/escrow가 내려주는 안전 요약 — 상대는 닉네임만(이메일/전화 등 금지).
 * updatedAt은 JSON 직렬화라 문자열이다.
 */
export interface EscrowListItemView {
  id: string;
  status: EscrowStatus;
  amount: number;
  myRole: "buyer" | "seller";
  counterparty: { nickname: string };
  product: { id: string; title: string };
  updatedAt: string;
}

export function EscrowList() {
  const t = useTranslations("escrow");

  const [items, setItems] = useState<EscrowListItemView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch("/api/escrow");
        if (!res.ok) {
          if (!cancelled) setError(t("failed"));
          return;
        }
        const body = (await res.json()) as { escrows: EscrowListItemView[] };
        if (!cancelled) setItems(body.escrows);
      } catch {
        if (!cancelled) setError(t("failed"));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [t]);

  const money = (n: number) => `${n.toLocaleString()}${t("won")}`;

  return (
    <div className="flex w-full max-w-lg flex-col gap-4">
      <h1 className="text-xl font-semibold">{t("listTitle")}</h1>

      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}

      {!loading && !error && items.length === 0 && <p className="text-sm text-zinc-500">{t("empty")}</p>}

      <ul className="flex flex-col gap-2">
        {items.map((item) => (
          <li key={item.id}>
            <a
              href={`/escrow/${item.id}`}
              className="flex flex-col gap-1 rounded border px-3 py-2 hover:bg-zinc-50"
            >
              <span className="flex items-center justify-between gap-2">
                <span className="font-medium">{item.product.title}</span>
                <span className="rounded bg-zinc-100 px-2 py-0.5 text-xs text-zinc-700">
                  {t(`status.${item.status}`)}
                </span>
              </span>
              <span className="text-sm">{money(item.amount)}</span>
              <span className="text-xs text-zinc-500">{item.counterparty.nickname}</span>
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
