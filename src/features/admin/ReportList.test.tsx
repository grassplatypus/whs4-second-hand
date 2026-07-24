import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { ReportList, type ReportItemView } from "./ReportList";
import ko from "@/i18n/messages/ko.json";

function renderIt() {
  return render(
    <NextIntlClientProvider locale="ko" messages={ko}>
      <ReportList />
    </NextIntlClientProvider>,
  );
}

/** URL/메서드에 따라 분기하는 fetch 목 — GET 목록 + POST 처리를 하나로 라우팅한다. */
function routedFetch(
  overrides: Record<string, (init?: RequestInit) => { ok: boolean; status?: number; body: unknown }>,
) {
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
    return { ok: true, status: 200, json: async () => ({ reports: [] }) };
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const userReport: ReportItemView = {
  id: "r1",
  reporterNickname: "풀숲여우",
  targetType: "user",
  targetLabel: "나쁜사람",
  targetUserId: "bad-user-1",
  reason: "욕설을 했어요",
  snapshot: "원문 욕설 메시지",
  status: "open",
  createdAt: "2026-01-01T00:00:00.000Z",
};

const messageReport: ReportItemView = {
  id: "r2",
  reporterNickname: "바다표범",
  targetType: "message",
  targetLabel: "msg-123",
  targetUserId: null,
  reason: "스팸이에요",
  snapshot: null,
  status: "open",
  createdAt: "2026-01-02T00:00:00.000Z",
};

function ok(reports: ReportItemView[]) {
  return { ok: true, json: async () => ({ reports }) };
}

describe("ReportList", () => {
  it("fetches open reports on mount and renders reporter, target, reason and the admin-only snapshot", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(ok([userReport])));
    renderIt();

    expect(await screen.findByText("풀숲여우")).toBeInTheDocument();
    expect(screen.getByText("나쁜사람")).toBeInTheDocument();
    expect(screen.getByText(/욕설을 했어요/)).toBeInTheDocument();
    expect(screen.getByText(ko.admin.snapshot)).toBeInTheDocument();
    expect(screen.getByText("원문 욕설 메시지")).toBeInTheDocument();
  });

  it("defaults to the open status filter in the request query", async () => {
    const fetchMock = vi.fn().mockResolvedValue(ok([userReport]));
    vi.stubGlobal("fetch", fetchMock);
    renderIt();

    await screen.findByText("풀숲여우");
    expect(String(fetchMock.mock.calls[0][0])).toContain("status=open");
  });

  it("switching the status filter re-fetches with the new status", async () => {
    const fetchMock = routedFetch({
      "GET /api/admin/reports?status=open": () => ({ ok: true, body: { reports: [userReport] } }),
      "GET /api/admin/reports?status=resolved": () => ({ ok: true, body: { reports: [] } }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    renderIt();

    await screen.findByText("풀숲여우");
    await user.click(screen.getByRole("button", { name: ko.admin.reportStatus.resolved }));

    expect(await screen.findByText(ko.admin.reportsEmpty)).toBeInTheDocument();
    const resolvedCall = fetchMock.mock.calls.find((c) => String(c[0]).includes("status=resolved"));
    expect(resolvedCall).toBeTruthy();
  });

  it("resolve POSTs action=resolve then re-fetches the list", async () => {
    let calls = 0;
    const fetchMock = routedFetch({
      "GET /api/admin/reports": () => {
        calls += 1;
        return { ok: true, body: { reports: calls === 1 ? [userReport] : [] } };
      },
      "POST /api/admin/reports/r1/resolve": () => ({ ok: true, body: { ok: true } }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    renderIt();

    await user.click(await screen.findByRole("button", { name: ko.admin.resolve }));

    expect(await screen.findByText(ko.admin.reportsEmpty)).toBeInTheDocument();
    const postCall = fetchMock.mock.calls.find(
      ([u, init]) =>
        String(u).includes("/r1/resolve") && (init as RequestInit | undefined)?.method === "POST",
    );
    expect(postCall).toBeTruthy();
    expect(String((postCall?.[1] as RequestInit).body)).toContain("resolve");
  });

  it("maps an action error code to the catalog message, never the raw server text", async () => {
    const fetchMock = routedFetch({
      "GET /api/admin/reports": () => ({ ok: true, body: { reports: [userReport] } }),
      "POST /api/admin/reports/r1/resolve": () => ({
        ok: false,
        status: 404,
        body: { code: "NOT_FOUND", message: "leaky server text" },
      }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    renderIt();

    await user.click(await screen.findByRole("button", { name: ko.admin.resolve }));

    expect(await screen.findByRole("alert")).toHaveTextContent(ko.admin.notFound);
    expect(screen.queryByText("leaky server text")).not.toBeInTheDocument();
  });

  it("renders the report status via the catalog label, never the raw server string", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(ok([messageReport])));
    const { container } = renderIt();

    await screen.findByText("바다표범");
    expect(screen.getByText(ko.admin.targetMessage)).toBeInTheDocument();
    // 원본 상태 문자열("open")이 라벨 대신 새어나오지 않는다
    expect(container.innerHTML).not.toMatch(/>open</);
  });

  it("유저 신고에는 정지 버튼이 있고, 대상 userId로 suspend를 POST한 뒤 목록을 갱신한다", async () => {
    let calls = 0;
    const fetchMock = routedFetch({
      "GET /api/admin/reports": () => {
        calls += 1;
        return { ok: true, body: { reports: calls === 1 ? [userReport] : [] } };
      },
      "POST /api/admin/users/bad-user-1/suspend": () => ({ ok: true, body: { ok: true } }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    renderIt();

    await user.click(await screen.findByRole("button", { name: ko.admin.suspendUser }));

    const suspendCall = fetchMock.mock.calls.find(
      ([u, init]) => String(u).includes("/api/admin/users/bad-user-1/suspend") && (init as RequestInit | undefined)?.method === "POST",
    );
    expect(suspendCall).toBeTruthy();
    expect(await screen.findByText(ko.admin.reportsEmpty)).toBeInTheDocument();
  });

  it("메시지 신고에는 정지 버튼이 없다(대상 userId 없음)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(ok([messageReport])));
    renderIt();
    await screen.findByText("바다표범");
    expect(screen.queryByRole("button", { name: ko.admin.suspendUser })).not.toBeInTheDocument();
  });

  it("자동 신고는 신고자 자리에 '자동 감지' 라벨을 보여준다(빈칸 아님)", async () => {
    const systemReport: ReportItemView = {
      id: "r3",
      reporterNickname: null,
      reporterIsSystem: true,
      targetType: "message",
      targetLabel: "msg-999",
      targetUserId: null,
      reason: "자동 감지: 비속어",
      snapshot: "원문",
      status: "open",
      createdAt: "2026-01-03T00:00:00.000Z",
      auto: true,
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(ok([systemReport])));
    renderIt();

    await screen.findByText(ko.admin.reporter);
    // 신고자 자리(아바타 + 이름)가 카탈로그 문구로 채워진다 — 빈칸도, 원본 "system"도 아니다.
    expect(screen.getByRole("img", { name: ko.admin.systemReporter })).toBeInTheDocument();
    expect(screen.getAllByText(ko.admin.systemReporter)).toHaveLength(2); // 신고자 이름 + 자동 감지 배지
    expect(screen.queryByText("system")).not.toBeInTheDocument();
  });

  it("한 쪽이 꽉 차면 '더 보기'가 뜨고, 마지막 신고를 커서로 다음 쪽을 이어 붙인다", async () => {
    const page1 = Array.from({ length: 20 }, (_, i) => ({
      ...messageReport,
      id: `p1-${i}`,
      targetLabel: `msg-1-${i}`,
      createdAt: `2026-01-${String(20 - i).padStart(2, "0")}T00:00:00.000Z`,
    }));
    const page2 = [{ ...messageReport, id: "p2-0", targetLabel: "오래된-신고" }];
    const fetchMock = routedFetch({
      "cursor=": () => ({ ok: true, body: { reports: page2 } }),
      "GET /api/admin/reports": () => ({ ok: true, body: { reports: page1 } }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    renderIt();

    await user.click(await screen.findByRole("button", { name: ko.admin.reportsMore }));

    // 두 번째 요청에 마지막 신고의 createdAt·status가 커서로 실린다.
    const moreCall = fetchMock.mock.calls.find(([u]) => String(u).includes("cursor="));
    expect(String(moreCall?.[0])).toContain(encodeURIComponent(page1[19].createdAt));
    expect(String(moreCall?.[0])).toContain("cursorStatus=open");
    // 앞쪽을 지우지 않고 이어 붙인다.
    expect(await screen.findByText("오래된-신고")).toBeInTheDocument();
    expect(screen.getByText("msg-1-0")).toBeInTheDocument();
    // 다음 쪽이 한 쪽을 못 채웠으니 버튼은 사라진다.
    expect(screen.queryByRole("button", { name: ko.admin.reportsMore })).not.toBeInTheDocument();
  });

  it("한 쪽을 다 못 채우면 '더 보기'가 없다", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(ok([messageReport])));
    renderIt();
    await screen.findByText("바다표범");
    expect(screen.queryByRole("button", { name: ko.admin.reportsMore })).not.toBeInTheDocument();
  });

  it("maps a load error code to the catalog message", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 403, json: async () => ({ code: "FORBIDDEN" }) }),
    );
    renderIt();

    expect(await screen.findByRole("alert")).toHaveTextContent(ko.admin.forbidden);
  });
});
