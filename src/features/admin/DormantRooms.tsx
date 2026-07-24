"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations, useFormatter } from "next-intl";
import { Card, PageHeader, Button, EmptyState } from "@/features/shell/ui";

export interface DormantRoomView {
  conversationId: string;
  productId: string;
  lastMessageAt: string;
}

/** 양쪽 모두 나가고 새 메시지가 없는 방(휴면)을 관리자가 개별·일괄로 정리한다. */
export function DormantRooms() {
  const t = useTranslations("admin");
  const format = useFormatter();

  const [rooms, setRooms] = useState<DormantRoomView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch("/api/admin/chat-rooms");
      if (!res.ok) {
        setError(t("failed"));
        return;
      }
      const body = (await res.json()) as { rooms: DormantRoomView[] };
      setRooms(body.rooms);
    } catch {
      setError(t("failed"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    setLoading(true);
    void load();
  }, [load]);

  async function remove(payload: { ids?: string[]; all?: boolean }) {
    if (working) return;
    setWorking(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/chat-rooms", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        setError(t("failed"));
        return;
      }
      await load();
    } catch {
      setError(t("failed"));
    } finally {
      setWorking(false);
    }
  }

  function formatWhen(iso: string): string {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "—";
    return format.dateTime(d, { dateStyle: "medium", timeStyle: "short" });
  }

  return (
    <div className="flex w-full max-w-2xl flex-col gap-4">
      <div className="flex items-end justify-between gap-3">
        <PageHeader title={t("dormantTitle")} subtitle={t("dormantSubtitle")} />
        {rooms.length > 0 && (
          <Button type="button" variant="danger" onClick={() => void remove({ all: true })} disabled={working}>
            {t("dormantDeleteAll")}
          </Button>
        )}
      </div>

      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}

      {loading && <p className="text-sm text-zinc-500">{t("loading")}</p>}

      {!loading && rooms.length === 0 && <EmptyState icon="🧹" title={t("dormantEmpty")} />}

      {!loading && rooms.length > 0 && (
        <ul className="flex flex-col gap-2">
          {rooms.map((room) => (
            <li key={room.conversationId}>
              <Card className="flex items-center justify-between gap-3">
                <div className="flex min-w-0 flex-col">
                  <span className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-100">
                    {room.conversationId}
                  </span>
                  <span className="text-xs text-zinc-500">{formatWhen(room.lastMessageAt)}</span>
                </div>
                <Button
                  type="button"
                  variant="danger"
                  onClick={() => void remove({ ids: [room.conversationId] })}
                  disabled={working}
                >
                  {t("dormantDelete")}
                </Button>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
