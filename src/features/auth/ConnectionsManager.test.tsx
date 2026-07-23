import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { ConnectionsManager } from "./ConnectionsManager";
import ko from "@/i18n/messages/ko.json";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));

function renderIt(connected: string[]) {
  return render(
    <NextIntlClientProvider locale="ko" messages={ko}>
      <ConnectionsManager connected={connected} />
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

  it("shows a catalog message when unlink is refused", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 409, json: async () => ({ code: "LAST_CREDENTIAL", message: "x" }) }));
    const user = userEvent.setup();
    renderIt(["GOOGLE"]);
    await user.click(screen.getByRole("button", { name: "연결 해제" }));
    expect(await screen.findByText("마지막 로그인 수단이라 해제할 수 없어요")).toBeInTheDocument();
  });
});
