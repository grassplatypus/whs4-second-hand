import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { StepUpPrompt } from "./StepUpPrompt";
import ko from "@/i18n/messages/ko.json";

function renderIt(onSuccess = vi.fn()) {
  render(
    <NextIntlClientProvider locale="ko" messages={ko}>
      <StepUpPrompt onSuccess={onSuccess} />
    </NextIntlClientProvider>,
  );
  return onSuccess;
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) }));
});
afterEach(() => vi.unstubAllGlobals());

describe("StepUpPrompt", () => {
  it("posts the password method to /api/auth/step-up", async () => {
    const user = userEvent.setup();
    renderIt();
    await user.type(screen.getByLabelText(ko.auth.twofactor.stepUpPassword), "hunter2hunter2");
    await user.click(screen.getByRole("button", { name: ko.auth.twofactor.stepUpSubmit }));
    await waitFor(() => {
      const call = (globalThis.fetch as any).mock.calls[0];
      expect(String(call[0])).toBe("/api/auth/step-up");
      expect(call[1].method).toBe("POST");
      expect(JSON.parse(call[1].body)).toEqual({ method: "password", password: "hunter2hunter2" });
    });
  });

  it("posts the code method when switched to code verification", async () => {
    const user = userEvent.setup();
    renderIt();
    await user.click(screen.getByRole("button", { name: ko.auth.twofactor.stepUpUseCode }));
    await user.type(screen.getByLabelText(ko.auth.twofactor.stepUpCode), "123456");
    await user.click(screen.getByRole("button", { name: ko.auth.twofactor.stepUpSubmit }));
    await waitFor(() => {
      const call = (globalThis.fetch as any).mock.calls[0];
      expect(String(call[0])).toBe("/api/auth/step-up");
      expect(JSON.parse(call[1].body)).toEqual({ method: "totp", code: "123456" });
    });
  });

  it("calls onSuccess on 200", async () => {
    const onSuccess = renderIt();
    const user = userEvent.setup();
    await user.type(screen.getByLabelText(ko.auth.twofactor.stepUpPassword), "hunter2hunter2");
    await user.click(screen.getByRole("button", { name: ko.auth.twofactor.stepUpSubmit }));
    await waitFor(() => expect(onSuccess).toHaveBeenCalled());
  });

  it("sends an email OTP then submits the email method with the entered code", async () => {
    const user = userEvent.setup();
    renderIt();
    await user.click(screen.getByRole("button", { name: ko.auth.twofactor.stepUpUseEmail }));
    await user.click(screen.getByRole("button", { name: ko.auth.twofactor.stepUpSendEmail }));

    await waitFor(() => {
      const call = (globalThis.fetch as any).mock.calls[0];
      expect(String(call[0])).toBe("/api/auth/step-up/send-otp");
      expect(call[1].method).toBe("POST");
    });
    expect(await screen.findByText(ko.auth.twofactor.stepUpEmailSent)).toBeInTheDocument();

    await user.type(screen.getByLabelText(ko.auth.twofactor.stepUpCode), "654321");
    await user.click(screen.getByRole("button", { name: ko.auth.twofactor.stepUpSubmit }));

    await waitFor(() => {
      const call = (globalThis.fetch as any).mock.calls[1];
      expect(String(call[0])).toBe("/api/auth/step-up");
      expect(JSON.parse(call[1].body)).toEqual({ method: "email", code: "654321" });
    });
  });

  it("maps OTP_TOO_SOON on the send-email button to the tooSoon catalog string", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 429, json: async () => ({ code: "OTP_TOO_SOON", message: "x" }) }),
    );
    const user = userEvent.setup();
    renderIt();
    await user.click(screen.getByRole("button", { name: ko.auth.twofactor.stepUpUseEmail }));
    await user.click(screen.getByRole("button", { name: ko.auth.twofactor.stepUpSendEmail }));

    expect(await screen.findByRole("alert")).toHaveTextContent(ko.auth.twofactor.tooSoon);
  });

  it("shows a generic catalog error and never the server message on failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 401, json: async () => ({ code: "STEP_UP_FAILED", message: "leaky server text" }) }),
    );
    const user = userEvent.setup();
    renderIt();
    await user.type(screen.getByLabelText(ko.auth.twofactor.stepUpPassword), "wrong");
    await user.click(screen.getByRole("button", { name: ko.auth.twofactor.stepUpSubmit }));
    expect(await screen.findByRole("alert")).toHaveTextContent(ko.auth.twofactor.failed);
    expect(screen.queryByText("leaky server text")).not.toBeInTheDocument();
  });
});
