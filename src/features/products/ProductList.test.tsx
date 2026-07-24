import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { ProductList } from "./ProductList";
import ko from "@/i18n/messages/ko.json";

function renderIt() {
  return render(
    <NextIntlClientProvider locale="ko" messages={ko}>
      <ProductList />
    </NextIntlClientProvider>,
  );
}

function page(items: unknown[], nextCursor: string | null = null) {
  return { ok: true, json: async () => ({ items, nextCursor }) };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const card = {
  id: "p1",
  title: "아이폰 팝니다",
  price: 500000,
  category: "DIGITAL",
  status: "SELLING",
  thumbnail: null,
  regionLabel: "서울시 강남구",
  distanceKm: null,
};

describe("ProductList", () => {
  it("fetches the default list on mount, then re-fetches with q/category/min/max filters on submit", async () => {
    const fetchMock = vi.fn().mockResolvedValue(page([card]));
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    renderIt();

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(await screen.findByText("아이폰 팝니다")).toBeInTheDocument();

    await user.type(screen.getByLabelText(ko.product.searchLabel), "아이폰");
    await user.selectOptions(screen.getByLabelText(ko.product.categoryLabel), "DIGITAL");
    await user.type(screen.getByLabelText(ko.product.minPrice), "1000");
    await user.type(screen.getByLabelText(ko.product.maxPrice), "900000");
    await user.click(screen.getByRole("button", { name: ko.product.search }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const url = new URL(fetchMock.mock.calls[1][0], "http://localhost");
    expect(url.pathname).toBe("/api/products");
    expect(url.searchParams.get("q")).toBe("아이폰");
    expect(url.searchParams.get("category")).toBe("DIGITAL");
    expect(url.searchParams.get("minPrice")).toBe("1000");
    expect(url.searchParams.get("maxPrice")).toBe("900000");
  });

  it("does not send lat/lng when no radius is set", async () => {
    const fetchMock = vi.fn().mockResolvedValue(page([]));
    vi.stubGlobal("fetch", fetchMock);
    renderIt();

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const url = new URL(fetchMock.mock.calls[0][0], "http://localhost");
    expect(url.searchParams.has("lat")).toBe(false);
    expect(url.searchParams.has("radiusKm")).toBe(false);
  });

  it("fetches the browser's current position and includes lat/lng/radiusKm when a radius is set", async () => {
    const fetchMock = vi.fn().mockResolvedValue(page([]));
    vi.stubGlobal("fetch", fetchMock);
    const getCurrentPosition = vi.fn((success: PositionCallback) =>
      success({ coords: { latitude: 37.5, longitude: 127.0 } } as GeolocationPosition),
    );
    Object.defineProperty(window.navigator, "geolocation", {
      value: { getCurrentPosition },
      configurable: true,
    });
    const user = userEvent.setup();
    renderIt();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    await user.type(screen.getByLabelText(ko.product.radius), "5");
    await user.click(screen.getByRole("button", { name: ko.product.search }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const url = new URL(fetchMock.mock.calls[1][0], "http://localhost");
    expect(url.searchParams.get("radiusKm")).toBe("5");
    expect(url.searchParams.get("lat")).toBe("37.5");
    expect(url.searchParams.get("lng")).toBe("127");
  });

  it("shows 더보기 when nextCursor is present, and requests the next page with cursor on click", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(page([card], "cursor-1"))
      .mockResolvedValueOnce(page([{ ...card, id: "p2", title: "두번째 상품" }], null));
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    renderIt();

    expect(await screen.findByRole("button", { name: ko.product.loadMore })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: ko.product.loadMore }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const url = new URL(fetchMock.mock.calls[1][0], "http://localhost");
    expect(url.searchParams.get("cursor")).toBe("cursor-1");
    expect(await screen.findByText("두번째 상품")).toBeInTheDocument();
    expect(screen.getByText("아이폰 팝니다")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: ko.product.loadMore })).not.toBeInTheDocument();
  });

  it("re-fetches immediately with the chosen status when a status filter button is clicked, and omits it when 전체 is chosen again", async () => {
    const fetchMock = vi.fn().mockResolvedValue(page([card]));
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    renderIt();

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(new URL(fetchMock.mock.calls[0][0], "http://localhost").searchParams.has("status")).toBe(false);

    await user.click(screen.getByRole("button", { name: ko.product.status.SELLING }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(new URL(fetchMock.mock.calls[1][0], "http://localhost").searchParams.get("status")).toBe("SELLING");

    await user.click(screen.getByRole("button", { name: ko.product.status.SOLD }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expect(new URL(fetchMock.mock.calls[2][0], "http://localhost").searchParams.get("status")).toBe("SOLD");

    await user.click(screen.getByRole("button", { name: ko.product.statusAll }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4));
    expect(new URL(fetchMock.mock.calls[3][0], "http://localhost").searchParams.has("status")).toBe(false);
  });

  it("maps a failed fetch to the catalog failed message", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({}) }));
    renderIt();
    expect(await screen.findByRole("alert")).toHaveTextContent(ko.product.failed);
  });

  it("shows an empty state with a reset-filters action when the search returns no results", async () => {
    const fetchMock = vi.fn().mockResolvedValue(page([]));
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    renderIt();

    expect(await screen.findByText(ko.product.empty)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: ko.product.emptyCta })).toHaveAttribute("href", "/products/new");

    await user.type(screen.getByLabelText(ko.product.searchLabel), "아이폰");
    await user.click(screen.getByRole("button", { name: ko.product.resetFilters }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(screen.getByLabelText(ko.product.searchLabel)).toHaveValue("");
  });

  it("notes that the radius filter didn't apply when geolocation fails", async () => {
    const fetchMock = vi.fn().mockResolvedValue(page([]));
    vi.stubGlobal("fetch", fetchMock);
    const getCurrentPosition = vi.fn((_success: PositionCallback, error: PositionErrorCallback) => error({} as GeolocationPositionError));
    Object.defineProperty(window.navigator, "geolocation", {
      value: { getCurrentPosition },
      configurable: true,
    });
    const user = userEvent.setup();
    renderIt();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    await user.type(screen.getByLabelText(ko.product.radius), "5");
    await user.click(screen.getByRole("button", { name: ko.product.search }));

    expect(await screen.findByText(ko.product.locationDenied)).toBeInTheDocument();
  });
});
