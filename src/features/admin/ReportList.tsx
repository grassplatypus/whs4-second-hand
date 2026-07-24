"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";

/** 신고 상태 필터 — 카탈로그 라벨 키와 1:1. 서버 문자열을 그대로 화면에 쓰지 않는다. */
export type ReportStatusFilter = "open" | "resolved" | "dismissed";

/**
 * GET /api/admin/reports가 내려주는 신고 요약 — 서비스의 ReportView와 1:1.
 * snapshot은 관리자 전용 원문(참여자에겐 안 감). createdAt은 JSON 직렬화라 문자열이다.
 */
export interface ReportItemView {
  id: string;
  reporterNickname: string;
  targetType: "message" | "user";
  targetLabel: string;
  targetUserId: string | null;
  reason: string;
  snapshot: string | null;
  status: string;
  createdAt: string;
}

/** 서비스가 던지는 코드 → admin 카탈로그 키. 서버 message 원문은 절대 렌더하지 않는다. */
const ERROR_KEYS: Record<string, string> = {
  FORBIDDEN: "forbidden",
  NOT_FOUND: "notFound",
  INVALID_INPUT: "invalidInput",
  UNAUTHENTICATED: "unauthenticated",
  CANNOT_SANCTION_SELF: "cannotSanctionSelf",
  CANNOT_SANCTION_ADMIN: "cannotSanctionAdmin",
  ALREADY_SUSPENDED: "alreadySuspended",
  NOT_SUSPENDED: "notSuspended",
};

async function readErrorCode(res: Response): Promise<string | undefined> {
  const body = await res.json().catch(() => ({ code: undefined }));
  return (body as { code?: string }).code;
}

const FILTERS: ReportStatusFilter[] = ["open", "resolved", "dismissed"];

export function ReportList() {
  const t = useTranslations("admin");

  const [status, setStatus] = useState<ReportStatusFilter>("open");
  const [items, setItems] = useState<ReportItemView[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const res = await fetch(`/api/admin/reports?status=${status}`);
      if (!res.ok) {
        const code = await readErrorCode(res);
        setLoadError(t(ERROR_KEYS[code ?? ""] ?? "failed"));
        return;
      }
      const body = (await res.json()) as { reports: ReportItemView[] };
      setItems(body.reports);
    } catch {
      setLoadError(t("failed"));
    } finally {
      setLoading(false);
    }
  }, [status, t]);

  useEffect(() => {
    setLoading(true);
    void load();
  }, [load]);

  async function resolve(id: string, action: "resolve" | "dismiss") {
    if (submitting) return;
    setActionError(null);
    setSubmitting(true);
    try {
      const res = await fetch(`/api/admin/reports/${id}/resolve`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action }),
      });
      if (!res.ok) {
        const code = await readErrorCode(res);
        setActionError(t(ERROR_KEYS[code ?? ""] ?? "failed"));
        return;
      }
      // 성공 후 목록을 다시 불러 처리된 신고를 현재 필터에서 갱신한다.
      await load();
    } catch {
      setActionError(t("failed"));
    } finally {
      setSubmitting(false);
    }
  }

  async function suspend(targetUserId: string) {
    if (submitting) return;
    setActionError(null);
    setSubmitting(true);
    try {
      const res = await fetch(`/api/admin/users/${targetUserId}/suspend`, { method: "POST" });
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

  function statusLabel(s: string): string {
    if (s === "open" || s === "resolved" || s === "dismissed") return t(`reportStatus.${s}`);
    return s;
  }

  return (
    <div className="flex w-full max-w-2xl flex-col gap-4">
      <h1 className="text-xl font-semibold">{t("reportsTitle")}</h1>

      <div className="flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setStatus(f)}
            aria-pressed={status === f}
            className={`rounded border px-3 py-1 text-sm ${
              status === f ? "bg-black text-white" : "hover:bg-zinc-50"
            }`}
          >
            {t(`reportStatus.${f}`)}
          </button>
        ))}
      </div>

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
        <p className="text-sm text-zinc-500">{t("reportsEmpty")}</p>
      )}

      <ul className="flex flex-col gap-3">
        {items.map((r) => (
          <li key={r.id} className="flex flex-col gap-2 rounded border px-3 py-3 text-sm">
            <div className="flex items-center justify-between gap-2">
              <span className="rounded bg-zinc-100 px-2 py-0.5 text-xs text-zinc-700">
                {r.targetType === "user" ? t("targetUser") : t("targetMessage")}
              </span>
              <span className="rounded bg-zinc-100 px-2 py-0.5 text-xs text-zinc-700">
                {statusLabel(r.status)}
              </span>
            </div>

            <dl className="flex flex-col gap-1">
              <div className="flex justify-between gap-2">
                <dt className="text-zinc-500">{t("reporter")}</dt>
                <dd>{r.reporterNickname}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-zinc-500">{t("target")}</dt>
                <dd>{r.targetLabel}</dd>
              </div>
            </dl>

            <p className="whitespace-pre-wrap text-zinc-700">
              <span className="text-zinc-500">{t("reason")}: </span>
              {r.reason}
            </p>

            {r.snapshot && (
              <div className="rounded bg-zinc-50 px-2 py-2">
                <span className="text-xs text-zinc-500">{t("snapshot")}</span>
                <p className="whitespace-pre-wrap text-zinc-700">{r.snapshot}</p>
              </div>
            )}

            <span className="text-xs text-zinc-400">{new Date(r.createdAt).toLocaleString()}</span>

            {r.status === "open" && (
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => void resolve(r.id, "resolve")}
                  disabled={submitting}
                  className="rounded bg-black px-3 py-2 text-sm text-white disabled:opacity-50"
                >
                  {t("resolve")}
                </button>
                <button
                  type="button"
                  onClick={() => void resolve(r.id, "dismiss")}
                  disabled={submitting}
                  className="rounded border px-3 py-2 text-sm disabled:opacity-50"
                >
                  {t("dismiss")}
                </button>
                {r.targetType === "user" && r.targetUserId && (
                  <button
                    type="button"
                    onClick={() => void suspend(r.targetUserId!)}
                    disabled={submitting}
                    className="rounded border border-red-300 px-3 py-2 text-sm text-red-600 disabled:opacity-50"
                  >
                    {t("suspendUser")}
                  </button>
                )}
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
