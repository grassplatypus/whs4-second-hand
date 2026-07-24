import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { ImageGallery } from "./ImageGallery";
import ko from "@/i18n/messages/ko.json";

const MULTI_IMAGES = [
  { path: "products/a.webp", order: 0 },
  { path: "products/b.webp", order: 1 },
];

function renderIt(images: { path: string; order: number }[] = MULTI_IMAGES, title = "아이폰 팝니다") {
  return render(
    <NextIntlClientProvider locale="ko" messages={ko}>
      <ImageGallery images={images} category="DIGITAL" title={title} />
    </NextIntlClientProvider>,
  );
}

describe("ImageGallery", () => {
  it("renders nothing when there are no images and the category has no sample fallback", () => {
    const { container } = render(
      <NextIntlClientProvider locale="ko" messages={ko}>
        <ImageGallery images={[]} category="UNKNOWN" title="t" />
      </NextIntlClientProvider>,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("falls back to the category sample image when there are no uploaded images", () => {
    renderIt([], "아이폰 팝니다");
    expect(screen.getByRole("img", { name: "아이폰 팝니다" })).toHaveAttribute("src", "/samples/DIGITAL.webp");
  });

  it("gives each thumbnail an indexed accessible name and marks the selected one with aria-current", async () => {
    const user = userEvent.setup();
    renderIt();

    const thumb1 = screen.getByRole("button", { name: ko.product.thumbnailAria.replace("{index}", "1") });
    const thumb2 = screen.getByRole("button", { name: ko.product.thumbnailAria.replace("{index}", "2") });
    expect(thumb1).toHaveAttribute("aria-current", "true");
    expect(thumb2).not.toHaveAttribute("aria-current");

    await user.click(thumb2);
    expect(thumb2).toHaveAttribute("aria-current", "true");
    expect(thumb1).not.toHaveAttribute("aria-current");
  });

  it("opens a dialog labeled with the product title, using the shared common close/prev/next labels", async () => {
    const user = userEvent.setup();
    renderIt(MULTI_IMAGES, "아이폰 팝니다");

    await user.click(screen.getByRole("button", { name: ko.product.viewLargeImageAria }));

    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAttribute("aria-label", "아이폰 팝니다");
    expect(screen.getByRole("button", { name: ko.common.close })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: ko.common.prev })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: ko.common.next })).toBeInTheDocument();
  });

  it("moves focus into the dialog on open, and restores it to the trigger button on close", async () => {
    const user = userEvent.setup();
    renderIt();

    const trigger = screen.getByRole("button", { name: ko.product.viewLargeImageAria });
    await user.click(trigger);

    const closeButton = screen.getByRole("button", { name: ko.common.close });
    expect(closeButton).toHaveFocus();

    await user.click(closeButton);
    expect(trigger).toHaveFocus();
  });

  it("Escape closes the dialog and restores focus to the trigger", async () => {
    const user = userEvent.setup();
    renderIt();

    const trigger = screen.getByRole("button", { name: ko.product.viewLargeImageAria });
    await user.click(trigger);
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it("traps Tab focus within the dialog's buttons (wraps from last back to first, and vice versa)", async () => {
    const user = userEvent.setup();
    renderIt();

    await user.click(screen.getByRole("button", { name: ko.product.viewLargeImageAria }));

    const closeButton = screen.getByRole("button", { name: ko.common.close });
    const prevButton = screen.getByRole("button", { name: ko.common.prev });
    const nextButton = screen.getByRole("button", { name: ko.common.next });

    expect(closeButton).toHaveFocus();

    // Shift+Tab from the first (close) button wraps to the last (next) button.
    await user.tab({ shift: true });
    expect(nextButton).toHaveFocus();

    // Tab from the last button wraps back to the first.
    await user.tab();
    expect(closeButton).toHaveFocus();

    // Sanity: forward order visits prev in between.
    await user.tab();
    expect(prevButton).toHaveFocus();
  });
});
