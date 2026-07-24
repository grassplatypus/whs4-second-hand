import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { SignupForm } from "./SignupForm";
import ko from "@/i18n/messages/ko.json";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

function renderForm() {
  return render(
    <NextIntlClientProvider locale="ko" messages={ko}>
      <SignupForm />
    </NextIntlClientProvider>,
  );
}

async function fillValidForm(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText("이메일"), "user@example.com");
  await user.type(screen.getByLabelText("전화번호"), "010-1234-5678");
  await user.type(screen.getByLabelText("닉네임"), "풀숲");
  await user.type(screen.getByLabelText("비밀번호"), "hunter2hunter2");
  await user.type(screen.getByLabelText("비밀번호 확인"), "hunter2hunter2");
  await user.click(screen.getByLabelText("개인정보 수집·이용 및 이용약관에 동의해요"));
}

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({ ok: true, status: 201, json: async () => ({ userId: "u1", available: true }) }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("SignupForm", () => {
  it("links the terms word to /terms and links to /login for existing accounts", () => {
    renderForm();
    expect(screen.getByRole("link", { name: "이용약관" })).toHaveAttribute("href", "/terms");
    expect(screen.getByRole("link", { name: "로그인" })).toHaveAttribute("href", "/login");
  });

  it("posts the form to /api/auth/register", async () => {
    const user = userEvent.setup();
    renderForm();
    await fillValidForm(user);
    await user.click(screen.getByRole("button", { name: "가입하기" }));

    await waitFor(() => {
      const call = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.find(([url]) =>
        String(url).includes("/api/auth/register"),
      );
      expect(call).toBeTruthy();
      expect(JSON.parse(call![1].body).email).toBe("user@example.com");
      expect(JSON.parse(call![1].body).consent).toBe(true);
    });
  });

  it("blocks submission when the confirmation does not match", async () => {
    const user = userEvent.setup();
    renderForm();
    await fillValidForm(user);
    await user.clear(screen.getByLabelText("비밀번호 확인"));
    await user.type(screen.getByLabelText("비밀번호 확인"), "different-one");
    await user.click(screen.getByRole("button", { name: "가입하기" }));

    expect(await screen.findByText("비밀번호가 서로 달라요")).toBeInTheDocument();
    const registerCalls = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.filter(([url]) =>
      String(url).includes("/api/auth/register"),
    );
    expect(registerCalls).toHaveLength(0);
  });

  it("blocks submission without consent", async () => {
    const user = userEvent.setup();
    renderForm();
    await fillValidForm(user);
    await user.click(screen.getByLabelText("개인정보 수집·이용 및 이용약관에 동의해요")); // 다시 눌러 해제
    await user.click(screen.getByRole("button", { name: "가입하기" }));

    expect(await screen.findByText("동의가 필요해요")).toBeInTheDocument();
  });

  it("checks nickname availability on blur", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ available: false }) }));
    const user = userEvent.setup();
    renderForm();

    await user.type(screen.getByLabelText("닉네임"), "풀숲");
    await user.tab();

    expect(await screen.findByText("이미 쓰고 있어요")).toBeInTheDocument();
  });

  it("shows the emailTaken catalog string and never the server message on EMAIL_TAKEN", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 409,
        json: async () => ({ code: "EMAIL_TAKEN", message: "서버 원문" }),
      }),
    );
    const user = userEvent.setup();
    renderForm();
    await fillValidForm(user);
    await user.click(screen.getByRole("button", { name: "가입하기" }));

    expect(await screen.findByText("이미 가입된 이메일이에요")).toBeInTheDocument();
    expect(screen.queryByText("서버 원문")).not.toBeInTheDocument();
  });

  it("shows the nicknameTaken catalog string on NICKNAME_TAKEN", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 409,
        json: async () => ({ code: "NICKNAME_TAKEN", message: "서버 원문" }),
      }),
    );
    const user = userEvent.setup();
    renderForm();
    await fillValidForm(user);
    await user.click(screen.getByRole("button", { name: "가입하기" }));

    expect(await screen.findByText("이미 쓰고 있는 닉네임이에요")).toBeInTheDocument();
  });

  it("shows the generic failed string on INVALID_INPUT", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        json: async () => ({ code: "INVALID_INPUT", message: "서버 원문" }),
      }),
    );
    const user = userEvent.setup();
    renderForm();
    await fillValidForm(user);
    await user.click(screen.getByRole("button", { name: "가입하기" }));

    expect(await screen.findByText("이메일이나 비밀번호를 다시 확인해 주세요")).toBeInTheDocument();
  });

  it("shows the generic failed string when the response body fails to parse", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        json: async () => {
          throw new Error("invalid json");
        },
      }),
    );
    const user = userEvent.setup();
    renderForm();
    await fillValidForm(user);
    await user.click(screen.getByRole("button", { name: "가입하기" }));

    expect(await screen.findByText("이메일이나 비밀번호를 다시 확인해 주세요")).toBeInTheDocument();
  });

  it("shows the generic failed string and does not crash when fetch rejects", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));
    const user = userEvent.setup();
    renderForm();
    await fillValidForm(user);
    await user.click(screen.getByRole("button", { name: "가입하기" }));

    expect(await screen.findByText("이메일이나 비밀번호를 다시 확인해 주세요")).toBeInTheDocument();
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
    await fillValidForm(user);
    const button = screen.getByRole("button", { name: "가입하기" });
    await user.click(button);

    expect(button).toBeDisabled();
    resolveFetch({ ok: true, status: 201, json: async () => ({ userId: "u1" }) });
    await waitFor(() => expect(button).not.toBeDisabled());
  });
});
