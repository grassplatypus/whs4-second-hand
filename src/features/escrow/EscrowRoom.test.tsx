import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { EscrowRoom, type EscrowDetailView } from "./EscrowRoom";
import ko from "@/i18n/messages/ko.json";

function renderIt() {
  return render(
    <NextIntlClientProvider locale="ko" messages={ko}>
      <EscrowRoom escrowId="e1" />
    </NextIntlClientProvider>,
  );
}

function detail(overrides: Partial<EscrowDetailView> = {}): EscrowDetailView {
  return {
    id: "e1",
    status: "FUNDED",
    amount: 10000,
    myRole: "buyer",
    myTurn: false,
    counterparty: { nickname: "풀숲여우" },
    product: { id: "p1", title: "아이폰 팝니다", status: "RESERVED" },
    events: [
      { status: "REQUESTED", amount: 10000, note: null, at: "2026-01-01T00:00:00.000Z", actor: "me" },
      { status: "ACCEPTED", amount: 10000, note: null, at: "2026-01-01T00:01:00.000Z", actor: "other" },
      { status: "FUNDED", amount: 10000, note: null, at: "2026-01-01T00:02:00.000Z", actor: "me" },
    ],
    createdAt: "2026-01-01T00:00:00.000Z",
    meetupPlace: null,
    meetupAt: null,
    myReview: null,
    ...overrides,
  };
}

/** URL/메서드에 따라 분기하는 fetch 목 — GET 상세 + POST 액션을 하나로 라우팅한다. */
function routedFetch(overrides: Record<string, (init?: RequestInit) => { ok: boolean; status?: number; body: unknown }>) {
  return vi.fn(async (url: unknown, init?: RequestInit) => {
    const u = String(url);
    const method = (init?.method ?? "GET").toUpperCase();
    const key = `${method} ${u}`;
    for (const [pattern, handler] of Object.entries(overrides)) {
      if (key.includes(pattern)) {
        const r = handler(init);
        return { ok: r.ok, status: r.status ?? (r.ok ? 200 : 400), json: async () => r.body };
      }
    }
    return { ok: true, status: 200, json: async () => ({}) };
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("EscrowRoom", () => {
  it("loads the detail on mount and renders amount as KRW, counterparty nickname, and the status catalog label", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => detail() }));
    renderIt();

    expect(await screen.findByText("풀숲여우")).toBeInTheDocument();
    expect(screen.getAllByText("10,000원").length).toBeGreaterThan(0);
    expect(screen.getByText(ko.escrow.statusLabel)).toBeInTheDocument();
  });

  it("buyer at FUNDED sees 수령확인 and 분쟁 신청 but not 거래 반환", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => detail({ myRole: "buyer" }) }));
    renderIt();

    expect(await screen.findByRole("button", { name: ko.escrow.confirm })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: ko.escrow.dispute })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: ko.escrow.refund })).not.toBeInTheDocument();
  });

  it("seller at FUNDED sees 거래 반환 but not 수령확인, plus the waiting message", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => detail({ myRole: "seller" }) }));
    renderIt();

    expect(await screen.findByRole("button", { name: ko.escrow.refund })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: ko.escrow.confirm })).not.toBeInTheDocument();
    expect(screen.getByText(ko.escrow.waitingConfirm)).toBeInTheDocument();
  });

  it("REQUESTED and myTurn: shows 수락 / 금액 조정 / 취소", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: async () => detail({ status: "REQUESTED", myTurn: true }) }),
    );
    renderIt();

    expect(await screen.findByRole("button", { name: ko.escrow.accept })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: ko.escrow.counter })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: ko.escrow.cancel })).toBeInTheDocument();
  });

  it("REQUESTED and not myTurn: shows the waiting-reply message and only 취소", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: async () => detail({ status: "REQUESTED", myTurn: false }) }),
    );
    renderIt();

    expect(await screen.findByText(ko.escrow.waitingReply)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: ko.escrow.cancel })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: ko.escrow.accept })).not.toBeInTheDocument();
  });

  it("performs an action (confirm) as a POST then re-fetches the detail to refresh state", async () => {
    let calls = 0;
    const fetchMock = routedFetch({
      "GET /api/escrow/e1": () => {
        calls += 1;
        // 첫 로드는 FUNDED, 액션 후 재조회는 RELEASED
        return { ok: true, body: detail({ status: calls === 1 ? "FUNDED" : "RELEASED" }) };
      },
      "POST /api/escrow/e1/confirm": () => ({ ok: true, body: { ok: true } }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    renderIt();

    await user.click(await screen.findByRole("button", { name: ko.escrow.confirm }));

    expect(await screen.findByText(ko.escrow.doneReleased)).toBeInTheDocument();
    const postCall = fetchMock.mock.calls.find(
      ([u, init]) => String(u).includes("/confirm") && (init as RequestInit | undefined)?.method === "POST",
    );
    expect(postCall).toBeTruthy();
  });

  it("maps an action error code to the catalog message, never the raw server text", async () => {
    const fetchMock = routedFetch({
      "GET /api/escrow/e1": () => ({ ok: true, body: detail({ myRole: "buyer" }) }),
      "POST /api/escrow/e1/confirm": () => ({
        ok: false,
        status: 409,
        body: { code: "INVALID_TRANSITION", message: "leaky server text" },
      }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    renderIt();

    await user.click(await screen.findByRole("button", { name: ko.escrow.confirm }));

    expect(await screen.findByRole("alert")).toHaveTextContent(ko.escrow.invalidTransition);
    expect(screen.queryByText("leaky server text")).not.toBeInTheDocument();
  });

  it("RELEASED: shows the done message and no participant action buttons", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => detail({ status: "RELEASED" }) }));
    renderIt();

    expect(await screen.findByText(ko.escrow.doneReleased)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: ko.escrow.confirm })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: ko.escrow.refund })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: ko.escrow.cancel })).not.toBeInTheDocument();
  });

  it("renders the event timeline with status labels and actor labels, never a raw enum or the counterparty's userId", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => detail() }));
    const { container } = renderIt();

    await screen.findByText("풀숲여우");
    // 타임라인 상태는 카탈로그 라벨로만
    expect(container.innerHTML).not.toMatch(/REQUESTED|ACCEPTED|FUNDED|RELEASED/);
    expect(screen.getAllByText(ko.escrow.actorMe).length).toBeGreaterThan(0);
    expect(screen.getAllByText(ko.escrow.actorOther).length).toBeGreaterThan(0);
  });

  it("maps a detail load 403 FORBIDDEN to the catalog message", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 403, json: async () => ({ code: "FORBIDDEN" }) }),
    );
    renderIt();

    expect(await screen.findByRole("alert")).toHaveTextContent(ko.escrow.forbidden);
  });
});

