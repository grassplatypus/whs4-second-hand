import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { PhoneVerify } from "./PhoneVerify";
import ko from "@/i18n/messages/ko.json";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }));

function renderIt(initialVerified = false) {
  return render(
    <NextIntlClientProvider locale="ko" messages={ko}>
      <PhoneVerify initialVerified={initialVerified} />
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

describe("PhoneVerify", () => {
  it("shows the verified badge immediately when already verified", () => {
    renderIt(true);
    expect(screen.getByText(ko.phone.verified)).toBeInTheDocument();
  });

  it("sends the code, then confirms against the verify endpoint and shows the verified badge", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonOk({ ok: true }))
      .mockResolvedValueOnce(jsonOk({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);

    const user = userEvent.setup();
    renderIt(false);

    await user.click(screen.getByRole("button", { name: ko.phone.verify }));
    expect(fetchMock.mock.calls[0][0]).toBe("/api/auth/phone/send");
    expect(fetchMock.mock.calls[0][1].method).toBe("POST");

    await user.type(await screen.findByLabelText(ko.phone.codeLabel), "123456");
    await user.click(screen.getByRole("button", { name: ko.phone.confirm }));

    await waitFor(() => {
      const call = fetchMock.mock.calls[1];
      expect(call[0]).toBe("/api/auth/phone/verify");
      expect(call[1].method).toBe("POST");
      expect(JSON.parse(call[1].body)).toEqual({ code: "123456" });
    });
    expect(await screen.findByText(ko.phone.verified)).toBeInTheDocument();
    expect(refresh).toHaveBeenCalled();
  });

  it("maps NO_PHONE / OTP_TOO_SOON / PHONE_TAKEN / generic failures to the catalog, never the server message", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonFail(400, "NO_PHONE"));
    vi.stubGlobal("fetch", fetchMock);

    const user = userEvent.setup();
    renderIt(false);
    await user.click(screen.getByRole("button", { name: ko.phone.verify }));

    expect(await screen.findByRole("alert")).toHaveTextContent(ko.phone.noPhone);
    expect(screen.queryByText("leaky server text")).not.toBeInTheDocument();
  });

  it("maps a too-soon resend to the catalog", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonFail(429, "OTP_TOO_SOON"));
    vi.stubGlobal("fetch", fetchMock);

    const user = userEvent.setup();
    renderIt(false);
    await user.click(screen.getByRole("button", { name: ko.phone.verify }));

    expect(await screen.findByRole("alert")).toHaveTextContent(ko.phone.tooSoon);
  });

  it("maps a taken phone number (409) on confirm to the catalog", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonOk({ ok: true }))
      .mockResolvedValueOnce(jsonFail(409, "PHONE_TAKEN"));
    vi.stubGlobal("fetch", fetchMock);

    const user = userEvent.setup();
    renderIt(false);
    await user.click(screen.getByRole("button", { name: ko.phone.verify }));
    await user.type(await screen.findByLabelText(ko.phone.codeLabel), "000000");
    await user.click(screen.getByRole("button", { name: ko.phone.confirm }));

    expect(await screen.findByRole("alert")).toHaveTextContent(ko.phone.taken);
  });

  it("maps an unrecognized wrong-code failure to the generic failed catalog message", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonOk({ ok: true }))
      .mockResolvedValueOnce(jsonFail(401, "PHONE_VERIFY_FAILED"));
    vi.stubGlobal("fetch", fetchMock);

    const user = userEvent.setup();
    renderIt(false);
    await user.click(screen.getByRole("button", { name: ko.phone.verify }));
    await user.type(await screen.findByLabelText(ko.phone.codeLabel), "000000");
    await user.click(screen.getByRole("button", { name: ko.phone.confirm }));

    expect(await screen.findByRole("alert")).toHaveTextContent(ko.phone.failed);
  });
});
