import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { PublicProfile, type PublicProfileView } from "./PublicProfile";
import ko from "@/i18n/messages/ko.json";

const noReviews = { summary: { counts: { GOOD: 0, OK: 0, BAD: 0 }, positiveRate: 0, total: 0 }, items: [] };

const profile: PublicProfileView = {
  nickname: "풀숲여우",
  bio: "동네 중고 거래 좋아해요",
  avatarPath: null,
  region: "서울시 강남구 역삼동",
  phoneVerified: true,
  createdAt: "2025-01-01T00:00:00.000Z",
  active: [],
  sold: [],
  reviews: noReviews,
};

function renderIt(p: PublicProfileView = profile) {
  return render(
    <NextIntlClientProvider locale="ko" messages={ko}>
      <PublicProfile profile={p} />
    </NextIntlClientProvider>,
  );
}

const product = {
  id: "p1",
  title: "낡은 자전거",
  price: 30000,
  category: "SPORTS",
  status: "SELLING",
  thumbnail: null,
  regionLabel: "서울시 강남구",
};

describe("PublicProfile — safe subset only", () => {
  it("renders nickname, bio, region, phone-verified badge, and joined date", () => {
    renderIt();
    expect(screen.getByText("풀숲여우")).toBeInTheDocument();
    expect(screen.getByText("동네 중고 거래 좋아해요")).toBeInTheDocument();
    expect(screen.getByText("서울시 강남구 역삼동")).toBeInTheDocument();
    expect(screen.getByText(ko.profile.phoneVerified)).toBeInTheDocument();
    expect(screen.getByText(ko.profile.joined)).toBeInTheDocument();
  });

  it("shows empty-state labels for a bare profile, with no email/phone-number/coordinate anywhere in the DOM", () => {
    const { container } = renderIt({
      nickname: "익명유저",
      bio: null,
      avatarPath: null,
      region: null,
      phoneVerified: false,
      createdAt: "2025-06-15T00:00:00.000Z",
      active: [],
      sold: [],
      reviews: noReviews,
    });
    expect(screen.getByText(ko.profile.bioEmpty)).toBeInTheDocument();
    expect(screen.getByText(ko.profile.noRegion)).toBeInTheDocument();
    expect(screen.getByText(ko.profile.phoneNotVerified)).toBeInTheDocument();

    // 이 컴포넌트가 받는 타입에는애초 email/phone/좌표 필드가 없다 — 렌더된 DOM에도
    // 그런 값이 우연히도 나타나지 않는지 방어적으로 확인한다.
    const html = container.innerHTML;
    expect(html).not.toMatch(/@.+\..+/); // 이메일 형태
    expect(html).not.toMatch(/\d{2,3}-\d{3,4}-\d{4}/); // 전화번호 형태
    expect(html).not.toMatch(/lat|lng|latitude|longitude/i);
  });

  it("shows '—' instead of crashing or leaking a raw invalid string when createdAt can't be parsed", () => {
    renderIt({ ...profile, createdAt: "not-a-real-date" });
    expect(screen.getByText("—")).toBeInTheDocument();
    expect(screen.queryByText("not-a-real-date")).not.toBeInTheDocument();
  });

  it("renders active (selling/reserved) listings as product cards linking to their detail pages", () => {
    renderIt({ ...profile, active: [product], sold: [] });
    expect(screen.getByText(ko.profile.activeListings)).toBeInTheDocument();
    expect(screen.getByText("낡은 자전거")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /낡은 자전거/ })).toHaveAttribute("href", "/products/p1");
    expect(screen.getByText(ko.profile.noSoldListings)).toBeInTheDocument();
  });

  it("renders sold listings separately, and shows the empty state when there are none", () => {
    renderIt({ ...profile, active: [], sold: [{ ...product, id: "p2", status: "SOLD" }] });
    expect(screen.getByText(ko.profile.noActiveListings)).toBeInTheDocument();
    expect(screen.getByText(ko.profile.soldListings)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /낡은 자전거/ })).toHaveAttribute("href", "/products/p2");
  });

  it("shows the received-reviews empty state when there are none", () => {
    renderIt({ ...profile, reviews: noReviews });
    expect(screen.getByText(ko.review.receivedTitle)).toBeInTheDocument();
    expect(screen.getByText(ko.review.receivedEmpty)).toBeInTheDocument();
  });

  it("renders the received-reviews summary (counts + positive rate) and a list with reviewer nickname/avatar, rating label, comment, and date", () => {
    renderIt({
      ...profile,
      reviews: {
        summary: { counts: { GOOD: 2, OK: 1, BAD: 0 }, positiveRate: 67, total: 3 },
        items: [
          {
            reviewer: { nickname: "구매왕", avatarPath: null },
            rating: "GOOD",
            comment: "친절하고 좋았어요",
            createdAt: "2026-01-01T00:00:00.000Z",
          },
        ],
      },
    });
    expect(screen.getByText(ko.review.receivedTitle)).toBeInTheDocument();
    expect(screen.getByText(`${ko.review.rating.GOOD} 2`)).toBeInTheDocument();
    expect(screen.getByText(`${ko.review.rating.OK} 1`)).toBeInTheDocument();
    expect(screen.getByText(`${ko.review.rating.BAD} 0`)).toBeInTheDocument();
    expect(screen.getByText(`${ko.review.positiveRate} 67%`)).toBeInTheDocument();
    expect(screen.getByText("구매왕")).toBeInTheDocument();
    expect(screen.getByText("친절하고 좋았어요")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "구매왕" })).toBeInTheDocument();
  });

  it("never leaks the reviewer's raw userId or other PII in the received-reviews list", () => {
    const { container } = renderIt({
      ...profile,
      reviews: {
        summary: { counts: { GOOD: 1, OK: 0, BAD: 0 }, positiveRate: 100, total: 1 },
        items: [
          {
            reviewer: { nickname: "구매왕", avatarPath: null },
            rating: "GOOD",
            comment: null,
            createdAt: "2026-01-01T00:00:00.000Z",
          },
        ],
      },
    });
    const html = container.innerHTML;
    expect(html).not.toMatch(/@.+\..+/);
    expect(html).not.toMatch(/\d{2,3}-\d{3,4}-\d{4}/);
  });
});