describe("EscrowRoom — meetup (직거래 약속)", () => {
  it("hides the meetup section while REQUESTED or CANCELLED", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: async () => detail({ status: "REQUESTED", myTurn: true }) }),
    );
    renderIt();

    await screen.findByRole("button", { name: ko.escrow.accept });
    expect(screen.queryByText(ko.escrow.meetupTitle)).not.toBeInTheDocument();
  });

  it("ACCEPTED with no meetup set: shows the empty message and a set-meetup button that opens the form and posts on submit", async () => {
    const fetchMock = routedFetch({
      "GET /api/escrow/e1": () => ({ ok: true, body: detail({ status: "ACCEPTED" }) }),
      "POST /api/escrow/e1/meetup": () => ({ ok: true, body: { ok: true } }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    renderIt();

    expect(await screen.findByText(ko.escrow.meetupEmpty)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: ko.escrow.meetupSet }));

    await user.type(screen.getByLabelText(ko.escrow.meetupPlaceLabel), "강남역 2번 출구");
    fireEvent.change(screen.getByLabelText(ko.escrow.meetupAtLabel), { target: { value: "2026-08-01T10:00" } });
    await user.click(screen.getByRole("button", { name: ko.escrow.meetupSave }));

    await waitFor(() => {
      const postCall = fetchMock.mock.calls.find(
        ([u, init]) => String(u).includes("/meetup") && (init as RequestInit | undefined)?.method === "POST",
      );
      expect(postCall).toBeTruthy();
      const body = JSON.parse((postCall![1] as RequestInit).body as string);
      expect(body.place).toBe("강남역 2번 출구");
      expect(typeof body.at).toBe("string");
    });
  });

  it("shows an existing appointment read-only, with an edit button while ACCEPTED/FUNDED", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => detail({ status: "FUNDED", meetupPlace: "강남역 2번 출구", meetupAt: "2026-08-01T01:00:00.000Z" }),
      }),
    );
    renderIt();

    expect(await screen.findByText("강남역 2번 출구")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: ko.escrow.meetupEdit })).toBeInTheDocument();
  });

  it("maps an invalid meetup submission to the meetup-specific message, not the amount one", async () => {
    const fetchMock = routedFetch({
      "GET /api/escrow/e1": () => ({ ok: true, body: detail({ status: "ACCEPTED" }) }),
      "POST /api/escrow/e1/meetup": () => ({ ok: false, status: 400, body: { code: "INVALID_INPUT" } }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    renderIt();

    await user.click(await screen.findByRole("button", { name: ko.escrow.meetupSet }));
    await user.type(screen.getByLabelText(ko.escrow.meetupPlaceLabel), "장소");
    fireEvent.change(screen.getByLabelText(ko.escrow.meetupAtLabel), { target: { value: "2026-08-01T10:00" } });
    await user.click(screen.getByRole("button", { name: ko.escrow.meetupSave }));

    expect(await screen.findByRole("alert")).toHaveTextContent(ko.escrow.meetupInvalid);
  });
});

describe("EscrowRoom — trade review (RELEASED only, one per author)", () => {
  it("RELEASED with no review yet: shows the write form; selecting a rating and submitting posts rating + trimmed comment", async () => {
    const fetchMock = routedFetch({
      "GET /api/escrow/e1": () => ({ ok: true, body: detail({ status: "RELEASED", myReview: null }) }),
      "POST /api/escrow/e1/review": () => ({ ok: true, body: { ok: true } }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    renderIt();

    expect(await screen.findByRole("heading", { name: ko.review.writeTitle })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: ko.review.submit })).toBeDisabled();

    await user.click(screen.getByRole("button", { name: ko.review.rating.GOOD }));
    await user.type(screen.getByLabelText(ko.review.commentLabel), "좋은 거래였어요");
    await user.click(screen.getByRole("button", { name: ko.review.submit }));

    await waitFor(() => {
      const postCall = fetchMock.mock.calls.find(
        ([u, init]) => String(u).includes("/review") && (init as RequestInit | undefined)?.method === "POST",
      );
      expect(postCall).toBeTruthy();
      const body = JSON.parse((postCall![1] as RequestInit).body as string);
      expect(body).toEqual({ rating: "GOOD", comment: "좋은 거래였어요" });
    });
  });

  it("RELEASED with an existing review: shows it read-only, not the write form", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => detail({ status: "RELEASED", myReview: { rating: "GOOD", comment: "좋았어요" } }),
      }),
    );
    renderIt();

    expect(await screen.findByText(ko.review.rating.GOOD)).toBeInTheDocument();
    expect(screen.getByText("좋았어요")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: ko.review.submit })).not.toBeInTheDocument();
  });

  it("does not show the review section before RELEASED", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => detail({ status: "FUNDED" }) }));
    renderIt();

    await screen.findByText(ko.escrow.statusLabel);
    expect(screen.queryByText(ko.review.writeTitle)).not.toBeInTheDocument();
  });

  it("maps ALREADY_REVIEWED to the review catalog message (not the escrow one), never the raw server text", async () => {
    const fetchMock = routedFetch({
      "GET /api/escrow/e1": () => ({ ok: true, body: detail({ status: "RELEASED", myReview: null }) }),
      "POST /api/escrow/e1/review": () => ({
        ok: false,
        status: 409,
        body: { code: "ALREADY_REVIEWED", message: "leaky server text" },
      }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    renderIt();

    await user.click(await screen.findByRole("button", { name: ko.review.rating.OK }));
    await user.click(screen.getByRole("button", { name: ko.review.submit }));

    expect(await screen.findByRole("alert")).toHaveTextContent(ko.review.alreadyReviewed);
    expect(screen.queryByText("leaky server text")).not.toBeInTheDocument();
  });
});
