import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { WithdrawForm } from "./WithdrawForm";
import ko from "@/i18n/messages/ko.json";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push }) }));

function renderIt() {
  return render(
    <NextIntlClientProvider locale="ko" messages={ko}>
      <WithdrawForm />
    </NextIntlClientProvider>,
  );
}

function jsonOk(body: unknown) {
  return { ok: true, json: async () => body };
}
function jsonFail(status: number, code: string) {
  return { ok: false, status, json: async () => ({ code, message: "leaky server text" }) };
}

beforeEach(() => push.mockClear());
afterEach(() => vi.unstubAllGlobals());

describe("WithdrawForm — confirm prompt", () => {
  it("does not call the withdraw endpoint until the confirm step is reached", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    renderIt();

    expect(screen.queryByText(ko.account.withdrawConfirm)).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: ko.account.withdrawButton }));
    expect(await screen.findByText(ko.account.withdrawConfirm)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("cancels back out of the confirm step without calling the endpoint", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    renderIt();
    await user.click(screen.getByRole("button", { name: ko.account.withdrawButton }));
    await user.click(screen.getByRole("button", { name: ko.account.withdrawCancel }));
    expect(screen.queryByText(ko.account.withdrawConfirm)).not.toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("WithdrawForm — withdraw + step-up retry", () => {
  it("posts to /api/auth/withdraw and redirects home on success", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonOk({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    renderIt();

    await user.click(screen.getByRole("button", { name: ko.account.withdrawButton }));
    await user.click(screen.getByRole("button", { name: ko.account.withdrawConfirmButton }));

    await waitFor(() => {
      expect(fetchMock.mock.calls[0][0]).toBe("/api/auth/withdraw");
      expect(fetchMock.mock.calls[0][1].method).toBe("POST");
    });
    await waitFor(() => expect(push).toHaveBeenCalledWith("/"));
  });

  it("maps WITHDRAW_BLOCKED to the catalog error, never the server message", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonFail(409, "WITHDRAW_BLOCKED")));
    const user = userEvent.setup();
    renderIt();
    await user.click(screen.getByRole("button", { name: ko.account.withdrawButton }));
    await user.click(screen.getByRole("button", { name: ko.account.withdrawConfirmButton }));

    expect(await screen.findByRole("alert")).toHaveTextContent(ko.account.blocked);
    expect(screen.queryByText("leaky server text")).not.toBeInTheDocument();
  });

  it("shows StepUpPrompt on 401 STEP_UP_REQUIRED, then retries withdraw after reauth succeeds", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonFail(401, "STEP_UP_REQUIRED")) // first withdraw attempt
      .mockResolvedValueOnce(jsonOk({ ok: true })) // step-up succeeds
      .mockResolvedValueOnce(jsonOk({ ok: true })); // retried withdraw succeeds
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    renderIt();

    await user.click(screen.getByRole("button", { name: ko.account.withdrawButton }));
    await user.click(screen.getByRole("button", { name: ko.account.withdrawConfirmButton }));

    expect(await screen.findByRole("alert")).toHaveTextContent(ko.account.stepUpRequired);
    expect(fetchMock.mock.calls[0][0]).toBe("/api/auth/withdraw");

    await user.type(screen.getByLabelText(ko.auth.twofactor.stepUpPassword), "hunter2hunter2");
    await user.click(screen.getByRole("button", { name: ko.auth.twofactor.stepUpSubmit }));

    await waitFor(() => expect(fetchMock.mock.calls[1][0]).toBe("/api/auth/step-up"));
    await waitFor(() => expect(fetchMock.mock.calls[2][0]).toBe("/api/auth/withdraw"));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/"));
  });
});
