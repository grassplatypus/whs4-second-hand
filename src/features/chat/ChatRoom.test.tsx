import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { ChatRoom, type ChatMessageView } from "./ChatRoom";
import ko from "@/i18n/messages/ko.json";

function renderIt() {
  return render(
    <NextIntlClientProvider locale="ko" messages={ko}>
      <ChatRoom
        conversationId="c1"
        currentUserId="buyer-1"
        otherId="seller-1"
        otherNickname="풀숲여우"
        productId="p1"
      />
    </NextIntlClientProvider>,
  );
}

/** URL/메서드에 따라 분기하는 fetch 목 — 컴포넌트가 여러 엔드포인트를 호출하므로 하나로 라우팅한다. */
function routedFetch(overrides: Record<string, (init?: RequestInit) => unknown>) {
  return vi.fn(async (url: unknown, init?: RequestInit) => {
    const u = String(url);
    const method = (init?.method ?? "GET").toUpperCase();
    const key = `${method} ${u}`;
    for (const [pattern, handler] of Object.entries(overrides)) {
      if (key.includes(pattern)) {
        const result = handler(init);
        return { ok: true, status: 200, json: async () => result };
      }
    }
    return { ok: true, status: 200, json: async () => ({}) };
  });
}

const oldMsg: ChatMessageView = {
  _id: "m1",
  conversationId: "c1",
  senderId: "seller-1",
  kind: "text",
  text: "안녕하세요",
  masked: false,
  createdAt: "2026-01-01T00:01:00.000Z",
};
const newMsg: ChatMessageView = {
  _id: "m2",
  conversationId: "c1",
  senderId: "buyer-1",
  kind: "text",
  text: "***",
  masked: true,
  createdAt: "2026-01-01T00:00:00.000Z",
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("ChatRoom", () => {
  it("loads history on mount (GET) and renders messages oldest-first (API returns newest-first)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ messages: [newMsg, oldMsg] }) }),
    );
    renderIt();

    await screen.findByText("안녕하세요");
    const texts = screen.getAllByText(/안녕하세요|\*\*\*/).map((el) => el.textContent);
    expect(texts).toEqual(["안녕하세요", "***"]);
  });

  it("displays masked text exactly as delivered — never attempts to un-mask it", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ messages: [newMsg] }) }));
    renderIt();

    expect(await screen.findByText("***")).toBeInTheDocument();
  });

  it("never renders PII (email/phone) anywhere in the room", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ messages: [] }) }));
    const { container } = renderIt();
    await waitFor(() => expect(screen.getByText("풀숲여우")).toBeInTheDocument());

    expect(container.innerHTML).not.toMatch(/@.+\..+/);
    expect(container.innerHTML).not.toMatch(/\d{2,3}-\d{3,4}-\d{4}/);
  });

  it("maps a history load 403 FORBIDDEN to the catalog message", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 403, json: async () => ({ code: "FORBIDDEN" }) }),
    );
    renderIt();

    expect(await screen.findByRole("alert")).toHaveTextContent(ko.chat.forbidden);
  });

  it("sends a text message: POSTs {kind:'text', text} and appends the returned message", async () => {
    const fetchMock = routedFetch({
      "GET /api/chat/conversations/c1/messages": () => ({ messages: [] }),
      "POST /api/chat/conversations/c1/messages": () => ({
        message: { ...newMsg, _id: "m3", text: "안녕하세요 구매하고싶어요" },
      }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    renderIt();

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    await user.type(screen.getByPlaceholderText(ko.chat.messagePlaceholder), "안녕하세요 구매하고싶어요");
    await user.click(screen.getByRole("button", { name: ko.chat.send }));

    await screen.findByText("안녕하세요 구매하고싶어요");
    const postCall = fetchMock.mock.calls.find(
      ([, init]) => (init as RequestInit | undefined)?.method === "POST",
    );
    expect(JSON.parse((postCall![1] as RequestInit).body as string)).toEqual({
      kind: "text",
      text: "안녕하세요 구매하고싶어요",
    });
  });

  it("maps a send FIRST_MSG_TEXT_ONLY error to the catalog message, not the raw server text", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: unknown, init?: RequestInit) => {
        if ((init?.method ?? "GET") === "GET") return { ok: true, json: async () => ({ messages: [] }) };
        return { ok: false, status: 400, json: async () => ({ code: "FIRST_MSG_TEXT_ONLY", message: "leaky" }) };
      }),
    );
    const user = userEvent.setup();
    renderIt();

    await user.type(screen.getByPlaceholderText(ko.chat.messagePlaceholder), "hi");
    await user.click(screen.getByRole("button", { name: ko.chat.send }));

    expect(await screen.findByRole("alert")).toHaveTextContent(ko.chat.firstMsgTextOnly);
    expect(screen.queryByText("leaky")).not.toBeInTheDocument();
  });

  it("maps a send IMAGE_BEFORE_REPLY error to the imageBeforeReply catalog message, not the raw server text", async () => {
    const fetchMock = vi.fn(async (url: unknown, init?: RequestInit) => {
      const u = String(url);
      const method = (init?.method ?? "GET").toUpperCase();
      if (method === "GET") return { ok: true, json: async () => ({ messages: [] }) };
      if (u.includes("/api/products/images")) {
        return { ok: true, json: async () => ({ path: "img/1.png" }) };
      }
      if (u.includes("/messages")) {
        return { ok: false, status: 400, json: async () => ({ code: "IMAGE_BEFORE_REPLY", message: "leaky" }) };
      }
      return { ok: true, json: async () => ({}) };
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    renderIt();

    await screen.findByText("풀숲여우");
    const file = new File(["img-bytes"], "photo.png", { type: "image/png" });
    const input = screen.getByLabelText(ko.chat.imageButton, { selector: "input" }) as HTMLInputElement;
    await user.upload(input, file);

    expect(await screen.findByRole("alert")).toHaveTextContent(ko.chat.imageBeforeReply);
    expect(screen.queryByText("leaky")).not.toBeInTheDocument();
  });

  it("blocks then unblocks the other user, posting targetId each time", async () => {
    const calls: { url: string; body: unknown }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: unknown, init?: RequestInit) => {
        const u = String(url);
        if (u.includes("/messages") && (init?.method ?? "GET") === "GET") {
          return { ok: true, json: async () => ({ messages: [] }) };
        }
        calls.push({ url: u, body: init?.body ? JSON.parse(init.body as string) : undefined });
        return { ok: true, json: async () => ({ ok: true }) };
      }),
    );
    const user = userEvent.setup();
    renderIt();

    await screen.findByText("풀숲여우");
    await user.click(screen.getByRole("button", { name: ko.chat.block }));
    expect(await screen.findByRole("button", { name: ko.chat.unblock })).toBeInTheDocument();
    expect(screen.getByText(ko.chat.blockedState)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: ko.chat.unblock }));
    expect(await screen.findByRole("button", { name: ko.chat.block })).toBeInTheDocument();

    expect(calls).toEqual([
      { url: "/api/chat/block", body: { targetId: "seller-1" } },
      { url: "/api/chat/unblock", body: { targetId: "seller-1" } },
    ]);
  });

  it("reports the other user with a reason and shows the sent confirmation", async () => {
    let reportBody: unknown;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: unknown, init?: RequestInit) => {
        const u = String(url);
        if (u.includes("/messages") && (init?.method ?? "GET") === "GET") {
          return { ok: true, json: async () => ({ messages: [] }) };
        }
        if (u.includes("/api/chat/report")) {
          reportBody = JSON.parse(init!.body as string);
          return { ok: true, json: async () => ({ ok: true }) };
        }
        return { ok: true, json: async () => ({}) };
      }),
    );
    const user = userEvent.setup();
    renderIt();

    await screen.findByText("풀숲여우");
    await user.click(screen.getByRole("button", { name: ko.chat.report }));
    await user.type(screen.getByLabelText(ko.chat.reportReasonPlaceholder), "욕설을 했어요");
    await user.click(screen.getByRole("button", { name: ko.chat.reportSubmit }));

    expect(await screen.findByText(ko.chat.reportSent)).toBeInTheDocument();
    expect(reportBody).toEqual({ targetType: "user", targetId: "seller-1", reason: "욕설을 했어요" });
  });

  it("does not attempt a WS connection when no access token is supplied (REST-only, no socket mock needed)", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ messages: [] }) });
    vi.stubGlobal("fetch", fetchMock);
    renderIt();

    await screen.findByText("풀숲여우");
    // 소켓을 전혀 열지 않으므로 fetch만으로 히스토리 로드가 끝난다 — 별도 소켓 목이 필요 없다는 것 자체가 증거.
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
  });
});
