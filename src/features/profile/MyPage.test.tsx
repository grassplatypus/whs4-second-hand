import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { MyPage, type MyProfileView } from "./MyPage";
import ko from "@/i18n/messages/ko.json";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }));

const baseProfile: MyProfileView = {
  nickname: "풀숲여우",
  bio: "안녕하세요",
  region: "서울시 강남구 역삼동",
  phoneVerified: true,
  twoFactorMethod: "TOTP",
  identities: ["GOOGLE"],
  hasPassword: true,
  createdAt: "2025-01-01T00:00:00.000Z",
};

function renderIt(profile: MyProfileView = baseProfile) {
  return render(
    <NextIntlClientProvider locale="ko" messages={ko}>
      <MyPage initialProfile={profile} />
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

describe("MyPage — profile display", () => {
  it("shows nickname, bio, badges, connected providers, and account-management link", () => {
    renderIt();
    expect(screen.getByText("풀숲여우")).toBeInTheDocument();
    expect(screen.getByText("안녕하세요")).toBeInTheDocument();
    expect(screen.getByText("서울시 강남구 역삼동")).toBeInTheDocument();
    expect(screen.getByText(ko.profile.phoneVerified)).toBeInTheDocument();
    expect(screen.getByText(ko.profile.twoFactorOn)).toBeInTheDocument();
    expect(screen.getByText(ko.profile.hasPassword)).toBeInTheDocument();
    expect(screen.getByText("GOOGLE")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: ko.profile.viewPublicProfile })).toHaveAttribute(
      "href",
      "/u/풀숲여우",
    );
    expect(screen.getByRole("link", { name: ko.profile.accountManagement })).toHaveAttribute(
      "href",
      "#account-management",
    );
  });

  it("falls back to empty-state labels when there's no bio/region/password/connections", () => {
    renderIt({
      ...baseProfile,
      bio: null,
      region: null,
      phoneVerified: false,
      twoFactorMethod: "NONE",
      identities: [],
      hasPassword: false,
    });
    expect(screen.getByText(ko.profile.bioEmpty)).toBeInTheDocument();
    expect(screen.getByText(ko.profile.noRegion)).toBeInTheDocument();
    expect(screen.getByText(ko.profile.phoneNotVerified)).toBeInTheDocument();
    expect(screen.getByText(ko.profile.twoFactorOff)).toBeInTheDocument();
    expect(screen.getByText(ko.profile.noPassword)).toBeInTheDocument();
    expect(screen.getByText(ko.profile.noConnections)).toBeInTheDocument();
  });
});

describe("MyPage — bio edit", () => {
  it("edits and saves the bio via PATCH /api/profile/bio with the right body", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonOk({ ok: true })));
    const user = userEvent.setup();
    renderIt();

    await user.click(screen.getByRole("button", { name: ko.profile.editBio }));
    const textbox = screen.getByLabelText(ko.profile.bio);
    await user.clear(textbox);
    await user.type(textbox, "새 소개글");
    await user.click(screen.getByRole("button", { name: ko.profile.saveBio }));

    await waitFor(() => {
      const call = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(call[0]).toBe("/api/profile/bio");
      expect(call[1].method).toBe("PATCH");
      expect(JSON.parse(call[1].body)).toEqual({ bio: "새 소개글" });
    });
    expect(await screen.findByText(ko.profile.bioSaved)).toBeInTheDocument();
    expect(await screen.findByText("새 소개글")).toBeInTheDocument();
    expect(refresh).toHaveBeenCalled();
  });

  it("maps a failed save to the catalog error, never the server message", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonFail(400, "INVALID_INPUT")));
    const user = userEvent.setup();
    renderIt();

    await user.click(screen.getByRole("button", { name: ko.profile.editBio }));
    await user.click(screen.getByRole("button", { name: ko.profile.saveBio }));

    expect(await screen.findByRole("alert")).toHaveTextContent(ko.profile.bioFailed);
    expect(screen.queryByText("leaky server text")).not.toBeInTheDocument();
  });

  it("cancels editing without saving", async () => {
    const user = userEvent.setup();
    renderIt();
    await user.click(screen.getByRole("button", { name: ko.profile.editBio }));
    await user.click(screen.getByRole("button", { name: ko.profile.cancelBio }));
    expect(screen.queryByLabelText(ko.profile.bio)).not.toBeInTheDocument();
    expect(screen.getByText("안녕하세요")).toBeInTheDocument();
  });
});
