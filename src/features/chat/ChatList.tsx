"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";

/**
 * GET /api/chat/conversations가 내려주는 안전 요약 — 상대방은 닉네임만(이메일/전화 등 금지).
 * lastMessageAt은 JSON 직렬화라 문자열이다.
 */
export interface ChatListItem {
  conversationId: string;
  otherNickname: string;
  productId: string;
  lastMessageAt: string;
}

export function ChatList() {
  const t = useTranslations("chat");

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
      <h1 className="text-xl font-semibold">{t("listTitle")}</h1>

      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}

      {!loading && !error && items.length === 0 && <p className="text-sm text-zinc-500">{t("empty")}</p>}

      <ul className="flex flex-col gap-2">
        {items.map((item) => (
          <li key={item.conversationId}>
            <a
              href={`/chat/${item.conversationId}`}
              className="flex flex-col gap-1 rounded border px-3 py-2 hover:bg-zinc-50"
            >
              <span className="font-medium">{item.otherNickname}</span>
              <span className="text-xs text-zinc-500">
                {new Date(item.lastMessageAt).toLocaleString()}
              </span>
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
