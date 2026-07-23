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
  await user.click(screen.getByLabelText("개인정보 수집·이용에 동의해요"));
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
    await user.click(screen.getByLabelText("개인정보 수집·이용에 동의해요")); // 다시 눌러 해제
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
});
