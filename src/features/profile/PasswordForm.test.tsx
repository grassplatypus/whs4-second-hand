import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { PasswordForm } from "./PasswordForm";
import ko from "@/i18n/messages/ko.json";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }));

function renderIt(hasPassword: boolean) {
  return render(
    <NextIntlClientProvider locale="ko" messages={ko}>
      <PasswordForm hasPassword={hasPassword} />
    </NextIntlClientProvider>,
  );
}

function jsonOk(body: unknown) {
  return { ok: true, json: async () => body };
}
function jsonFail(status: number, code: string) {
  return { ok: false, status, json: async () => ({ code, message: "leaky server text" }) };
}

beforeEach(() => refresh.mockClear());
afterEach(() => vi.unstubAllGlobals());

describe("PasswordForm — set mode (no existing password)", () => {
  it("posts { password } to /api/auth/password/set", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonOk({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    renderIt(false);

    expect(screen.queryByLabelText(ko.account.currentPassword)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(ko.account.confirmNewPassword)).not.toBeInTheDocument();
    await user.type(screen.getByLabelText(ko.account.newPassword), "brandnewpass1");
    await user.click(screen.getByRole("button", { name: ko.account.submitSetPassword }));

    await waitFor(() => {
      const call = fetchMock.mock.calls[0];
      expect(call[0]).toBe("/api/auth/password/set");
      expect(JSON.parse(call[1].body)).toEqual({ password: "brandnewpass1" });
    });
    expect(await screen.findByText(ko.account.passwordSaved)).toBeInTheDocument();
  });

  it("maps PASSWORD_EXISTS to the catalog error, never the server message", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonFail(409, "PASSWORD_EXISTS")));
    const user = userEvent.setup();
    renderIt(false);
    await user.type(screen.getByLabelText(ko.account.newPassword), "brandnewpass1");
    await user.click(screen.getByRole("button", { name: ko.account.submitSetPassword }));

    expect(await screen.findByRole("alert")).toHaveTextContent(ko.account.passwordExists);
    expect(screen.queryByText("leaky server text")).not.toBeInTheDocument();
  });

  it("still uses step-up for the set-password flow (no existing password to verify inline)", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonFail(401, "STEP_UP_REQUIRED"))
      .mockResolvedValueOnce(jsonOk({ ok: true }))
      .mockResolvedValueOnce(jsonOk({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    renderIt(false);

    await user.type(screen.getByLabelText(ko.account.newPassword), "brandnewpass1");
    await user.click(screen.getByRole("button", { name: ko.account.submitSetPassword }));

    expect(await screen.findByRole("alert")).toHaveTextContent(ko.account.stepUpRequired);
    await user.type(screen.getByLabelText(ko.auth.twofactor.stepUpPassword), "hunter2hunter2");
    await user.click(screen.getByRole("button", { name: ko.auth.twofactor.stepUpSubmit }));

    await waitFor(() => expect(fetchMock.mock.calls[1][0]).toBe("/api/auth/step-up"));
    await waitFor(() => expect(fetchMock.mock.calls[2][0]).toBe("/api/auth/password/set"));
    expect(await screen.findByText(ko.account.passwordSaved)).toBeInTheDocument();
  });
});

describe("PasswordForm — change mode (existing password): current password, new password, confirm", () => {
  it("shows current/new/confirm password fields, all with a show/hide toggle", () => {
    renderIt(true);
    expect(screen.getByLabelText(ko.account.currentPassword)).toHaveAttribute("type", "password");
    expect(screen.getByLabelText(ko.account.newPassword)).toHaveAttribute("type", "password");
    expect(screen.getByLabelText(ko.account.confirmNewPassword)).toHaveAttribute("type", "password");
  });

  it("posts { currentPassword, newPassword } to /api/auth/password/change with no step-up involved", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonOk({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    renderIt(true);

    await user.type(screen.getByLabelText(ko.account.currentPassword), "oldpassword1");
    await user.type(screen.getByLabelText(ko.account.newPassword), "newpassword1");
    await user.type(screen.getByLabelText(ko.account.confirmNewPassword), "newpassword1");
    await user.click(screen.getByRole("button", { name: ko.account.submitChangePassword }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const call = fetchMock.mock.calls[0];
      expect(call[0]).toBe("/api/auth/password/change");
      expect(JSON.parse(call[1].body)).toEqual({
        currentPassword: "oldpassword1",
        newPassword: "newpassword1",
      });
    });
    expect(await screen.findByText(ko.account.passwordSaved)).toBeInTheDocument();
    expect(refresh).toHaveBeenCalled();
  });

  it("blocks submission client-side when new and confirm don't match, without calling the endpoint", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    renderIt(true);

    await user.type(screen.getByLabelText(ko.account.currentPassword), "oldpassword1");
    await user.type(screen.getByLabelText(ko.account.newPassword), "newpassword1");
    await user.type(screen.getByLabelText(ko.account.confirmNewPassword), "somethingelse1");
    await user.click(screen.getByRole("button", { name: ko.account.submitChangePassword }));

    expect(await screen.findByRole("alert")).toHaveTextContent(ko.account.newPasswordMismatch);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("maps a wrong current password (401 AUTH_FAILED) to the catalog error, never the server message, and never shows StepUpPrompt", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonFail(401, "AUTH_FAILED")));
    const user = userEvent.setup();
    renderIt(true);

    await user.type(screen.getByLabelText(ko.account.currentPassword), "totally-wrong");
    await user.type(screen.getByLabelText(ko.account.newPassword), "newpassword1");
    await user.type(screen.getByLabelText(ko.account.confirmNewPassword), "newpassword1");
    await user.click(screen.getByRole("button", { name: ko.account.submitChangePassword }));

    expect(await screen.findByRole("alert")).toHaveTextContent(ko.account.currentPasswordWrong);
    expect(screen.queryByText("leaky server text")).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: ko.auth.twofactor.stepUpTitle })).not.toBeInTheDocument();
  });
});
