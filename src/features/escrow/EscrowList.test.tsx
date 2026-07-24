import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { EscrowList, type EscrowListItemView } from "./EscrowList";
import ko from "@/i18n/messages/ko.json";

function renderIt() {
  return render(
    <NextIntlClientProvider locale="ko" messages={ko}>
      <EscrowList />
    </NextIntlClientProvider>,
  );
}

function ok(escrows: EscrowListItemView[]) {
  return { ok: true, json: async () => ({ escrows }) };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const item: EscrowListItemView = {
  id: "e1",
  status: "FUNDED",
  amount: 10000,
  myRole: "buyer",
  counterparty: { nickname: "풀숲여우" },
  product: { id: "p1", title: "아이폰 팝니다" },
  updatedAt: "2026-01-01T00:00:00.000Z",
};

describe("EscrowList", () => {
  it("fetches escrows on mount and renders product title, counterparty, KRW amount and status label, linking to the room", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(ok([item])));
    renderIt();

    expect(await screen.findByText("아이폰 팝니다")).toBeInTheDocument();
    expect(screen.getByText("풀숲여우")).toBeInTheDocument();
    expect(screen.getByText("10,000원")).toBeInTheDocument();
    expect(screen.getByText(ko.escrow.status.FUNDED)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /아이폰 팝니다/ })).toHaveAttribute("href", "/escrow/e1");
  });

  it("renders the status via the catalog label, never the raw enum", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(ok([item])));
    const { container } = renderIt();
    await screen.findByText("아이폰 팝니다");

    expect(container.innerHTML).not.toMatch(/FUNDED/);
  });

  it("never renders the counterparty's email/phone — no such fields exist on the item shape", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(ok([item])));
    const { container } = renderIt();
    await screen.findByText("풀숲여우");

    expect(container.innerHTML).not.toMatch(/@.+\..+/);
    expect(container.innerHTML).not.toMatch(/\d{2,3}-\d{3,4}-\d{4}/);
  });

  it("shows the empty state when there are no escrows", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(ok([])));
    renderIt();

    expect(await screen.findByText(ko.escrow.empty)).toBeInTheDocument();
  });

  it("maps a failed fetch to the catalog failed message, never a raw server message", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({ code: "SERVER_ERROR" }) }),
    );
    renderIt();

    expect(await screen.findByRole("alert")).toHaveTextContent(ko.escrow.failed);
  });
});
