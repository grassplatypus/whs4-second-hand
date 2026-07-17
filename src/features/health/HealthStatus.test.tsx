import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { HealthStatus } from "./HealthStatus";
import ko from "@/i18n/messages/ko.json";

function renderWithIntl(ui: React.ReactNode) {
  return render(
    <NextIntlClientProvider locale="ko" messages={ko}>
      {ui}
    </NextIntlClientProvider>,
  );
}

describe("HealthStatus", () => {
  it("shows ok message in Korean when db is up", () => {
    renderWithIntl(<HealthStatus db={true} />);
    expect(screen.getByText("잘 돌아가고 있어요")).toBeInTheDocument();
  });

  it("shows bad message when db is down", () => {
    renderWithIntl(<HealthStatus db={false} />);
    expect(screen.getByText("연결에 문제가 있어요")).toBeInTheDocument();
  });
});
