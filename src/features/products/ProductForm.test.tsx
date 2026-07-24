import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { ProductForm } from "./ProductForm";
import ko from "@/i18n/messages/ko.json";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh: vi.fn() }) }));

function renderCreate() {
  return render(
    <NextIntlClientProvider locale="ko" messages={ko}>
      <ProductForm mode="create" />
    </NextIntlClientProvider>,
  );
}

function renderEdit() {
  return render(
    <NextIntlClientProvider locale="ko" messages={ko}>
      <ProductForm
        mode="edit"
        productId="p1"
        initial={{
          title: "아이폰 팝니다",
          price: 500000,
          category: "DIGITAL",
          description: "상태 좋아요",
          directPlace: "역삼역",
          images: [{ path: "products/a.webp", order: 0 }],
        }}
      />
    </NextIntlClientProvider>,
  );
}

function jsonOk(body: unknown) {
  return { ok: true, json: async () => body };
}
function jsonFail(status: number, code: string) {
  return { ok: false, status, json: async () => ({ code, message: "leaky server text" }) };
}

beforeEach(() => push.mockClear());
afterEach(() => vi.unstubAllGlobals());

describe("ProductForm — create mode", () => {
  it("uploads a selected image, then POSTs /api/products with the collected path and routes to the new product", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonOk({ path: "products/new.webp" }))
      .mockResolvedValueOnce(jsonOk({ id: "p9" }));
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    renderCreate();

    await user.type(screen.getByLabelText(ko.product.titleLabel), "아이폰 팝니다");
    await user.clear(screen.getByLabelText(ko.product.price));
    await user.type(screen.getByLabelText(ko.product.price), "500000");
    await user.type(screen.getByLabelText(ko.product.description), "상태 좋아요");

    const file = new File(["x"], "a.jpg", { type: "image/jpeg" });
    await user.upload(screen.getByLabelText(ko.product.addImage), file);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(fetchMock.mock.calls[0][0]).toBe("/api/products/images");

    await user.click(screen.getByRole("button", { name: ko.product.createButton }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const call = fetchMock.mock.calls[1];
    expect(call[0]).toBe("/api/products");
    expect(call[1].method).toBe("POST");
    const body = JSON.parse(call[1].body);
    expect(body.title).toBe("아이폰 팝니다");
    expect(body.price).toBe(500000);
    expect(body.description).toBe("상태 좋아요");
    expect(body.images).toEqual(["products/new.webp"]);

    await waitFor(() => expect(push).toHaveBeenCalledWith("/products/p9"));
  });

  it("shows the '위치를 먼저 설정' notice with a link to /settings/location on NO_LOCATION", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonFail(400, "NO_LOCATION")));
    const user = userEvent.setup();
    renderCreate();

    await user.type(screen.getByLabelText(ko.product.titleLabel), "제목");
    await user.click(screen.getByRole("button", { name: ko.product.createButton }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("위치를 먼저 설정");
    expect(screen.getByRole("link", { name: ko.product.goToLocationSettings })).toHaveAttribute(
      "href",
      "/settings/location",
    );
    expect(push).not.toHaveBeenCalled();
  });

  it("maps INVALID_IMAGE to the catalog message, never the server text", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonFail(400, "INVALID_IMAGE")));
    const user = userEvent.setup();
    renderCreate();

    const file = new File(["x"], "a.jpg", { type: "image/jpeg" });
    await user.upload(screen.getByLabelText(ko.product.addImage), file);

    expect(await screen.findByRole("alert")).toHaveTextContent(ko.product.invalidImage);
    expect(screen.queryByText("leaky server text")).not.toBeInTheDocument();
  });
});

describe("ProductForm — edit mode", () => {
  it("PATCHes the product's own endpoint with field edits and no images key, then routes to the detail page", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonOk({ ok: true })));
    const user = userEvent.setup();
    renderEdit();

    const titleInput = screen.getByLabelText(ko.product.titleLabel);
    await user.clear(titleInput);
    await user.type(titleInput, "아이폰 급처");
    await user.click(screen.getByRole("button", { name: ko.product.editButton }));

    await waitFor(() => {
      const call = (fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls[0];
      expect(call[0]).toBe("/api/products/p1");
      expect((call[1] as RequestInit).method).toBe("PATCH");
      const body = JSON.parse((call[1] as RequestInit).body as string);
      expect(body.title).toBe("아이폰 급처");
      expect(body).not.toHaveProperty("images");
    });
    await waitFor(() => expect(push).toHaveBeenCalledWith("/products/p1"));
  });

  it("does not render an image-upload control in edit mode", () => {
    renderEdit();
    expect(screen.queryByLabelText(ko.product.addImage)).not.toBeInTheDocument();
  });
});
