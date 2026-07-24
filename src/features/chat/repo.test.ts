// @vitest-environment node
import { describe, expect, it } from "vitest";
import { InMemoryChatRepo, mergeReportReasons } from "./repo";

function makeConversation(overrides: Partial<Parameters<InMemoryChatRepo["createConversation"]>[0]> = {}) {
  const now = new Date();
  return {
    productId: "product-1",
    sellerId: "seller-1",
    buyerId: "buyer-1",
    createdAt: now,
    lastMessageAt: now,
    ...overrides,
  };
}

describe("InMemoryChatRepo", () => {
  it("creates a conversation and finds it by product+buyer", async () => {
    const repo = new InMemoryChatRepo();
    const created = await repo.createConversation(makeConversation());

    expect(created._id).toBeTruthy();
    expect(created.productId).toBe("product-1");

    const found = await repo.findConversationByProduct("product-1", "buyer-1");
    expect(found?._id).toBe(created._id);

    const missNotFound = await repo.findConversationByProduct("product-1", "someone-else");
    expect(missNotFound).toBeNull();
  });

  it("gets a conversation by id, returns null when missing", async () => {
    const repo = new InMemoryChatRepo();
    const created = await repo.createConversation(makeConversation());

    const found = await repo.getConversation(created._id);
    expect(found?.sellerId).toBe("seller-1");

    const missing = await repo.getConversation("nope");
    expect(missing).toBeNull();
  });

  it("inserts messages, lists them newest-first, and counts them", async () => {
    const repo = new InMemoryChatRepo();
    const conversation = await repo.createConversation(makeConversation());

    const first = await repo.insertMessage({
      conversationId: conversation._id,
      senderId: "buyer-1",
      kind: "text",
      text: "안녕하세요",
      masked: false,
      createdAt: new Date(2026, 0, 1, 10, 0, 0),
    });
    const second = await repo.insertMessage({
      conversationId: conversation._id,
      senderId: "seller-1",
      kind: "text",
      text: "네 안녕하세요",
      masked: false,
      createdAt: new Date(2026, 0, 1, 10, 5, 0),
    });

    const list = await repo.listMessages(conversation._id);
    expect(list.map((m) => m._id)).toEqual([second._id, first._id]);

    const count = await repo.countMessages(conversation._id);
    expect(count).toBe(2);

    const withCursor = await repo.listMessages(conversation._id, { cursor: second.createdAt });
    expect(withCursor.map((m) => m._id)).toEqual([first._id]);

    const limited = await repo.listMessages(conversation._id, { limit: 1 });
    expect(limited.map((m) => m._id)).toEqual([second._id]);
  });

  it("hasMessageFrom is true only for senders who actually sent a message in that conversation", async () => {
    const repo = new InMemoryChatRepo();
    const conversation = await repo.createConversation(makeConversation());
    const otherConversation = await repo.createConversation(
      makeConversation({ productId: "product-2", buyerId: "buyer-2" }),
    );

    expect(await repo.hasMessageFrom(conversation._id, "buyer-1")).toBe(false);
    expect(await repo.hasMessageFrom(conversation._id, "seller-1")).toBe(false);

    await repo.insertMessage({
      conversationId: conversation._id,
      senderId: "buyer-1",
      kind: "text",
      text: "안녕하세요",
      masked: false,
      createdAt: new Date(),
    });

    expect(await repo.hasMessageFrom(conversation._id, "buyer-1")).toBe(true);
    expect(await repo.hasMessageFrom(conversation._id, "seller-1")).toBe(false);
    // 다른 대화에 보낸 메시지는 셈에 들어가지 않는다.
    expect(await repo.hasMessageFrom(otherConversation._id, "buyer-1")).toBe(false);
  });

  it("gets a message by id (including rawText), returns null when missing", async () => {
    const repo = new InMemoryChatRepo();
    const conversation = await repo.createConversation(makeConversation());

    const inserted = await repo.insertMessage({
      conversationId: conversation._id,
      senderId: "buyer-1",
      kind: "text",
      text: "**** 이거 얼마예요",
      rawText: "시발 이거 얼마예요",
      masked: true,
      createdAt: new Date(),
    });

    const found = await repo.getMessage(inserted._id);
    expect(found?.rawText).toBe("시발 이거 얼마예요");
    expect(found?.text).toBe("**** 이거 얼마예요");

    const missing = await repo.getMessage("nope");
    expect(missing).toBeNull();
  });

  it("lists conversations for a participant sorted by lastMessageAt, seen by both buyer and seller", async () => {
    const repo = new InMemoryChatRepo();
    const older = await repo.createConversation(
      makeConversation({ productId: "p-old", lastMessageAt: new Date(2026, 0, 1) }),
    );
    const newer = await repo.createConversation(
      makeConversation({ productId: "p-new", lastMessageAt: new Date(2026, 0, 2) }),
    );
    // 참여자와 무관한 대화 — 목록에 나오면 안 됨.
    await repo.createConversation(
      makeConversation({ productId: "p-other", buyerId: "other-buyer", sellerId: "other-seller" }),
    );

    const asBuyer = await repo.listConversations("buyer-1");
    expect(asBuyer.map((c) => c._id)).toEqual([newer._id, older._id]);

    const asSeller = await repo.listConversations("seller-1");
    expect(asSeller.map((c) => c._id)).toEqual([newer._id, older._id]);
  });

  it("updates lastMessageAt on a conversation", async () => {
    const repo = new InMemoryChatRepo();
    const conversation = await repo.createConversation(makeConversation());
    const newTime = new Date(2026, 0, 3);

    await repo.updateLastMessageAt(conversation._id, newTime);

    const found = await repo.getConversation(conversation._id);
    expect(found?.lastMessageAt).toEqual(newTime);
  });

  it("blocks, checks isBlocked, and unblocks", async () => {
    const repo = new InMemoryChatRepo();

    expect(await repo.isBlocked("buyer-1", "seller-1")).toBe(false);

    await repo.block("buyer-1", "seller-1");
    expect(await repo.isBlocked("buyer-1", "seller-1")).toBe(true);
    // 방향성 — 반대 방향은 차단되지 않음.
    expect(await repo.isBlocked("seller-1", "buyer-1")).toBe(false);

    await repo.unblock("buyer-1", "seller-1");
    expect(await repo.isBlocked("buyer-1", "seller-1")).toBe(false);
  });

  it("inserts a report", async () => {
    const repo = new InMemoryChatRepo();
    await repo.insertReport({
      reporterId: "buyer-1",
      targetType: "message",
      targetId: "message-1",
      reason: "스팸",
      createdAt: new Date(),
      status: "open",
    });
    // insertReport는 조회 API가 없으므로 예외 없이 완료되는지만 확인한다.
    expect(true).toBe(true);
  });

  it("lists reports open-first then newest, filters by status, and updates status (관리자용)", async () => {
    const repo = new InMemoryChatRepo();
    await repo.insertReport({ reporterId: "u1", targetType: "user", targetId: "b1", reason: "오래된 open", createdAt: new Date("2026-07-01"), status: "open" });
    await repo.insertReport({ reporterId: "u2", targetType: "message", targetId: "m1", reason: "최신 open", createdAt: new Date("2026-07-20"), status: "open" });
    await repo.insertReport({ reporterId: "u3", targetType: "user", targetId: "b2", reason: "이미 처리됨", createdAt: new Date("2026-07-24"), status: "resolved" });

    const all = await repo.listReports();
    // resolved가 가장 최신이어도 open 두 건이 앞에 온다.
    expect(all.map((r) => r.reason)).toEqual(["최신 open", "오래된 open", "이미 처리됨"]);

    const onlyOpen = await repo.listReports({ status: "open" });
    expect(onlyOpen).toHaveLength(2);
    expect(onlyOpen.every((r) => r.status === "open")).toBe(true);

    const target = onlyOpen.find((r) => r.reason === "최신 open")!;
    expect(await repo.updateReportStatus(target._id, "dismissed")).toBe(true);
    expect(await repo.updateReportStatus("nope", "dismissed")).toBe(false); // 없는 신고는 false
    const afterOpen = await repo.listReports({ status: "open" });
    expect(afterOpen.map((r) => r.reason)).toEqual(["오래된 open"]);
    const dismissed = await repo.listReports({ status: "dismissed" });
    expect(dismissed.map((r) => r.reason)).toEqual(["최신 open"]);

    // countReports: 상태별·전체
    expect(await repo.countReports()).toBe(3);
    expect(await repo.countReports("open")).toBe(1);
    expect(await repo.countReports("dismissed")).toBe(1);
  });

  it("커서로 다음 쪽을 이어 받고, open 우선·최신순 정렬을 그대로 유지한다", async () => {
    const repo = new InMemoryChatRepo();
    await repo.insertReport({ reporterId: "u1", targetType: "user", targetId: "b1", reason: "open 오래됨", createdAt: new Date("2026-07-01"), status: "open" });
    await repo.insertReport({ reporterId: "u2", targetType: "user", targetId: "b2", reason: "open 최신", createdAt: new Date("2026-07-20"), status: "open" });
    await repo.insertReport({ reporterId: "u3", targetType: "user", targetId: "b3", reason: "처리됨 최신", createdAt: new Date("2026-07-24"), status: "resolved" });

    const first = await repo.listReports({ limit: 1 });
    expect(first.map((r) => r.reason)).toEqual(["open 최신"]);

    const second = await repo.listReports({
      limit: 1,
      cursor: { createdAt: first[0].createdAt, status: first[0].status },
    });
    // 커서 뒤에도 open이 먼저다 — resolved가 더 최신이어도 밀리지 않는다.
    expect(second.map((r) => r.reason)).toEqual(["open 오래됨"]);

    const third = await repo.listReports({
      limit: 1,
      cursor: { createdAt: second[0].createdAt, status: second[0].status },
    });
    expect(third.map((r) => r.reason)).toEqual(["처리됨 최신"]);

    const end = await repo.listReports({
      limit: 1,
      cursor: { createdAt: third[0].createdAt, status: third[0].status },
    });
    expect(end).toEqual([]);
  });

  it("커서는 상태 필터 안에서도 오래된 쪽으로 이어진다", async () => {
    const repo = new InMemoryChatRepo();
    await repo.insertReport({ reporterId: "u1", targetType: "user", targetId: "b1", reason: "1번", createdAt: new Date("2026-07-01"), status: "open" });
    await repo.insertReport({ reporterId: "u2", targetType: "user", targetId: "b2", reason: "2번", createdAt: new Date("2026-07-02"), status: "open" });
    await repo.insertReport({ reporterId: "u3", targetType: "user", targetId: "b3", reason: "3번", createdAt: new Date("2026-07-03"), status: "resolved" });

    const page = await repo.listReports({ status: "open", limit: 1 });
    expect(page.map((r) => r.reason)).toEqual(["2번"]);
    const next = await repo.listReports({
      status: "open",
      limit: 1,
      cursor: { createdAt: page[0].createdAt, status: page[0].status },
    });
    expect(next.map((r) => r.reason)).toEqual(["1번"]); // 다른 상태는 섞이지 않는다
  });
});

