import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { ProductDetail, type ProductDetailView } from "./ProductDetail";
import ko from "@/i18n/messages/ko.json";

const push = vi.fn();
const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh }) }));

const product: ProductDetailView = {
  id: "p1",
  title: "아이폰 팝니다",
  description: "상태 좋아요",
  price: 500000,
  category: "DIGITAL",
  status: "SELLING",
  regionLabel: "서울시 강남구 역삼동",
  directPlace: "역삼역 2번 출구",
  images: [{ path: "products/a.webp", order: 0 }],
  sellerNickname: "풀숲여우",
  createdAt: "2025-01-01T00:00:00.000Z",
};

function renderIt(p: ProductDetailView = product, isOwner = false) {
  return render(
    <NextIntlClientProvider locale="ko" messages={ko}>
      <ProductDetail product={p} isOwner={isOwner} />
    </NextIntlClientProvider>,
  );
}

function jsonOk(body: unknown = { ok: true }) {
  return { ok: true, json: async () => body };
}
function jsonFail(status: number, code: string) {
  return { ok: false, status, json: async () => ({ code, message: "leaky server text" }) };
}

beforeEach(() => {
  push.mockClear();
  refresh.mockClear();
});
afterEach(() => vi.unstubAllGlobals());

describe("ProductDetail", () => {
  it("renders title, price, category/status, region, direct place, and links to the seller's public profile", () => {
    renderIt();
    expect(screen.getByText("아이폰 팝니다")).toBeInTheDocument();
    expect(screen.getByText("500,000원")).toBeInTheDocument();
    expect(screen.getByText("역삼역 2번 출구")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "풀숲여우" })).toHaveAttribute("href", "/u/풀숲여우");
  });

  it("shows an enabled chat button for non-owners, and no owner controls", () => {
    renderIt(product, false);
    expect(screen.getByRole("button", { name: ko.product.chat })).toBeEnabled();
    expect(screen.queryByText(ko.product.editButton)).not.toBeInTheDocument();
    expect(screen.queryByText(ko.product.deleteButton)).not.toBeInTheDocument();
  });

  it("non-owner: clicking chat opens a first-message compose form, then POSTs and navigates to the conversation", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonOk({ conversationId: "c1", message: {} })));
    const user = userEvent.setup();
    renderIt(product, false);

    await user.click(screen.getByRole("button", { name: ko.product.chat }));
    await user.type(screen.getByPlaceholderText(ko.chat.composePlaceholder), "안녕하세요 아직 판매 중인가요?");
    await user.click(screen.getByRole("button", { name: ko.chat.send }));

    await waitFor(() => {
      const call = (fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls[0];
      expect(call[0]).toBe("/api/chat/conversations");
      expect((call[1] as RequestInit).method).toBe("POST");
      expect(JSON.parse((call[1] as RequestInit).body as string)).toEqual({
        productId: "p1",
        firstText: "안녕하세요 아직 판매 중인가요?",
      });
    });
    expect(push).toHaveBeenCalledWith("/chat/c1");
  });

  it("non-owner: maps a BLOCKED chat error to the catalog message, never the raw server text", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonFail(403, "BLOCKED")));
    const user = userEvent.setup();
    renderIt(product, false);

    await user.click(screen.getByRole("button", { name: ko.product.chat }));
    await user.type(screen.getByPlaceholderText(ko.chat.composePlaceholder), "hi");
    await user.click(screen.getByRole("button", { name: ko.chat.send }));

    expect(await screen.findByRole("alert")).toHaveTextContent(ko.chat.blocked);
    expect(screen.queryByText("leaky server text")).not.toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
  });

  it("owner: never shows a chat button or compose form", () => {
    renderIt(product, true);
    expect(screen.queryByRole("button", { name: ko.product.chat })).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText(ko.chat.composePlaceholder)).not.toBeInTheDocument();
  });

  it("non-owner: shows an escrow request button", () => {
    renderIt(product, false);
    expect(screen.getByRole("button", { name: ko.escrow.request })).toBeInTheDocument();
  });

  it("owner: never shows an escrow request button", () => {
    renderIt(product, true);
    expect(screen.queryByRole("button", { name: ko.escrow.request })).not.toBeInTheDocument();
  });

  it("non-owner: requesting escrow POSTs {productId, amount defaulting to price} then navigates to the room", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonOk({ id: "e1" })));
    const user = userEvent.setup();
    renderIt(product, false);

    await user.click(screen.getByRole("button", { name: ko.escrow.request }));
    await user.click(screen.getByRole("button", { name: ko.escrow.requestSubmit }));

    await waitFor(() => {
      const call = (fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls[0];
      expect(call[0]).toBe("/api/escrow");
      expect((call[1] as RequestInit).method).toBe("POST");
      expect(JSON.parse((call[1] as RequestInit).body as string)).toEqual({
        productId: "p1",
        amount: 500000,
      });
    });
    expect(push).toHaveBeenCalledWith("/escrow/e1");
  });

  it("non-owner: maps a SELF_TRADE escrow error to the catalog message, never the raw server text", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonFail(400, "SELF_TRADE")));
    const user = userEvent.setup();
    renderIt(product, false);

    await user.click(screen.getByRole("button", { name: ko.escrow.request }));
    await user.click(screen.getByRole("button", { name: ko.escrow.requestSubmit }));

    expect(await screen.findByRole("alert")).toHaveTextContent(ko.escrow.selfTrade);
    expect(screen.queryByText("leaky server text")).not.toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
  });

  it("shows edit/delete/status controls for the owner, and never a chat button", () => {
    renderIt(product, true);
    expect(screen.getByRole("link", { name: ko.product.editButton })).toHaveAttribute(
      "href",
      "/products/p1/edit",
    );
    expect(screen.getByRole("button", { name: ko.product.deleteButton })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: ko.product.toReserved })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: ko.product.toSold })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: ko.product.chat })).not.toBeInTheDocument();
  });

  it("owner: status button POSTs the target status, then refreshes", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonOk()));
    const user = userEvent.setup();
    renderIt(product, true);

    await user.click(screen.getByRole("button", { name: ko.product.toReserved }));

    await waitFor(() => {
      const call = (fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls[0];
      expect(call[0]).toBe("/api/products/p1/status");
      expect((call[1] as RequestInit).method).toBe("POST");
      expect(JSON.parse((call[1] as RequestInit).body as string)).toEqual({ status: "RESERVED" });
    });
    expect(refresh).toHaveBeenCalled();
    expect(screen.getByText(ko.product.status.RESERVED)).toBeInTheDocument();
  });

  it("owner: maps INVALID_TRANSITION to the catalog message, never the server text", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonFail(409, "INVALID_TRANSITION")));
    const user = userEvent.setup();
    renderIt(product, true);

    await user.click(screen.getByRole("button", { name: ko.product.toSold }));

    expect(await screen.findByRole("alert")).toHaveTextContent(ko.product.invalidTransition);
    expect(screen.queryByText("leaky server text")).not.toBeInTheDocument();
  });

  it("owner: delete requires confirmation, then DELETEs and routes to /products", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonOk()));
    const user = userEvent.setup();
    renderIt(product, true);

    await user.click(screen.getByRole("button", { name: ko.product.deleteButton }));
    expect(screen.getByText(ko.product.deleteConfirm)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: ko.product.deleteConfirmButton }));

    await waitFor(() => {
      const call = (fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls[0];
      expect(call[0]).toBe("/api/products/p1");
      expect((call[1] as RequestInit).method).toBe("DELETE");
    });
    expect(push).toHaveBeenCalledWith("/products");
  });

  it("never renders seller email/phone or coordinates — no such fields exist on the view type", () => {
    const { container } = renderIt(product, true);
    const html = container.innerHTML;
    expect(html).not.toMatch(/@.+\..+/);
    expect(html).not.toMatch(/\d{2,3}-\d{3,4}-\d{4}/);
    expect(html).not.toMatch(/\blat\b|\blng\b|latitude|longitude/i);
  });
});
