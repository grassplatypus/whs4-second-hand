import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { LoginForm } from "./LoginForm";
import ko from "@/i18n/messages/ko.json";

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, refresh: vi.fn() }),
}));

function renderForm(oauthError?: string) {
  return render(
    <NextIntlClientProvider locale="ko" messages={ko}>
      <LoginForm oauthError={oauthError} />
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  push.mockClear();
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ accessToken: "t", expiresIn: 900 }) }));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("LoginForm", () => {
  it("links to /signup for people without an account", () => {
    renderForm();
    expect(screen.getByRole("link", { name: "회원가입" })).toHaveAttribute("href", "/signup");
  });

  it("posts credentials to /api/auth/login", async () => {
    const user = userEvent.setup();
    renderForm();
    await user.type(screen.getByLabelText("이메일"), "user@example.com");
    await user.type(screen.getByLabelText("비밀번호"), "hunter2hunter2");
    await user.click(screen.getByRole("button", { name: "로그인하기" }));

    await waitFor(() => {
      const [url, init] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(String(url)).toContain("/api/auth/login");
      expect(JSON.parse(init.body)).toEqual({ email: "user@example.com", password: "hunter2hunter2" });
    });
  });

  it("shows a generic message on failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 401, json: async () => ({ code: "AUTH_FAILED", message: "x" }) }),
    );
    const user = userEvent.setup();
    renderForm();
    await user.type(screen.getByLabelText("이메일"), "user@example.com");
    await user.type(screen.getByLabelText("비밀번호"), "wrong-password");
    await user.click(screen.getByRole("button", { name: "로그인하기" }));

    expect(await screen.findByText("이메일이나 비밀번호를 다시 확인해 주세요")).toBeInTheDocument();
  });

  it("shows a generic message and does not crash when fetch rejects", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));
    const user = userEvent.setup();
    renderForm();
    await user.type(screen.getByLabelText("이메일"), "user@example.com");
    await user.type(screen.getByLabelText("비밀번호"), "hunter2hunter2");
    await user.click(screen.getByRole("button", { name: "로그인하기" }));

    expect(await screen.findByText("이메일이나 비밀번호를 다시 확인해 주세요")).toBeInTheDocument();
  });

  it("shows the oauth error catalog string when passed via prop", () => {
    renderForm(ko.auth.oauth.emailExists);
    expect(screen.getByRole("alert")).toHaveTextContent(ko.auth.oauth.emailExists);
  });

  it("redirects to /login/2fa when the login response is twoFactorRequired", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ twoFactorRequired: true, method: "TOTP" }) }),
    );
    const user = userEvent.setup();
    renderForm();
    await user.type(screen.getByLabelText("이메일"), "user@example.com");
    await user.type(screen.getByLabelText("비밀번호"), "hunter2hunter2");
    await user.click(screen.getByRole("button", { name: "로그인하기" }));

    await waitFor(() => expect(push).toHaveBeenCalledWith("/login/2fa"));
  });

  it("redirects to / on a normal successful login", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }));
    const user = userEvent.setup();
    renderForm();
    await user.type(screen.getByLabelText("이메일"), "user@example.com");
    await user.type(screen.getByLabelText("비밀번호"), "hunter2hunter2");
    await user.click(screen.getByRole("button", { name: "로그인하기" }));

    await waitFor(() => expect(push).toHaveBeenCalledWith("/"));
  });

  it("disables the submit button while a request is in flight", async () => {
    let resolveFetch: (value: unknown) => void = () => {};
    vi.stubGlobal(
      "fetch",
      vi.fn().mockReturnValue(
        new Promise((resolve) => {
          resolveFetch = resolve;
        }),
      ),
    );
    const user = userEvent.setup();
    renderForm();
    await user.type(screen.getByLabelText("이메일"), "user@example.com");
    await user.type(screen.getByLabelText("비밀번호"), "hunter2hunter2");
    const button = screen.getByRole("button", { name: "로그인하기" });
    await user.click(button);

    expect(button).toBeDisabled();
    resolveFetch({ ok: true, json: async () => ({ accessToken: "t", expiresIn: 900 }) });
    await waitFor(() => expect(button).not.toBeDisabled());
  });
});
