import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { ProductCard, type ProductCardView } from "./ProductCard";
import ko from "@/i18n/messages/ko.json";

const base: ProductCardView = {
  id: "p1",
  title: "아이폰 팝니다",
  price: 500000,
  category: "DIGITAL",
  status: "SELLING",
  thumbnail: "products/abc.webp",
  regionLabel: "서울시 강남구 역삼동",
  distanceKm: 2.34,
};

function renderIt(product: ProductCardView = base) {
  return render(
    <NextIntlClientProvider locale="ko" messages={ko}>
      <ProductCard product={product} />
    </NextIntlClientProvider>,
  );
}

describe("ProductCard — safe subset only", () => {
  it("renders title, price, status badge, region, distance, and links to the detail page", () => {
    renderIt();
    expect(screen.getByText("아이폰 팝니다")).toBeInTheDocument();
    expect(screen.getByText("500,000원")).toBeInTheDocument();
    expect(screen.getByText(ko.product.status.SELLING)).toBeInTheDocument();
    expect(screen.getByText("서울시 강남구 역삼동")).toBeInTheDocument();
    expect(screen.getByText("2.3 km")).toBeInTheDocument();
    expect(screen.getByRole("link")).toHaveAttribute("href", "/products/p1");
  });

  it("shows 나눔 for a free (0원) listing", () => {
    renderIt({ ...base, price: 0 });
    expect(screen.getByText(ko.product.free)).toBeInTheDocument();
    expect(screen.queryByText(/0원/)).not.toBeInTheDocument();
  });

  it("falls back to the category sample image when there is no uploaded thumbnail", () => {
    renderIt({ ...base, thumbnail: null });
    const img = screen.getByRole("img");
    expect(img).toHaveAttribute("src", "/samples/DIGITAL.webp");
  });

  it("uses the uploaded thumbnail when present", () => {
    renderIt({ ...base, thumbnail: "products/abc.webp" });
    expect(screen.getByRole("img")).toHaveAttribute("src", "/api/media/products/abc.webp");
  });

  it("never renders seller PII or precise coordinates — the type has no such fields", () => {
    const { container } = renderIt();
    const html = container.innerHTML;
    expect(html).not.toMatch(/@.+\..+/); // 이메일 형태
    expect(html).not.toMatch(/\d{2,3}-\d{3,4}-\d{4}/); // 전화번호 형태
    // 좌표 누출 검사 — CSS 클래스 "relative"의 부분문자열 오탐을 피하려 단어 경계로 매칭한다.
    expect(html).not.toMatch(/\blat\b|\blng\b|latitude|longitude/i);
  });
});