describe("mergeReportReasons", () => {
  it("같은 문구는 다시 붙이지 않고, 다른 문구만 ' · '로 잇는다", () => {
    expect(mergeReportReasons(undefined, "자동 감지: 비속어")).toBe("자동 감지: 비속어");
    expect(mergeReportReasons("자동 감지: 비속어", "자동 감지: 비속어")).toBe("자동 감지: 비속어");
    expect(mergeReportReasons("자동 감지: 비속어", "욕설")).toBe("자동 감지: 비속어 · 욕설");
    // 들어오는 사유가 이미 이어진 문자열이어도 조각 단위로 비교한다.
    expect(mergeReportReasons("자동 감지: 비속어", "자동 감지: 비속어 · 자동 감지: 연락처 우회")).toBe(
      "자동 감지: 비속어 · 자동 감지: 연락처 우회",
    );
  });
});

describe("upsertAutoReport (자동 감지 사유 병합)", () => {
  const base = { reporterId: "system", targetType: "message" as const, targetId: "m1", status: "open" as const };

  it("같은 대상에 같은 사유가 또 걸려도 사유가 중복되지 않는다", async () => {
    const repo = new InMemoryChatRepo();
    await repo.upsertAutoReport({ ...base, reason: "자동 감지: 비속어", snapshot: "원문", createdAt: new Date("2026-07-01") });
    await repo.upsertAutoReport({ ...base, reason: "자동 감지: 비속어", snapshot: "다른 원문", createdAt: new Date("2026-07-02") });

    const [report] = await repo.listReports();
    expect(report.reason).toBe("자동 감지: 비속어");
    expect(report.snapshot).toBe("원문"); // 먼저 남은 증거를 덮어쓰지 않는다
    expect(await repo.countReports()).toBe(1);
  });

  it("다른 사유가 걸리면 기존 사유를 지우지 않고 이어 붙인다", async () => {
    const repo = new InMemoryChatRepo();
    await repo.upsertAutoReport({ ...base, reason: "자동 감지: 비속어", createdAt: new Date("2026-07-01") });
    await repo.upsertAutoReport({ ...base, reason: "자동 감지: 연락처·계좌 우회 표기", createdAt: new Date("2026-07-02") });

    const [report] = await repo.listReports();
    expect(report.reason).toBe("자동 감지: 비속어 · 자동 감지: 연락처·계좌 우회 표기");
    expect(report.auto).toBe(true);
  });

  it("사용자 신고가 먼저 있으면 그 사유를 덮어쓰지 않고 자동 감지 사유를 더한다", async () => {
    const repo = new InMemoryChatRepo();
    await repo.mergeUserReport({ reporterId: "u1", targetType: "message", targetId: "m1", reason: "욕설이에요", createdAt: new Date("2026-07-01"), status: "open" });
    await repo.upsertAutoReport({ ...base, reason: "자동 감지: 비속어", createdAt: new Date("2026-07-02") });

    const [report] = await repo.listReports();
    expect(report.reason).toBe("욕설이에요 · 자동 감지: 비속어");
    expect(report.reportedBy).toEqual(["u1"]);
    expect(await repo.countReports()).toBe(1);
  });
});
