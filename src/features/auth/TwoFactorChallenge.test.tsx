import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { TwoFactorChallenge } from "./TwoFactorChallenge";
import ko from "@/i18n/messages/ko.json";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

function renderIt() {
  return render(
    <NextIntlClientProvider locale="ko" messages={ko}>
      <TwoFactorChallenge />
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  push.mockClear();
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) }));
});
afterEach(() => vi.unstubAllGlobals());

describe("TwoFactorChallenge", () => {
  it("posts the code to /2fa/verify-login and redirects to / on success", async () => {
    const user = userEvent.setup();
    renderIt();
    await user.type(screen.getByLabelText(ko.auth.twofactor.code), "123456");
    await user.click(screen.getByRole("button", { name: ko.auth.twofactor.confirm }));
    await waitFor(() => {
      const call = (globalThis.fetch as any).mock.calls[0];
      expect(String(call[0])).toBe("/api/auth/2fa/verify-login");
      expect(call[1].method).toBe("POST");
      expect(JSON.parse(call[1].body)).toEqual({ code: "123456" });
      expect(push).toHaveBeenCalledWith("/");
    });
  });

  it("posts to /2fa/resend when the resend button is clicked", async () => {
    const user = userEvent.setup();
    renderIt();
    await user.click(screen.getByRole("button", { name: ko.auth.twofactor.resend }));
    await waitFor(() => {
      const call = (globalThis.fetch as any).mock.calls[0];
      expect(String(call[0])).toBe("/api/auth/2fa/resend");
      expect(call[1].method).toBe("POST");
    });
    expect(await screen.findByText(ko.auth.twofactor.resendDone)).toBeInTheDocument();
  });

  it("shows a generic catalog error and never the server message on a failed code", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 401, json: async () => ({ code: "TWO_FACTOR_FAILED", message: "leaky server text" }) }),
    );
    const user = userEvent.setup();
    renderIt();
    await user.type(screen.getByLabelText(ko.auth.twofactor.code), "000000");
    await user.click(screen.getByRole("button", { name: ko.auth.twofactor.confirm }));
    expect(await screen.findByRole("alert")).toHaveTextContent(ko.auth.twofactor.failed);
    expect(screen.queryByText("leaky server text")).not.toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
  });
});
