"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";

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

export function DisputeList() {
  const t = useTranslations("admin");

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

  const money = (n: number) => `${n.toLocaleString()}${t("won")}`;

  return (
    <div className="flex w-full max-w-2xl flex-col gap-4">
      <h1 className="text-xl font-semibold">{t("disputesTitle")}</h1>

      {loadError && (
        <p role="alert" className="text-sm text-red-600">
          {loadError}
        </p>
      )}

      {actionError && (
        <p role="alert" className="text-sm text-red-600">
          {actionError}
        </p>
      )}

      {!loading && !loadError && items.length === 0 && (
        <p className="text-sm text-zinc-500">{t("disputesEmpty")}</p>
      )}

      <ul className="flex flex-col gap-3">
        {items.map((d) => (
          <li key={d.id} className="flex flex-col gap-2 rounded border px-3 py-3 text-sm">
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium">{d.product.title}</span>
              <span className="font-medium">{money(d.amount)}</span>
            </div>

            <dl className="flex flex-col gap-1">
              <div className="flex justify-between gap-2">
                <dt className="text-zinc-500">{t("buyer")}</dt>
                <dd>{d.buyerNickname}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-zinc-500">{t("seller")}</dt>
                <dd>{d.sellerNickname}</dd>
              </div>
            </dl>

            <span className="text-xs text-zinc-400">{new Date(d.updatedAt).toLocaleString()}</span>

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void resolve(d.id, "release")}
                disabled={submitting}
                className="rounded bg-black px-3 py-2 text-sm text-white disabled:opacity-50"
              >
                {t("release")}
              </button>
              <button
                type="button"
                onClick={() => void resolve(d.id, "refund")}
                disabled={submitting}
                className="rounded border px-3 py-2 text-sm disabled:opacity-50"
              >
                {t("refund")}
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
