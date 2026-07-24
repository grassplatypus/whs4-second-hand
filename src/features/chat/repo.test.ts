// @vitest-environment node
import { describe, expect, it } from "vitest";
import { InMemoryChatRepo } from "./repo";

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
});
