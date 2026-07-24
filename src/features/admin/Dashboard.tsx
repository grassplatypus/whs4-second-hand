"use client";

import { useEffect, useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { Card, PageHeader } from "@/features/shell/ui";

/**
 * GET /api/admin/dashboard가 내려주는 집계 — 수치만(PII 없음).
 * 서비스의 DashboardStats와 1:1.
 */
export interface DashboardStatsView {
  users: number;
  suspended: number;
  products: { selling: number; reserved: number; sold: number };
  openReports: number;
  activeEscrows: number;
  disputedEscrows: number;
}

interface StatDef {
  labelKey: string;
  value: number;
  icon: string;
}

export function Dashboard() {
  const t = useTranslations("admin");
  const format = useFormatter();

  const [stats, setStats] = useState<DashboardStatsView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch("/api/admin/dashboard");
        if (!res.ok) {
          if (!cancelled) setError(t("failed"));
          return;
        }
        const body = (await res.json()) as DashboardStatsView;
        if (!cancelled) setStats(body);
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

  const cards: StatDef[] | null = stats
    ? [
        { labelKey: "statUsers", value: stats.users, icon: "👥" },
        { labelKey: "statSuspended", value: stats.suspended, icon: "🚫" },
        { labelKey: "statSelling", value: stats.products.selling, icon: "🛒" },
        { labelKey: "statReserved", value: stats.products.reserved, icon: "⏳" },
        { labelKey: "statSold", value: stats.products.sold, icon: "✅" },
        { labelKey: "statOpenReports", value: stats.openReports, icon: "🚨" },
        { labelKey: "statActiveEscrows", value: stats.activeEscrows, icon: "🤝" },
        { labelKey: "statDisputedEscrows", value: stats.disputedEscrows, icon: "⚖️" },
      ]
    : null;

  return (
    <div className="flex w-full max-w-3xl flex-col gap-4">
      <PageHeader title={t("dashboardTitle")} />

      {error && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      )}

      {loading && (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4" aria-hidden>
          {Array.from({ length: 8 }).map((_, i) => (
            <li key={i}>
              <Card className="animate-pulse">
                <div className="h-6 w-6 rounded bg-zinc-200 dark:bg-zinc-800" />
                <div className="mt-3 h-3 w-2/3 rounded bg-zinc-200 dark:bg-zinc-800" />
                <div className="mt-2 h-6 w-1/2 rounded bg-zinc-200 dark:bg-zinc-800" />
              </Card>
            </li>
          ))}
        </ul>
      )}

      {!loading && cards && (
        <>
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {cards.map((c) => (
              <StatCard key={c.labelKey} icon={c.icon} label={t(c.labelKey)} value={c.value} format={format} />
            ))}
          </ul>

          <nav className="flex flex-wrap gap-2">
            <a
              href="/admin/reports"
              className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
            >
              {t("reportsLink")}
            </a>
            <a
              href="/admin/disputes"
              className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
            >
              {t("disputesLink")}
            </a>
          </nav>
        </>
      )}
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
  format,
}: {
  icon: string;
  label: string;
  value: number;
  format: ReturnType<typeof useFormatter>;
}) {
  return (
    <li>
      <Card className="flex flex-col gap-1">
        <span className="text-xl" aria-hidden>
          {icon}
        </span>
        <span className="text-xs text-zinc-500 dark:text-zinc-400">{label}</span>
        <span className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">{format.number(value)}</span>
      </Card>
    </li>
  );
}
