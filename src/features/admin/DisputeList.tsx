"use client";

import { useCallback, useEffect, useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { Card, PageHeader, Button, EmptyState } from "@/features/shell/ui";
import { Avatar } from "@/features/shell/Avatar";

/**
 * GET /api/admin/disputes가 내려주는 분쟁 에스크로 요약 — 서비스의 DisputedEscrowView와 1:1.
 * 상대는 닉네임만(PII 없음). updatedAt은 JSON 직렬화라 문자열이다.
 */
export interface DisputeItemView {
  id: string;
  amount: number;
  buyerNickname: string;
  sellerNickname: string;
  product: { id: string; title: string };
  updatedAt: string;
}

/** 서비스가 던지는 코드 → admin 카탈로그 키. 서버 message 원문은 절대 렌더하지 않는다. */
const ERROR_KEYS: Record<string, string> = {
  FORBIDDEN: "forbidden",
  NOT_FOUND: "notFound",
  INVALID_INPUT: "invalidInput",
  UNAUTHENTICATED: "unauthenticated",
};

async function readErrorCode(res: Response): Promise<string | undefined> {
  const body = await res.json().catch(() => ({ code: undefined }));
  return (body as { code?: string }).code;
}

/** 서버가 주는 날짜 문자열을 안전하게 포맷한다 — 파싱 실패는 "—"로. */
function formatDate(iso: string, format: ReturnType<typeof useFormatter>): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return format.dateTime(d, { dateStyle: "medium", timeStyle: "short" });
}

export function DisputeList() {
  const t = useTranslations("admin");
  const format = useFormatter();

  const [items, setItems] = useState<DisputeItemView[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const res = await fetch("/api/admin/disputes");
      if (!res.ok) {
        const code = await readErrorCode(res);
        setLoadError(t(ERROR_KEYS[code ?? ""] ?? "failed"));
        return;
      }
      const body = (await res.json()) as { disputes: DisputeItemView[] };
      setItems(body.disputes);
    } catch {
      setLoadError(t("failed"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    setLoading(true);
    void load();
  }, [load]);

  // 분쟁 조정은 #5 POST /api/escrow/[id]/resolve 재사용(관리자 게이트). 성공 후 목록을 다시 부른다.
  async function resolve(id: string, resolution: "release" | "refund") {
    if (submitting) return;
    setActionError(null);
    setSubmitting(true);
    try {
      const res = await fetch(`/api/escrow/${id}/resolve`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ resolution }),
      });
      if (!res.ok) {
        const code = await readErrorCode(res);
        setActionError(t(ERROR_KEYS[code ?? ""] ?? "failed"));
        return;
      }
      await load();
    } catch {
      setActionError(t("failed"));
    } finally {
      setSubmitting(false);
    }
  }

  const money = (n: number) => `${format.number(n)}${t("won")}`;

  return (
    <div className="flex w-full max-w-2xl flex-col gap-4">
      <PageHeader title={t("disputesTitle")} />

      {loadError && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {loadError}
        </p>
      )}

      {actionError && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {actionError}
        </p>
      )}

      {loading && (
        <div className="flex flex-col gap-3" aria-hidden>
          {[0, 1].map((i) => (
            <Card key={i} className="animate-pulse">
              <div className="h-4 w-1/3 rounded bg-zinc-200 dark:bg-zinc-800" />
              <div className="mt-3 h-3 w-2/3 rounded bg-zinc-200 dark:bg-zinc-800" />
            </Card>
          ))}
        </div>
      )}

      {!loading && !loadError && items.length === 0 && <EmptyState icon="⚖️" title={t("disputesEmpty")} />}

      <ul className="flex flex-col gap-3">
        {items.map((d) => (
          <li key={d.id}>
            <Card className="flex flex-col gap-3 text-sm">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium text-zinc-900 dark:text-zinc-50">{d.product.title}</span>
                <span className="font-semibold text-zinc-900 dark:text-zinc-50">{money(d.amount)}</span>
              </div>

              <div className="flex flex-wrap items-center gap-4">
                <div className="flex items-center gap-2">
                  <Avatar nickname={d.buyerNickname} size={28} />
                  <div className="flex flex-col">
                    <span className="text-xs text-zinc-500 dark:text-zinc-400">{t("buyer")}</span>
                    <span className="text-zinc-900 dark:text-zinc-100">{d.buyerNickname}</span>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Avatar nickname={d.sellerNickname} size={28} />
                  <div className="flex flex-col">
                    <span className="text-xs text-zinc-500 dark:text-zinc-400">{t("seller")}</span>
                    <span className="text-zinc-900 dark:text-zinc-100">{d.sellerNickname}</span>
                  </div>
                </div>
              </div>

              <span className="text-xs text-zinc-400 dark:text-zinc-500">{formatDate(d.updatedAt, format)}</span>

              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="primary" onClick={() => void resolve(d.id, "release")} disabled={submitting}>
                  {t("release")}
                </Button>
                <Button type="button" variant="secondary" onClick={() => void resolve(d.id, "refund")} disabled={submitting}>
                  {t("refund")}
                </Button>
              </div>
            </Card>
          </li>
        ))}
      </ul>
    </div>
  );
}
