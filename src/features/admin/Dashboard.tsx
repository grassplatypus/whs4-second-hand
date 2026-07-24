"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";

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

export function Dashboard() {
  const t = useTranslations("admin");

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

  return (
    <div className="flex w-full max-w-2xl flex-col gap-4">
      <h1 className="text-xl font-semibold">{t("dashboardTitle")}</h1>

      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}

      {!loading && stats && (
        <>
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Card label={t("statUsers")} value={stats.users} />
            <Card label={t("statSuspended")} value={stats.suspended} />
            <Card label={t("statSelling")} value={stats.products.selling} />
            <Card label={t("statReserved")} value={stats.products.reserved} />
            <Card label={t("statSold")} value={stats.products.sold} />
            <Card label={t("statOpenReports")} value={stats.openReports} />
            <Card label={t("statActiveEscrows")} value={stats.activeEscrows} />
            <Card label={t("statDisputedEscrows")} value={stats.disputedEscrows} />
          </ul>

          <nav className="flex flex-wrap gap-2">
            <a href="/admin/reports" className="rounded border px-3 py-2 text-sm hover:bg-zinc-50">
              {t("reportsLink")}
            </a>
            <a href="/admin/disputes" className="rounded border px-3 py-2 text-sm hover:bg-zinc-50">
              {t("disputesLink")}
            </a>
          </nav>
        </>
      )}
    </div>
  );
}

function Card({ label, value }: { label: string; value: number }) {
  return (
    <li className="flex flex-col gap-1 rounded border px-3 py-3">
      <span className="text-xs text-zinc-500">{label}</span>
      <span className="text-2xl font-semibold">{value.toLocaleString()}</span>
    </li>
  );
}
