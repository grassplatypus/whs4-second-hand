import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { PurchasedList, type PurchasedProductView } from "./PurchasedList";
import ko from "@/i18n/messages/ko.json";

const product: PurchasedProductView = {
  id: "p1",
  title: "낡은 자전거",
  price: 30000,
  category: "SPORTS",
  status: "SOLD",
  thumbnail: null,
  regionLabel: "서울시 강남구",
};

function renderIt(items: PurchasedProductView[]) {
  return render(
    <NextIntlClientProvider locale="ko" messages={ko}>
      <PurchasedList items={items} />
    </NextIntlClientProvider>,
  );
}

describe("PurchasedList — mypage-only purchase history", () => {
  it("shows the empty state when nothing was purchased", () => {
    renderIt([]);
    expect(screen.getByText(ko.profile.purchasedListings)).toBeInTheDocument();
    expect(screen.getByText(ko.profile.noPurchasedListings)).toBeInTheDocument();
  });

  it("renders purchased items as product cards linking to their detail pages", () => {
    renderIt([product]);
    expect(screen.getByText("낡은 자전거")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /낡은 자전거/ })).toHaveAttribute("href", "/products/p1");
    expect(screen.queryByText(ko.profile.noPurchasedListings)).not.toBeInTheDocument();
  });
});
