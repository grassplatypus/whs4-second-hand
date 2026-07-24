import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { ChatList, type ChatListItem } from "./ChatList";
import ko from "@/i18n/messages/ko.json";

function renderIt() {
  return render(
    <NextIntlClientProvider locale="ko" messages={ko}>
      <ChatList />
    </NextIntlClientProvider>,
  );
}

function ok(conversations: ChatListItem[]) {
  return { ok: true, json: async () => ({ conversations }) };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const item: ChatListItem = {
  conversationId: "c1",
  otherNickname: "풀숲여우",
  product: { id: "p1", title: "빈티지 가죽 재킷" },
  lastMessageAt: "2026-01-01T00:00:00.000Z",
};

describe("ChatList", () => {
  it("leads each row with the PRODUCT TITLE, with the other party's nickname as secondary text, linking to the chat room (#1)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(ok([item])));
    renderIt();

    const heading = await screen.findByText("빈티지 가죽 재킷");
    expect(heading).toBeInTheDocument();
    expect(await screen.findByText("풀숲여우")).toBeInTheDocument();
    const link = heading.closest("a");
    expect(link).toHaveAttribute("href", "/chat/c1");
  });

  it("falls back to a deleted-product label when the product title is empty", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(ok([{ ...item, product: { id: "p1", title: "" } }])),
    );
    renderIt();

    expect(await screen.findByText(ko.chat.deletedProduct)).toBeInTheDocument();
  });

  it("never renders the other party's email/phone — no such fields exist on the item shape", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(ok([item])));
    const { container } = renderIt();
    await screen.findByText("풀숲여우");

    expect(container.innerHTML).not.toMatch(/@.+\..+/);
    expect(container.innerHTML).not.toMatch(/\d{2,3}-\d{3,4}-\d{4}/);
  });

  it("shows a loading skeleton before the fetch resolves", async () => {
    let resolveFetch: (v: unknown) => void = () => {};
    const pending = new Promise((resolve) => {
      resolveFetch = resolve;
    });
    vi.stubGlobal("fetch", vi.fn().mockReturnValue(pending));
    const { container } = renderIt();

    expect(container.querySelector(".animate-pulse")).toBeInTheDocument();
    resolveFetch(ok([]));
    await screen.findByText(ko.chat.empty);
  });

  it("shows the empty state with a CTA when there are no conversations", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(ok([])));
    renderIt();

    expect(await screen.findByText(ko.chat.empty)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: ko.chat.emptyCta })).toHaveAttribute("href", "/products");
  });

  it("guards an invalid lastMessageAt (NaN date) instead of rendering 'Invalid Date'", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(ok([{ ...item, lastMessageAt: "not-a-date" }])));
    renderIt();

    await screen.findByText("빈티지 가죽 재킷");
    expect(screen.queryByText(/Invalid Date/i)).not.toBeInTheDocument();
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("maps a failed fetch to the catalog failed message, never a raw server message", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({ code: "SERVER_ERROR" }) }),
    );
    renderIt();

    expect(await screen.findByRole("alert")).toHaveTextContent(ko.chat.failed);
  });
});
