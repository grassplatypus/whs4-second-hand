"use client";

import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Card, PageHeader, EmptyState } from "@/features/shell/ui";
import { Avatar } from "@/features/shell/Avatar";

/**
 * GET /api/chat/conversations가 내려주는 안전 요약 — 상대방은 닉네임만(이메일/전화 등 금지).
 * lastMessageAt은 JSON 직렬화라 문자열이다. 목록의 대표 텍스트는 상품명이다(#1).
 */
export interface ChatListItem {
  conversationId: string;
  otherNickname: string;
  product: { id: string; title: string };
  lastMessageAt: string;
}

/** lastMessageAt을 사람이 읽기 좋은 상대/짧은 날짜로 바꾼다 — 파싱 실패(NaN)는 "—"로 방어한다. */
function formatWhen(iso: string, locale: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";

  const diffMs = Date.now() - date.getTime();
  const diffMin = Math.round(diffMs / 60000);
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });

  if (Math.abs(diffMin) < 1) return rtf.format(0, "minute");
  if (Math.abs(diffMin) < 60) return rtf.format(-diffMin, "minute");
  const diffHour = Math.round(diffMin / 60);
  if (Math.abs(diffHour) < 24) return rtf.format(-diffHour, "hour");
  const diffDay = Math.round(diffHour / 24);
  if (Math.abs(diffDay) < 7) return rtf.format(-diffDay, "day");
  return date.toLocaleDateString(locale, { year: "numeric", month: "2-digit", day: "2-digit" });
}

function ListSkeleton() {
  return (
    <div className="flex flex-col gap-2" aria-hidden="true">
      {[0, 1, 2].map((i) => (
        <div key={i} className="animate-pulse rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
          <div className="flex items-center gap-3">
            <div className="h-11 w-11 shrink-0 rounded-full bg-zinc-200 dark:bg-zinc-800" />
            <div className="flex flex-1 flex-col gap-2">
              <div className="h-3.5 w-2/5 rounded bg-zinc-200 dark:bg-zinc-800" />
              <div className="h-3 w-1/4 rounded bg-zinc-200 dark:bg-zinc-800" />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

export function ChatList() {
  const t = useTranslations("chat");
  const locale = useLocale();

  const [items, setItems] = useState<ChatListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch("/api/chat/conversations");
        if (!res.ok) {
          if (!cancelled) setError(t("failed"));
          return;
        }
        const body = (await res.json()) as { conversations: ChatListItem[] };
        if (!cancelled) setItems(body.conversations);
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

  return (
    <div className="flex w-full max-w-lg flex-col gap-4">
      <PageHeader title={t("listTitle")} />

      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}

      {loading && <ListSkeleton />}

      {!loading && !error && items.length === 0 && (
        <EmptyState
          icon="💬"
          title={t("empty")}
          action={
            <a
              href="/products"
              className="inline-flex items-center justify-center rounded-lg border border-zinc-300 bg-white px-4 py-2 text-sm font-semibold text-zinc-700 transition-colors hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
            >
              {t("emptyCta")}
            </a>
          }
        />
      )}

      {!loading && items.length > 0 && (
        <ul className="flex flex-col gap-2">
          {items.map((item) => (
            <li key={item.conversationId}>
              <a href={`/chat/${item.conversationId}`} className="block">
                <Card className="flex items-center gap-3 transition-colors hover:border-emerald-300 hover:bg-emerald-50/50 dark:hover:border-emerald-800 dark:hover:bg-emerald-950/20">
                  <Avatar nickname={item.otherNickname} size={44} />
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate font-semibold text-zinc-900 dark:text-zinc-50">
                        {item.product.title || t("deletedProduct")}
                      </span>
                      <span className="shrink-0 text-xs text-zinc-400 dark:text-zinc-500">
                        {formatWhen(item.lastMessageAt, locale)}
                      </span>
                    </div>
                    <span className="truncate text-sm text-zinc-500 dark:text-zinc-400">{item.otherNickname}</span>
                  </div>
                </Card>
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
