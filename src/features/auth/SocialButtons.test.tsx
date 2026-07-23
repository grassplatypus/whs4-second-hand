import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { SocialButtons } from "./SocialButtons";
import ko from "@/i18n/messages/ko.json";

function renderIt() {
  return render(
    <NextIntlClientProvider locale="ko" messages={ko}>
      <SocialButtons />
    </NextIntlClientProvider>,
  );
}

describe("SocialButtons", () => {
  it("links each provider to its start endpoint", () => {
    renderIt();
    expect(screen.getByRole("link", { name: "구글로 계속하기" })).toHaveAttribute("href", "/api/auth/oauth/google/start");
    expect(screen.getByRole("link", { name: "카카오로 계속하기" })).toHaveAttribute("href", "/api/auth/oauth/kakao/start");
    expect(screen.getByRole("link", { name: "네이버로 계속하기" })).toHaveAttribute("href", "/api/auth/oauth/naver/start");
  });
});
