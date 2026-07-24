import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { LocationSettings } from "./LocationSettings";
import ko from "@/i18n/messages/ko.json";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }));

function renderIt(initialRegion: string | null = null) {
  return render(
    <NextIntlClientProvider locale="ko" messages={ko}>
      <LocationSettings initialRegion={initialRegion} />
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

describe("LocationSettings", () => {
  it("shows notSet when no region is passed in", () => {
    renderIt(null);
    expect(screen.getByText(new RegExp(ko.location.notSet))).toBeInTheDocument();
  });

  it("shows the SSR-provided current region string", () => {
    renderIt("서울특별시 강남구 역삼동");
    expect(screen.getByText(/서울특별시 강남구 역삼동/)).toBeInTheDocument();
  });

  it("posts sido/sigungu/dong to /api/auth/location and shows the returned region (never a coordinate)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonOk({ region: "서울특별시 강남구 역삼동" }));
    vi.stubGlobal("fetch", fetchMock);

    const user = userEvent.setup();
    renderIt(null);

    await user.type(screen.getByLabelText(ko.location.sido), "서울");
    await user.type(screen.getByLabelText(ko.location.sigungu), "강남구");
    await user.type(screen.getByLabelText(ko.location.dong), "역삼동");
    await user.click(screen.getByRole("button", { name: ko.location.save }));

    await waitFor(() => {
      expect(fetchMock.mock.calls[0][0]).toBe("/api/auth/location");
      expect(fetchMock.mock.calls[0][1].method).toBe("POST");
      expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
        sido: "서울",
        sigungu: "강남구",
        dong: "역삼동",
      });
    });

    expect(await screen.findByText(ko.location.saved)).toBeInTheDocument();
    expect(screen.getByText(/서울특별시 강남구 역삼동/)).toBeInTheDocument();
    // API never returns lat/lng, and the page/component must never render one
    expect(screen.queryByText(/lat/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/lng/i)).not.toBeInTheDocument();
    expect(refresh).toHaveBeenCalled();
  });

  it("maps a failed save to the catalog error, never the server message", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonFail(400, "INVALID_INPUT")));

    const user = userEvent.setup();
    renderIt(null);
    await user.type(screen.getByLabelText(ko.location.sido), "서울");
    await user.type(screen.getByLabelText(ko.location.sigungu), "강남구");
    await user.type(screen.getByLabelText(ko.location.dong), "역삼동");
    await user.click(screen.getByRole("button", { name: ko.location.save }));

    expect(await screen.findByRole("alert")).toHaveTextContent(ko.location.failed);
    expect(screen.queryByText("leaky server text")).not.toBeInTheDocument();
  });
});
