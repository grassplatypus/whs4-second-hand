import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { DisputeList, type DisputeItemView } from "./DisputeList";
import ko from "@/i18n/messages/ko.json";

function renderIt() {
  return render(
    <NextIntlClientProvider locale="ko" messages={ko}>
      <DisputeList />
    </NextIntlClientProvider>,
  );
}

/** URL/메서드에 따라 분기하는 fetch 목 — GET 목록 + POST 조정을 하나로 라우팅한다. */
function routedFetch(
  overrides: Record<string, (init?: RequestInit) => { ok: boolean; status?: number; body: unknown }>,
) {
  return vi.fn(async (url: unknown, init?: RequestInit) => {
    const u = String(url);
    const method = (init?.method ?? "GET").toUpperCase();
    const key = `${method} ${u}`;
    for (const [pattern, handler] of Object.entries(overrides)) {
      if (key.includes(pattern)) {
        const r = handler(init);
        return { ok: r.ok, status: r.status ?? (r.ok ? 200 : 400), json: async () => r.body };
      }
    }
    return { ok: true, status: 200, json: async () => ({ disputes: [] }) };
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const item: DisputeItemView = {
  id: "e1",
  amount: 10000,
  buyerNickname: "풀숲여우",
  sellerNickname: "바다표범",
  product: { id: "p1", title: "아이폰 팝니다" },
  updatedAt: "2026-01-01T00:00:00.000Z",
};

function ok(disputes: DisputeItemView[]) {
  return { ok: true, json: async () => ({ disputes }) };
}

describe("DisputeList", () => {
  it("fetches disputes on mount and renders product title, buyer/seller nickname and KRW amount", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(ok([item])));
    renderIt();

    expect(await screen.findByText("아이폰 팝니다")).toBeInTheDocument();
    expect(screen.getByText("풀숲여우")).toBeInTheDocument();
    expect(screen.getByText("바다표범")).toBeInTheDocument();
    expect(screen.getByText("10,000원")).toBeInTheDocument();
  });

  it("never renders participant email/phone — no such fields exist on the item shape", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(ok([item])));
    const { container } = renderIt();
    await screen.findByText("풀숲여우");

    expect(container.innerHTML).not.toMatch(/@.+\..+/);
    expect(container.innerHTML).not.toMatch(/\d{2,3}-\d{3,4}-\d{4}/);
  });

  it("shows the empty state when there are no disputes", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(ok([])));
    renderIt();

    expect(await screen.findByText(ko.admin.disputesEmpty)).toBeInTheDocument();
  });

  it("release POSTs resolution=release to the escrow resolve route then re-fetches", async () => {
    let calls = 0;
    const fetchMock = routedFetch({
      "GET /api/admin/disputes": () => {
        calls += 1;
        return { ok: true, body: { disputes: calls === 1 ? [item] : [] } };
      },
      "POST /api/escrow/e1/resolve": () => ({ ok: true, body: { ok: true } }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    renderIt();

    await user.click(await screen.findByRole("button", { name: ko.admin.release }));

    expect(await screen.findByText(ko.admin.disputesEmpty)).toBeInTheDocument();
    const postCall = fetchMock.mock.calls.find(
      ([u, init]) =>
        String(u).includes("/e1/resolve") && (init as RequestInit | undefined)?.method === "POST",
    );
    expect(postCall).toBeTruthy();
    expect(String((postCall?.[1] as RequestInit).body)).toContain("release");
  });

  it("refund POSTs resolution=refund to the escrow resolve route", async () => {
    const fetchMock = routedFetch({
      "GET /api/admin/disputes": () => ({ ok: true, body: { disputes: [item] } }),
      "POST /api/escrow/e1/resolve": () => ({ ok: true, body: { ok: true } }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    renderIt();

    await user.click(await screen.findByRole("button", { name: ko.admin.refund }));

    const postCall = fetchMock.mock.calls.find(
      ([u, init]) =>
        String(u).includes("/e1/resolve") && (init as RequestInit | undefined)?.method === "POST",
    );
    expect(postCall).toBeTruthy();
    expect(String((postCall?.[1] as RequestInit).body)).toContain("refund");
  });

  it("maps an action error code to the catalog message, never the raw server text", async () => {
    const fetchMock = routedFetch({
      "GET /api/admin/disputes": () => ({ ok: true, body: { disputes: [item] } }),
      "POST /api/escrow/e1/resolve": () => ({
        ok: false,
        status: 400,
        body: { code: "INVALID_INPUT", message: "leaky server text" },
      }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    renderIt();

    await user.click(await screen.findByRole("button", { name: ko.admin.release }));

    expect(await screen.findByRole("alert")).toHaveTextContent(ko.admin.invalidInput);
    expect(screen.queryByText("leaky server text")).not.toBeInTheDocument();
  });

  it("maps a load error code to the catalog message", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 403, json: async () => ({ code: "FORBIDDEN" }) }),
    );
    renderIt();

    expect(await screen.findByRole("alert")).toHaveTextContent(ko.admin.forbidden);
  });
});
