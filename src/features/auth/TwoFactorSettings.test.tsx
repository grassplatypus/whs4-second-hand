import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { TwoFactorSettings } from "./TwoFactorSettings";
import ko from "@/i18n/messages/ko.json";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }));

function renderIt(initialMethod: "NONE" | "TOTP" | "EMAIL" = "NONE") {
  return render(
    <NextIntlClientProvider locale="ko" messages={ko}>
      <TwoFactorSettings initialMethod={initialMethod} />
    </NextIntlClientProvider>,
  );
}

function jsonOk(body: unknown) {
  return { ok: true, json: async () => body };
}
function jsonFail(status: number, code: string) {
  return { ok: false, status, json: async () => ({ code, message: "leaky server text" }) };
}

beforeEach(() => {
  refresh.mockClear();
});
afterEach(() => vi.unstubAllGlobals());

describe("TwoFactorSettings — TOTP setup", () => {
  it("starts TOTP setup, shows the secret/uri as text (no external QR request), then confirms", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonOk({ secret: "JBSWY3DPEHPK3PXP", uri: "otpauth://totp/label?secret=DIFFERENTVALUE" }))
      .mockResolvedValueOnce(jsonOk({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);

    const user = userEvent.setup();
    renderIt("NONE");

    await user.click(screen.getByRole("button", { name: ko.auth.twofactor.setupTotp }));
    expect(await screen.findByText(/JBSWY3DPEHPK3PXP/)).toBeInTheDocument();
    expect(screen.getByText(/otpauth:\/\/totp/)).toBeInTheDocument();
    expect(fetchMock.mock.calls[0][0]).toBe("/api/auth/2fa/totp/start");
    expect(fetchMock.mock.calls[0][1].method).toBe("POST");

    await user.type(screen.getByLabelText(ko.auth.twofactor.code), "654321");
    await user.click(screen.getByRole("button", { name: ko.auth.twofactor.confirm }));

    await waitFor(() => {
      const call = fetchMock.mock.calls[1];
      expect(call[0]).toBe("/api/auth/2fa/totp/confirm");
      expect(call[1].method).toBe("POST");
      expect(JSON.parse(call[1].body)).toEqual({ code: "654321" });
    });
    expect(await screen.findByText(ko.auth.twofactor.enabledTotp)).toBeInTheDocument();
  });

  it("maps a failed confirm code to the catalog error, never the server message", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonOk({ secret: "S", uri: "otpauth://totp/x" }))
      .mockResolvedValueOnce(jsonFail(401, "TWO_FACTOR_FAILED"));
    vi.stubGlobal("fetch", fetchMock);

    const user = userEvent.setup();
    renderIt("NONE");
    await user.click(screen.getByRole("button", { name: ko.auth.twofactor.setupTotp }));
    await screen.findByText(/otpauth:\/\/totp/);
    await user.type(screen.getByLabelText(ko.auth.twofactor.code), "000000");
    await user.click(screen.getByRole("button", { name: ko.auth.twofactor.confirm }));

    expect(await screen.findByRole("alert")).toHaveTextContent(ko.auth.twofactor.failed);
    expect(screen.queryByText("leaky server text")).not.toBeInTheDocument();
  });
});

describe("TwoFactorSettings — email setup", () => {
  it("starts email setup then confirms against the email endpoint", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonOk({ ok: true }))
      .mockResolvedValueOnce(jsonOk({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);

    const user = userEvent.setup();
    renderIt("NONE");
    await user.click(screen.getByRole("button", { name: ko.auth.twofactor.setupEmail }));
    expect(fetchMock.mock.calls[0][0]).toBe("/api/auth/2fa/email/start");

    await user.type(await screen.findByLabelText(ko.auth.twofactor.code), "111222");
    await user.click(screen.getByRole("button", { name: ko.auth.twofactor.confirm }));

    await waitFor(() => {
      const call = fetchMock.mock.calls[1];
      expect(call[0]).toBe("/api/auth/2fa/email/confirm");
      expect(JSON.parse(call[1].body)).toEqual({ code: "111222" });
    });
    expect(await screen.findByText(ko.auth.twofactor.enabledEmail)).toBeInTheDocument();
  });
});

describe("TwoFactorSettings — disable + step-up retry", () => {
  it("disables directly when no step-up is required", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonOk({ ok: true })));
    const user = userEvent.setup();
    renderIt("TOTP");
    await user.click(screen.getByRole("button", { name: ko.auth.twofactor.disable }));
    expect(await screen.findByText(ko.auth.twofactor.disabledState)).toBeInTheDocument();
  });

  it("shows StepUpPrompt on 401 STEP_UP_REQUIRED, then retries disable after reauth succeeds", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonFail(401, "STEP_UP_REQUIRED")) // first disable attempt
      .mockResolvedValueOnce(jsonOk({ ok: true })) // step-up succeeds
      .mockResolvedValueOnce(jsonOk({ ok: true })); // retried disable succeeds
    vi.stubGlobal("fetch", fetchMock);

    const user = userEvent.setup();
    renderIt("TOTP");
    await user.click(screen.getByRole("button", { name: ko.auth.twofactor.disable }));

    expect(await screen.findByText(ko.auth.twofactor.stepUpRequired)).toBeInTheDocument();
    expect(fetchMock.mock.calls[0][0]).toBe("/api/auth/2fa/disable");

    await user.type(screen.getByLabelText(ko.auth.twofactor.stepUpPassword), "hunter2hunter2");
    await user.click(screen.getByRole("button", { name: ko.auth.twofactor.stepUpSubmit }));

    await waitFor(() => expect(fetchMock.mock.calls[1][0]).toBe("/api/auth/step-up"));
    await waitFor(() => expect(fetchMock.mock.calls[2][0]).toBe("/api/auth/2fa/disable"));
    expect(await screen.findByText(ko.auth.twofactor.disabledState)).toBeInTheDocument();
  });
});
