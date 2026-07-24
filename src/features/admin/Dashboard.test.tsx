import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { Dashboard, type DashboardStatsView } from "./Dashboard";
import ko from "@/i18n/messages/ko.json";

function renderIt() {
  return render(
    <NextIntlClientProvider locale="ko" messages={ko}>
      <Dashboard />
    </NextIntlClientProvider>,
  );
}

function ok(stats: DashboardStatsView) {
  return { ok: true, json: async () => stats };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const stats: DashboardStatsView = {
  users: 1234,
  suspended: 5,
  products: { selling: 40, reserved: 3, sold: 100 },
  openReports: 7,
  activeEscrows: 12,
  disputedEscrows: 2,
};

describe("Dashboard", () => {
  it("fetches stats on mount and renders the count cards with catalog labels", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(ok(stats)));
    renderIt();

    expect(await screen.findByText("1,234")).toBeInTheDocument();
    expect(screen.getByText(ko.admin.statUsers)).toBeInTheDocument();
    expect(screen.getByText(ko.admin.statSuspended)).toBeInTheDocument();
    expect(screen.getByText(ko.admin.statOpenReports)).toBeInTheDocument();
    expect(screen.getByText(ko.admin.statDisputedEscrows)).toBeInTheDocument();
    // 상품 상태별 수치
    expect(screen.getByText("40")).toBeInTheDocument();
    expect(screen.getByText("100")).toBeInTheDocument();
  });

  it("links to the reports and disputes pages", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(ok(stats)));
    renderIt();

    expect(await screen.findByRole("link", { name: ko.admin.reportsLink })).toHaveAttribute(
      "href",
      "/admin/reports",
    );
    expect(screen.getByRole("link", { name: ko.admin.disputesLink })).toHaveAttribute(
      "href",
      "/admin/disputes",
    );
  });

  it("maps a failed fetch to the catalog failed message, never a raw server message", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 403, json: async () => ({ code: "FORBIDDEN" }) }),
    );
    renderIt();

    expect(await screen.findByRole("alert")).toHaveTextContent(ko.admin.failed);
  });
});
