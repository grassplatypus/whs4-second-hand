import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { ConnectionsManager } from "./ConnectionsManager";
import ko from "@/i18n/messages/ko.json";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));

function renderIt(connected: string[], initialError?: string) {
  return render(
    <NextIntlClientProvider locale="ko" messages={ko}>
      <ConnectionsManager connected={connected} initialError={initialError} />
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) }));
});
afterEach(() => vi.unstubAllGlobals());

describe("ConnectionsManager", () => {
  it("shows connect vs disconnect per provider", () => {
    renderIt(["GOOGLE"]);
    // 구글은 연결됨 → 해제 버튼, 카카오/네이버는 연결 링크
    expect(screen.getByRole("button", { name: "연결 해제" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "카카오로 계속하기" })).toHaveAttribute("href", "/api/auth/oauth/kakao/start?link=1");
  });

  it("shows the provider display name (not the raw enum or the login CTA text) on a linked row", () => {
    renderIt(["GOOGLE"]);
    expect(screen.getByText(ko.auth.oauth.providerGoogle)).toBeInTheDocument();
    expect(screen.queryByText("GOOGLE")).not.toBeInTheDocument();
    expect(screen.queryByText(ko.auth.oauth.google)).not.toBeInTheDocument();
  });

  it("posts to the unlink endpoint on disconnect", async () => {
    const user = userEvent.setup();
    renderIt(["GOOGLE", "KAKAO"]);
    await user.click(screen.getAllByRole("button", { name: "연결 해제" })[0]);
    await waitFor(() => {
      const call = (globalThis.fetch as any).mock.calls[0];
      expect(String(call[0])).toBe("/api/auth/oauth/google/unlink");
      expect(call[1].method).toBe("POST");
    });
  });

  it("shows the initialError catalog string when passed via prop", () => {
    renderIt(["GOOGLE"], ko.auth.oauth.identityTaken);
    expect(screen.getByRole("alert")).toHaveTextContent(ko.auth.oauth.identityTaken);
  });

  it("shows a catalog message when unlink is refused", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 409, json: async () => ({ code: "LAST_CREDENTIAL", message: "x" }) }));
    const user = userEvent.setup();
    renderIt(["GOOGLE"]);
    await user.click(screen.getByRole("button", { name: "연결 해제" }));
    expect(await screen.findByText("마지막 로그인 수단이라 해제할 수 없어요")).toBeInTheDocument();
  });

  it("shows StepUpPrompt on 401 STEP_UP_REQUIRED and retries unlink after reauth succeeds", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 401, json: async () => ({ code: "STEP_UP_REQUIRED", message: "x" }) }) // first unlink attempt
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true }) }) // step-up succeeds
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true }) }); // retried unlink succeeds
    vi.stubGlobal("fetch", fetchMock);

    const user = userEvent.setup();
    renderIt(["GOOGLE"]);
    await user.click(screen.getByRole("button", { name: "연결 해제" }));

    expect(fetchMock.mock.calls[0][0]).toBe("/api/auth/oauth/google/unlink");
    expect(await screen.findByRole("heading", { name: ko.auth.twofactor.stepUpTitle })).toBeInTheDocument();

    await user.type(screen.getByLabelText(ko.auth.twofactor.stepUpPassword), "hunter2hunter2");
    await user.click(screen.getByRole("button", { name: ko.auth.twofactor.stepUpSubmit }));

    await waitFor(() => expect(fetchMock.mock.calls[1][0]).toBe("/api/auth/step-up"));
    await waitFor(() => expect(fetchMock.mock.calls[2][0]).toBe("/api/auth/oauth/google/unlink"));
  });
});
