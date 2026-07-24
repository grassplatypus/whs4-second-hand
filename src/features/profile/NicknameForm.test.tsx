import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { NicknameForm } from "./NicknameForm";
import ko from "@/i18n/messages/ko.json";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }));

function renderIt(initialNickname = "풀숲여우") {
  return render(
    <NextIntlClientProvider locale="ko" messages={ko}>
      <NicknameForm initialNickname={initialNickname} />
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

describe("NicknameForm", () => {
  it("posts { nickname } to /api/profile/nickname", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonOk({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    renderIt();

    const input = screen.getByLabelText(ko.account.nickname);
    await user.clear(input);
    await user.type(input, "새닉네임");
    await user.click(screen.getByRole("button", { name: ko.account.submitNickname }));

    await waitFor(() => {
      const call = fetchMock.mock.calls[0];
      expect(call[0]).toBe("/api/profile/nickname");
      expect(call[1].method).toBe("POST");
      expect(JSON.parse(call[1].body)).toEqual({ nickname: "새닉네임" });
    });
    expect(await screen.findByText(ko.account.nicknameSaved)).toBeInTheDocument();
    expect(refresh).toHaveBeenCalled();
  });

  it("maps NICKNAME_TAKEN to the catalog error, never the server message", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonFail(409, "NICKNAME_TAKEN")));
    const user = userEvent.setup();
    renderIt();
    await user.click(screen.getByRole("button", { name: ko.account.submitNickname }));

    expect(await screen.findByRole("alert")).toHaveTextContent(ko.account.taken);
    expect(screen.queryByText("leaky server text")).not.toBeInTheDocument();
  });

  it("shows StepUpPrompt on 401 STEP_UP_REQUIRED, then retries after reauth succeeds", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonFail(401, "STEP_UP_REQUIRED"))
      .mockResolvedValueOnce(jsonOk({ ok: true }))
      .mockResolvedValueOnce(jsonOk({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    renderIt();

    await user.click(screen.getByRole("button", { name: ko.account.submitNickname }));
    expect(await screen.findByRole("alert")).toHaveTextContent(ko.account.stepUpRequired);
    expect(fetchMock.mock.calls[0][0]).toBe("/api/profile/nickname");

    await user.type(screen.getByLabelText(ko.auth.twofactor.stepUpPassword), "hunter2hunter2");
    await user.click(screen.getByRole("button", { name: ko.auth.twofactor.stepUpSubmit }));

    await waitFor(() => expect(fetchMock.mock.calls[1][0]).toBe("/api/auth/step-up"));
    await waitFor(() => expect(fetchMock.mock.calls[2][0]).toBe("/api/profile/nickname"));
    expect(await screen.findByText(ko.account.nicknameSaved)).toBeInTheDocument();
  });
});
