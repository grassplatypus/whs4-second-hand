import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { EscrowRoom, type EscrowDetailView } from "./EscrowRoom";
import ko from "@/i18n/messages/ko.json";

function renderIt() {
  return render(
    <NextIntlClientProvider locale="ko" messages={ko}>
      <EscrowRoom escrowId="e1" />
    </NextIntlClientProvider>,
  );
}

function detail(overrides: Partial<EscrowDetailView> = {}): EscrowDetailView {
  return {
    id: "e1",
    status: "FUNDED",
    amount: 10000,
    myRole: "buyer",
    myTurn: false,
    counterparty: { nickname: "풀숲여우" },
    product: { id: "p1", title: "아이폰 팝니다", status: "RESERVED" },
    events: [
      { status: "REQUESTED", amount: 10000, note: null, at: "2026-01-01T00:00:00.000Z", actor: "me" },
      { status: "ACCEPTED", amount: 10000, note: null, at: "2026-01-01T00:01:00.000Z", actor: "other" },
      { status: "FUNDED", amount: 10000, note: null, at: "2026-01-01T00:02:00.000Z", actor: "me" },
    ],
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

/** URL/메서드에 따라 분기하는 fetch 목 — GET 상세 + POST 액션을 하나로 라우팅한다. */
function routedFetch(overrides: Record<string, (init?: RequestInit) => { ok: boolean; status?: number; body: unknown }>) {
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
    return { ok: true, status: 200, json: async () => ({}) };
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("EscrowRoom", () => {
  it("loads the detail on mount and renders amount as KRW, counterparty nickname, and the status catalog label", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => detail() }));
    renderIt();

    expect(await screen.findByText("풀숲여우")).toBeInTheDocument();
    expect(screen.getAllByText("10,000원").length).toBeGreaterThan(0);
    expect(screen.getByText(ko.escrow.statusLabel)).toBeInTheDocument();
  });

  it("buyer at FUNDED sees 수령확인 and 분쟁 신청 but not 거래 반환", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => detail({ myRole: "buyer" }) }));
    renderIt();

    expect(await screen.findByRole("button", { name: ko.escrow.confirm })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: ko.escrow.dispute })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: ko.escrow.refund })).not.toBeInTheDocument();
  });

  it("seller at FUNDED sees 거래 반환 but not 수령확인, plus the waiting message", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => detail({ myRole: "seller" }) }));
    renderIt();

    expect(await screen.findByRole("button", { name: ko.escrow.refund })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: ko.escrow.confirm })).not.toBeInTheDocument();
    expect(screen.getByText(ko.escrow.waitingConfirm)).toBeInTheDocument();
  });

  it("REQUESTED and myTurn: shows 수락 / 금액 조정 / 취소", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: async () => detail({ status: "REQUESTED", myTurn: true }) }),
    );
    renderIt();

    expect(await screen.findByRole("button", { name: ko.escrow.accept })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: ko.escrow.counter })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: ko.escrow.cancel })).toBeInTheDocument();
  });

  it("REQUESTED and not myTurn: shows the waiting-reply message and only 취소", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: async () => detail({ status: "REQUESTED", myTurn: false }) }),
    );
    renderIt();

    expect(await screen.findByText(ko.escrow.waitingReply)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: ko.escrow.cancel })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: ko.escrow.accept })).not.toBeInTheDocument();
  });

  it("performs an action (confirm) as a POST then re-fetches the detail to refresh state", async () => {
    let calls = 0;
    const fetchMock = routedFetch({
      "GET /api/escrow/e1": () => {
        calls += 1;
        // 첫 로드는 FUNDED, 액션 후 재조회는 RELEASED
        return { ok: true, body: detail({ status: calls === 1 ? "FUNDED" : "RELEASED" }) };
      },
      "POST /api/escrow/e1/confirm": () => ({ ok: true, body: { ok: true } }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    renderIt();

    await user.click(await screen.findByRole("button", { name: ko.escrow.confirm }));

    expect(await screen.findByText(ko.escrow.doneReleased)).toBeInTheDocument();
    const postCall = fetchMock.mock.calls.find(
      ([u, init]) => String(u).includes("/confirm") && (init as RequestInit | undefined)?.method === "POST",
    );
    expect(postCall).toBeTruthy();
  });

  it("maps an action error code to the catalog message, never the raw server text", async () => {
    const fetchMock = routedFetch({
      "GET /api/escrow/e1": () => ({ ok: true, body: detail({ myRole: "buyer" }) }),
      "POST /api/escrow/e1/confirm": () => ({
        ok: false,
        status: 409,
        body: { code: "INVALID_TRANSITION", message: "leaky server text" },
      }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    renderIt();

    await user.click(await screen.findByRole("button", { name: ko.escrow.confirm }));

    expect(await screen.findByRole("alert")).toHaveTextContent(ko.escrow.invalidTransition);
    expect(screen.queryByText("leaky server text")).not.toBeInTheDocument();
  });

  it("RELEASED: shows the done message and no participant action buttons", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => detail({ status: "RELEASED" }) }));
    renderIt();

    expect(await screen.findByText(ko.escrow.doneReleased)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: ko.escrow.confirm })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: ko.escrow.refund })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: ko.escrow.cancel })).not.toBeInTheDocument();
  });

  it("renders the event timeline with status labels and actor labels, never a raw enum or the counterparty's userId", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => detail() }));
    const { container } = renderIt();

    await screen.findByText("풀숲여우");
    // 타임라인 상태는 카탈로그 라벨로만
    expect(container.innerHTML).not.toMatch(/REQUESTED|ACCEPTED|FUNDED|RELEASED/);
    expect(screen.getAllByText(ko.escrow.actorMe).length).toBeGreaterThan(0);
    expect(screen.getAllByText(ko.escrow.actorOther).length).toBeGreaterThan(0);
  });

  it("maps a detail load 403 FORBIDDEN to the catalog message", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 403, json: async () => ({ code: "FORBIDDEN" }) }),
    );
    renderIt();

    expect(await screen.findByRole("alert")).toHaveTextContent(ko.escrow.forbidden);
  });
});
