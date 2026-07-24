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

  it("groups the price with thousands commas as the user types, but submits a plain number", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonOk({ id: "p9" })));
    const user = userEvent.setup();
    renderCreate();

    const priceInput = screen.getByLabelText(ko.product.price);
    await user.clear(priceInput);
    await user.type(priceInput, "1234000");

    expect(priceInput).toHaveValue("1,234,000");

    await user.type(screen.getByLabelText(ko.product.titleLabel), "노트북 팝니다");
    await user.click(screen.getByRole("button", { name: ko.product.createButton }));

    await waitFor(() => {
      const call = (fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls[0];
      const body = JSON.parse((call[1] as RequestInit).body as string);
      expect(body.price).toBe(1234000);
    });
  });

  it("strips commas/non-digits when the price is pasted in", async () => {
    const user = userEvent.setup();
    renderCreate();

    const priceInput = screen.getByLabelText(ko.product.price);
    await user.clear(priceInput);
    await user.click(priceInput);
    await user.paste("1,234,000");

    expect(priceInput).toHaveValue("1,234,000"); // re-formatted display
    // the underlying state is the plain digit string — verify via a submit.
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonOk({ id: "p9" })));
    await user.type(screen.getByLabelText(ko.product.titleLabel), "제목");
    await user.click(screen.getByRole("button", { name: ko.product.createButton }));

    await waitFor(() => {
      const call = (fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls[0];
      const body = JSON.parse((call[1] as RequestInit).body as string);
      expect(body.price).toBe(1234000);
    });
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

  it("shows a proactive warning banner with a link to /settings/location when hasLocation is false", () => {
    render(
      <NextIntlClientProvider locale="ko" messages={ko}>
        <ProductForm mode="create" hasLocation={false} />
      </NextIntlClientProvider>,
    );
    expect(screen.getByText(ko.product.noLocation)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: ko.product.goToLocationSettings })).toHaveAttribute(
      "href",
      "/settings/location",
    );
  });

  it("does not show the proactive warning banner when hasLocation is true", () => {
    render(
      <NextIntlClientProvider locale="ko" messages={ko}>
        <ProductForm mode="create" hasLocation={true} />
      </NextIntlClientProvider>,
    );
    expect(screen.queryByText(ko.product.noLocation)).not.toBeInTheDocument();
  });

  it("warns via beforeunload when the form has unsaved edits, and confirms before cancel navigates away", async () => {
    const user = userEvent.setup();
    renderCreate();

    await user.type(screen.getByLabelText(ko.product.titleLabel), "아이폰");

    const event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);

    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    await user.click(screen.getByRole("button", { name: ko.product.cancelButton }));
    expect(confirmSpy).toHaveBeenCalledWith(ko.product.unsavedChangesConfirm);
    expect(push).not.toHaveBeenCalled();

    confirmSpy.mockReturnValue(true);
    await user.click(screen.getByRole("button", { name: ko.product.cancelButton }));
    expect(push).toHaveBeenCalledWith("/products");
    confirmSpy.mockRestore();
  });

  it("does not warn on beforeunload nor confirm on cancel when the form is untouched", async () => {
    const user = userEvent.setup();
    renderCreate();

    const event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);

    const confirmSpy = vi.spyOn(window, "confirm");
    await user.click(screen.getByRole("button", { name: ko.product.cancelButton }));
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(push).toHaveBeenCalledWith("/products");
    confirmSpy.mockRestore();
  });
});

describe("ProductForm — edit mode", () => {
  it("PATCHes the product's own endpoint with field edits and the current images array, then routes to the detail page", async () => {
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
      expect(body.images).toEqual(["products/a.webp"]);
    });
    await waitFor(() => expect(push).toHaveBeenCalledWith("/products/p1"));
  });

  it("renders an image-upload control in edit mode, pre-filled with the product's existing images", () => {
    renderEdit();
    expect(screen.getByLabelText(ko.product.addImage)).toBeInTheDocument();
    expect(screen.getByRole("img", { name: ko.product.imagePreviewAlt.replace("{index}", "1") })).toHaveAttribute(
      "src",
      "/api/media/products/a.webp",
    );
  });

  it("uploads a new image and removes an existing one, then PATCHes the updated images array", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonOk({ path: "products/new.webp" }))
      .mockResolvedValueOnce(jsonOk({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    renderEdit();

    // 기존 이미지를 지운다 — 인덱스가 매겨진 접근성 이름으로 정확히 그 버튼을 골라야 한다.
    await user.click(screen.getByRole("button", { name: ko.product.removeImageAria.replace("{index}", "1") }));
    expect(screen.queryByLabelText(ko.product.imagePreviewAlt.replace("{index}", "1"))).not.toBeInTheDocument();

    const file = new File(["x"], "b.jpg", { type: "image/jpeg" });
    await user.upload(screen.getByLabelText(ko.product.addImage), file);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    await user.click(screen.getByRole("button", { name: ko.product.editButton }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const call = fetchMock.mock.calls[1];
    const body = JSON.parse(call[1].body);
    expect(body.images).toEqual(["products/new.webp"]);
  });
});
