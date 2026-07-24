"use client";

import { useEffect, useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { Card, PageHeader, EmptyState } from "@/features/shell/ui";
import { Avatar } from "@/features/shell/Avatar";

/** 안전거래 상태 — 카탈로그 라벨 키와 1:1. 서버 enum을 그대로 화면에 쓰지 않는다. */
export type EscrowStatus =
  | "REQUESTED"
  | "ACCEPTED"
  | "FUNDED"
  | "RELEASED"
  | "REFUNDED"
  | "CANCELLED"
  | "DISPUTED";

/** 상태별 배지 색 — EscrowRoom도 같은 팔레트를 쓴다. */
export const STATUS_BADGE_STYLE: Record<EscrowStatus, string> = {
  REQUESTED: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
  ACCEPTED: "bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300",
  FUNDED: "bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-300",
  RELEASED: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300",
  REFUNDED: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
  CANCELLED: "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400",
  DISPUTED: "bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-300",
};

/** 구매/판매 역할 칩 색. */
export const ROLE_BADGE_STYLE: Record<"buyer" | "seller", string> = {
  buyer: "bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300",
  seller: "bg-sky-50 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300",
};

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

/** 서버가 주는 날짜 문자열을 안전하게 포맷한다 — 파싱 실패는 "—"로. */
function formatDate(iso: string, format: ReturnType<typeof useFormatter>): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return format.dateTime(d, { dateStyle: "medium", timeStyle: "short" });
}

export function EscrowList() {
  const t = useTranslations("escrow");
  const format = useFormatter();

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

  const money = (n: number) => `${format.number(n)}${t("won")}`;

  return (
    <div className="flex w-full max-w-lg flex-col gap-4">
      <PageHeader title={t("listTitle")} />

      {error && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      )}

      {loading && (
        <div className="flex flex-col gap-3" aria-hidden>
          {[0, 1, 2].map((i) => (
            <Card key={i} className="animate-pulse">
              <div className="h-4 w-2/3 rounded bg-zinc-200 dark:bg-zinc-800" />
              <div className="mt-3 h-3 w-1/3 rounded bg-zinc-200 dark:bg-zinc-800" />
            </Card>
          ))}
        </div>
      )}

      {!loading && !error && items.length === 0 && <EmptyState icon="🤝" title={t("empty")} />}

      <ul className="flex flex-col gap-3">
        {items.map((item) => (
          <li key={item.id}>
            <a href={`/escrow/${item.id}`} className="block">
              <Card className="flex flex-col gap-3 transition-colors hover:border-emerald-400 dark:hover:border-emerald-600">
                <div className="flex items-center justify-between gap-2">
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-semibold ${ROLE_BADGE_STYLE[item.myRole]}`}
                  >
                    {t(item.myRole === "buyer" ? "roleBuyer" : "roleSeller")}
                  </span>
                  <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_BADGE_STYLE[item.status]}`}>
                    {t(`status.${item.status}`)}
                  </span>
                </div>

                <div className="flex items-center gap-3">
                  <Avatar nickname={item.counterparty.nickname} size={36} />
                  <div className="flex min-w-0 flex-col">
                    <span className="truncate font-medium text-zinc-900 dark:text-zinc-50">
                      {item.product.title}
                    </span>
                    <span className="truncate text-xs text-zinc-500 dark:text-zinc-400">
                      {item.counterparty.nickname}
                    </span>
                  </div>
                </div>

                <div className="flex items-center justify-between gap-2 text-sm">
                  <span className="font-semibold text-zinc-900 dark:text-zinc-50">{money(item.amount)}</span>
                  <span className="text-xs text-zinc-400 dark:text-zinc-500">{formatDate(item.updatedAt, format)}</span>
                </div>
              </Card>
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
