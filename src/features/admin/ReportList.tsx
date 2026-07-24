"use client";

import { useCallback, useEffect, useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { Card, PageHeader, Button, EmptyState } from "@/features/shell/ui";
import { Avatar } from "@/features/shell/Avatar";

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

/** 서버가 주는 날짜 문자열을 안전하게 포맷한다 — 파싱 실패는 "—"로. */
function formatDate(iso: string, format: ReturnType<typeof useFormatter>): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return format.dateTime(d, { dateStyle: "medium", timeStyle: "short" });
}

const FILTERS: ReportStatusFilter[] = ["open", "resolved", "dismissed"];

export function ReportList() {
  const t = useTranslations("admin");
  const format = useFormatter();

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

  async function userAction(targetUserId: string, action: "suspend" | "lift") {
    if (submitting) return;
    setActionError(null);
    setSubmitting(true);
    try {
      const res = await fetch(`/api/admin/users/${targetUserId}/${action}`, { method: "POST" });
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
  const suspend = (id: string) => userAction(id, "suspend");
  const lift = (id: string) => userAction(id, "lift");

  function statusLabel(s: string): string {
    if (s === "open" || s === "resolved" || s === "dismissed") return t(`reportStatus.${s}`);
    return s;
  }

  return (
    <div className="flex w-full max-w-2xl flex-col gap-4">
      <PageHeader title={t("reportsTitle")} />

      <div className="flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setStatus(f)}
            aria-pressed={status === f}
            className={`rounded-full border px-3 py-1 text-sm font-medium transition-colors ${
              status === f
                ? "border-emerald-600 bg-emerald-600 text-white"
                : "border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
            }`}
          >
            {t(`reportStatus.${f}`)}
          </button>
        ))}
      </div>

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

      {!loading && !loadError && items.length === 0 && <EmptyState icon="🕊️" title={t("reportsEmpty")} />}

      <ul className="flex flex-col gap-3">
        {items.map((r) => (
          <li key={r.id}>
            <Card className="flex flex-col gap-3 text-sm">
              <div className="flex items-center justify-between gap-2">
                <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-semibold text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
                  {r.targetType === "user" ? t("targetUser") : t("targetMessage")}
                </span>
                <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-semibold text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
                  {statusLabel(r.status)}
                </span>
              </div>

              <div className="flex items-center gap-3">
                <Avatar nickname={r.reporterNickname} size={32} />
                <div className="flex min-w-0 flex-col">
                  <span className="text-xs text-zinc-500 dark:text-zinc-400">{t("reporter")}</span>
                  <span className="truncate font-medium text-zinc-900 dark:text-zinc-50">{r.reporterNickname}</span>
                </div>
              </div>

              <dl className="flex flex-col gap-1">
                <div className="flex justify-between gap-2">
                  <dt className="text-zinc-500 dark:text-zinc-400">{t("target")}</dt>
                  <dd className="text-zinc-900 dark:text-zinc-100">{r.targetLabel}</dd>
                </div>
              </dl>

              <p className="whitespace-pre-wrap text-zinc-700 dark:text-zinc-300">
                <span className="text-zinc-500 dark:text-zinc-400">{t("reason")}: </span>
                {r.reason}
              </p>

              {r.snapshot && (
                <div className="rounded-lg bg-zinc-50 px-3 py-2 dark:bg-zinc-800/60">
                  <span className="text-xs font-semibold text-zinc-500 dark:text-zinc-400">{t("snapshot")}</span>
                  <p className="whitespace-pre-wrap text-zinc-700 dark:text-zinc-300">{r.snapshot}</p>
                </div>
              )}

              <span className="text-xs text-zinc-400 dark:text-zinc-500">{formatDate(r.createdAt, format)}</span>

              {r.status === "open" && (
                <div className="flex flex-wrap gap-2">
                  <Button type="button" variant="primary" onClick={() => void resolve(r.id, "resolve")} disabled={submitting}>
                    {t("resolve")}
                  </Button>
                  <Button type="button" variant="secondary" onClick={() => void resolve(r.id, "dismiss")} disabled={submitting}>
                    {t("dismiss")}
                  </Button>
                  {r.targetType === "user" && r.targetUserId && (
                    <>
                      <Button type="button" variant="danger" onClick={() => void suspend(r.targetUserId!)} disabled={submitting}>
                        {t("suspendUser")}
                      </Button>
                      <Button type="button" variant="secondary" onClick={() => void lift(r.targetUserId!)} disabled={submitting}>
                        {t("liftUser")}
                      </Button>
                    </>
                  )}
                </div>
              )}
            </Card>
          </li>
        ))}
      </ul>
    </div>
  );
}
