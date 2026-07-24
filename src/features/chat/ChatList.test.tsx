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
  productId: "p1",
  lastMessageAt: "2026-01-01T00:00:00.000Z",
};

describe("ChatList", () => {
  it("fetches conversations on mount and renders the other party's nickname, linking to the chat room", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(ok([item])));
    renderIt();

    expect(await screen.findByText("풀숲여우")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /풀숲여우/ })).toHaveAttribute("href", "/chat/c1");
  });

  it("never renders the other party's email/phone — no such fields exist on the item shape", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(ok([item])));
    const { container } = renderIt();
    await screen.findByText("풀숲여우");

    expect(container.innerHTML).not.toMatch(/@.+\..+/);
    expect(container.innerHTML).not.toMatch(/\d{2,3}-\d{3,4}-\d{4}/);
  });

  it("shows the empty state when there are no conversations", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(ok([])));
    renderIt();

    expect(await screen.findByText(ko.chat.empty)).toBeInTheDocument();
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
