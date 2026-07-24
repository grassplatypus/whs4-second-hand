// @vitest-environment node
import { describe, it, expect, vi } from "vitest";
import {
  startConversation,
  sendMessage,
  listConversations,
  listMessages,
  blockUser,
  unblockUser,
  blockConversationCounterparty,
  unblockConversationCounterparty,
  reportMessage,
  reportUser,
  reportConversationCounterparty,
  leaveConversation,
  markConversationRead,
  listDormantConversations,
  deleteDormantConversations,
} from "./service";
import { InMemoryChatRepo } from "./repo";
import type { ChatDb } from "./db";

const SELLER_ID = "seller-1";
const BUYER_ID = "buyer-1";
const OTHER_ID = "other-1";
const PRODUCT_ID = "product-1";

function fakeDb(overrides: {
  productFindFirst?: ReturnType<typeof vi.fn>;
  userFindUnique?: ReturnType<typeof vi.fn>;
} = {}): ChatDb {
  return {
    product: {
      findFirst:
        overrides.productFindFirst ??
        vi.fn().mockResolvedValue({ id: PRODUCT_ID, sellerId: SELLER_ID, title: "상품 제목" }),
    },
    user: {
      findUnique: overrides.userFindUnique ?? vi.fn().mockResolvedValue({ nickname: "닉네임" }),
    },
  } as unknown as ChatDb;
}

describe("startConversation", () => {
  it("returns NOT_FOUND when the product is missing", async () => {
    const repo = new InMemoryChatRepo();
    const db = fakeDb({ productFindFirst: vi.fn().mockResolvedValue(null) });

    await expect(startConversation(repo, db, BUYER_ID, PRODUCT_ID, "안녕하세요")).rejects.toMatchObject({
      code: "NOT_FOUND",
      httpStatus: 404,
    });
  });

  it("blocks the seller from chatting with themself (SELF_CHAT 400)", async () => {
    const repo = new InMemoryChatRepo();
    const db = fakeDb();

    await expect(startConversation(repo, db, SELLER_ID, PRODUCT_ID, "안녕하세요")).rejects.toMatchObject({
      code: "SELF_CHAT",
      httpStatus: 400,
    });
  });

  it("blocks starting a conversation when either direction has blocked (BLOCKED 403)", async () => {
    const repo = new InMemoryChatRepo();
    const db = fakeDb();
    await repo.block(SELLER_ID, BUYER_ID);

    await expect(startConversation(repo, db, BUYER_ID, PRODUCT_ID, "안녕하세요")).rejects.toMatchObject({
      code: "BLOCKED",
      httpStatus: 403,
    });
  });

  it("blocks starting a conversation when the buyer blocked the seller (other direction)", async () => {
    const repo = new InMemoryChatRepo();
    const db = fakeDb();
    await repo.block(BUYER_ID, SELLER_ID);

    await expect(startConversation(repo, db, BUYER_ID, PRODUCT_ID, "안녕하세요")).rejects.toMatchObject({
      code: "BLOCKED",
      httpStatus: 403,
    });
  });

  it("rejects an empty/whitespace first message (EMPTY_MESSAGE 400)", async () => {
    const repo = new InMemoryChatRepo();
    const db = fakeDb();

    await expect(startConversation(repo, db, BUYER_ID, PRODUCT_ID, "   ")).rejects.toMatchObject({
      code: "EMPTY_MESSAGE",
      httpStatus: 400,
    });
  });

  it("creates a new conversation and stores the first message as text", async () => {
    const repo = new InMemoryChatRepo();
    const db = fakeDb();

    const result = await startConversation(repo, db, BUYER_ID, PRODUCT_ID, "안녕하세요 구매하고 싶어요");

    expect(result.conversationId).toBeTruthy();
    expect(result.message.kind).toBe("text");
    expect(result.message.text).toBe("안녕하세요 구매하고 싶어요");
    expect(result.message.masked).toBe(false);

    const conversation = await repo.getConversation(result.conversationId);
    expect(conversation?.buyerId).toBe(BUYER_ID);
    expect(conversation?.sellerId).toBe(SELLER_ID);
  });

  it("reuses an existing conversation for the same product+buyer instead of creating a duplicate", async () => {
    const repo = new InMemoryChatRepo();
    const db = fakeDb();

    const first = await startConversation(repo, db, BUYER_ID, PRODUCT_ID, "첫 메시지");
    const second = await startConversation(repo, db, BUYER_ID, PRODUCT_ID, "두번째 메시지");

    expect(second.conversationId).toBe(first.conversationId);
    const messages = await repo.listMessages(first.conversationId);
    expect(messages.length).toBe(2);
  });

  it("masks profanity in the first message and sets the masked flag (delivered text has no literal profanity)", async () => {
    const repo = new InMemoryChatRepo();
    const db = fakeDb();

    const result = await startConversation(repo, db, BUYER_ID, PRODUCT_ID, "시발 이거 얼마예요");

    expect(result.message.masked).toBe(true);
    expect(result.message.text).not.toContain("시발");
    expect(result.message.text).toContain("*");
  });
});

describe("sendMessage", () => {
  async function setupConversation(repo: InMemoryChatRepo) {
    return repo.createConversation({
      productId: PRODUCT_ID,
      sellerId: SELLER_ID,
      buyerId: BUYER_ID,
      createdAt: new Date(),
      lastMessageAt: new Date(),
    });
  }

  it("returns NOT_FOUND for a missing conversation", async () => {
    const repo = new InMemoryChatRepo();
    await expect(
      sendMessage(repo, BUYER_ID, "nope", { kind: "text", text: "hi" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND", httpStatus: 404 });
  });

  it("rejects a non-participant with FORBIDDEN 403 and writes nothing (participant isolation)", async () => {
    const repo = new InMemoryChatRepo();
    const conversation = await setupConversation(repo);

    await expect(
      sendMessage(repo, OTHER_ID, conversation._id, { kind: "text", text: "몰래 보냄" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN", httpStatus: 403 });

    const messages = await repo.listMessages(conversation._id);
    expect(messages.length).toBe(0);
  });

  it("blocks sending when either direction has blocked the other", async () => {
    const repo = new InMemoryChatRepo();
    const conversation = await setupConversation(repo);
    await repo.block(SELLER_ID, BUYER_ID);

    await expect(
      sendMessage(repo, BUYER_ID, conversation._id, { kind: "text", text: "안녕" }),
    ).rejects.toMatchObject({ code: "BLOCKED", httpStatus: 403 });
  });

  it("blocks the first message being an image — nobody has replied yet (IMAGE_BEFORE_REPLY 400)", async () => {
    const repo = new InMemoryChatRepo();
    const conversation = await setupConversation(repo);

    await expect(
      sendMessage(repo, BUYER_ID, conversation._id, { kind: "image", imagePath: "products/11111111-2222-3333-4444-555555555555.webp" }),
    ).rejects.toMatchObject({ code: "IMAGE_BEFORE_REPLY", httpStatus: 400 });

    const messages = await repo.listMessages(conversation._id);
    expect(messages.length).toBe(0);
  });

  it("blocks an image even after several texts, as long as the OTHER participant hasn't replied (IMAGE_BEFORE_REPLY 400)", async () => {
    const repo = new InMemoryChatRepo();
    const conversation = await setupConversation(repo);

    await sendMessage(repo, BUYER_ID, conversation._id, { kind: "text", text: "안녕하세요" });
    await sendMessage(repo, BUYER_ID, conversation._id, { kind: "text", text: "구매하고 싶어요" });
    await sendMessage(repo, BUYER_ID, conversation._id, { kind: "text", text: "아직 계신가요" });

    await expect(
      sendMessage(repo, BUYER_ID, conversation._id, { kind: "image", imagePath: "products/11111111-2222-3333-4444-555555555555.webp" }),
    ).rejects.toMatchObject({ code: "IMAGE_BEFORE_REPLY", httpStatus: 400 });

    const messages = await repo.listMessages(conversation._id);
    expect(messages.length).toBe(3);
    expect(messages.every((m) => m.kind === "text")).toBe(true);
  });

  it("allows an image once the OTHER participant has sent at least one message, and updates lastMessageAt", async () => {
    const repo = new InMemoryChatRepo();
    const conversation = await setupConversation(repo);

    await sendMessage(repo, BUYER_ID, conversation._id, { kind: "text", text: "안녕하세요" });
    await sendMessage(repo, SELLER_ID, conversation._id, { kind: "text", text: "네 안녕하세요" });
    const image = await sendMessage(repo, BUYER_ID, conversation._id, {
      kind: "image",
      imagePath: "products/11111111-2222-3333-4444-555555555555.webp",
    });

    expect(image.kind).toBe("image");
    expect(image.imagePath).toBe("products/11111111-2222-3333-4444-555555555555.webp");

    const updated = await repo.getConversation(conversation._id);
    expect(updated?.lastMessageAt.getTime()).toBeGreaterThanOrEqual(updated!.createdAt.getTime());
  });

  it("allows the seller to send an image right after the buyer's first message (seller is the 'other' participant who replied)", async () => {
    const repo = new InMemoryChatRepo();
    const conversation = await setupConversation(repo);

    await sendMessage(repo, BUYER_ID, conversation._id, { kind: "text", text: "안녕하세요" });
    const image = await sendMessage(repo, SELLER_ID, conversation._id, {
      kind: "image",
      imagePath: "products/11111111-2222-3333-4444-555555555555.webp",
    });

    expect(image.kind).toBe("image");
    expect(image.imagePath).toBe("products/11111111-2222-3333-4444-555555555555.webp");
  });

  it("masks profanity in a text message (delivered text has no literal profanity)", async () => {
    const repo = new InMemoryChatRepo();
    const conversation = await setupConversation(repo);

    const message = await sendMessage(repo, BUYER_ID, conversation._id, {
      kind: "text",
      text: "시발 진짜",
    });

    expect(message.masked).toBe(true);
    expect(message.text).not.toContain("시발");
    expect(message.text).toContain("*");
  });

  it("rejects an empty/whitespace text message (EMPTY_MESSAGE 400) and writes nothing", async () => {
    const repo = new InMemoryChatRepo();
    const conversation = await setupConversation(repo);

    await expect(
      sendMessage(repo, BUYER_ID, conversation._id, { kind: "text", text: "" }),
    ).rejects.toMatchObject({ code: "EMPTY_MESSAGE", httpStatus: 400 });

    await expect(
      sendMessage(repo, BUYER_ID, conversation._id, { kind: "text", text: "   " }),
    ).rejects.toMatchObject({ code: "EMPTY_MESSAGE", httpStatus: 400 });

    const messages = await repo.listMessages(conversation._id);
    expect(messages.length).toBe(0);
  });
});

describe("listConversations", () => {
  it("returns only otherNickname + product summary — no email/phone (PII-leaky prisma user asserted absent)", async () => {
    const repo = new InMemoryChatRepo();
    const conversation = await repo.createConversation({
      productId: PRODUCT_ID,
      sellerId: SELLER_ID,
      buyerId: BUYER_ID,
      createdAt: new Date(),
      lastMessageAt: new Date(2026, 0, 1),
    });

    // "Leaky" prisma mock — simulates a bug where nickname select accidentally
    // widens to grab more fields. The service must never surface them.
    const leakyUser = {
      nickname: "판매자닉네임",
      email: "seller@example.com",
      phone: "010-1234-5678",
    };
    const db = fakeDb({ userFindUnique: vi.fn().mockResolvedValue(leakyUser) });

    const summaries = await listConversations(repo, db, BUYER_ID);

    expect(summaries).toHaveLength(1);
    expect(summaries[0]).toEqual({
      conversationId: conversation._id,
      otherNickname: "판매자닉네임",
      otherAvatarPath: null,
      product: { id: PRODUCT_ID, title: "상품 제목" },
      lastMessageAt: conversation.lastMessageAt,
      unreadCount: expect.any(Number),
    });
    const serialized = JSON.stringify(summaries);
    expect(serialized).not.toContain("email");
    expect(serialized).not.toContain("phone");
    expect(serialized).not.toContain("seller@example.com");
    expect(serialized).not.toContain("010-1234-5678");
  });

  it("resolves the other participant's nickname from the seller's perspective too", async () => {
    const repo = new InMemoryChatRepo();
    await repo.createConversation({
      productId: PRODUCT_ID,
      sellerId: SELLER_ID,
      buyerId: BUYER_ID,
      createdAt: new Date(),
      lastMessageAt: new Date(),
    });
    const userFindUnique = vi.fn().mockResolvedValue({ nickname: "구매자닉네임" });
    const db = fakeDb({ userFindUnique });

    const summaries = await listConversations(repo, db, SELLER_ID);

    expect(summaries[0].otherNickname).toBe("구매자닉네임");
    expect(userFindUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: BUYER_ID } }),
    );
  });

  it("includes the product title so the list can lead with it, falling back to empty when the product is gone", async () => {
    const repo = new InMemoryChatRepo();
    await repo.createConversation({
      productId: PRODUCT_ID,
      sellerId: SELLER_ID,
      buyerId: BUYER_ID,
      createdAt: new Date(),
      lastMessageAt: new Date(),
    });
    const db = fakeDb({ productFindFirst: vi.fn().mockResolvedValue(null) });

    const summaries = await listConversations(repo, db, BUYER_ID);

    expect(summaries[0].product).toEqual({ id: PRODUCT_ID, title: "" });
  });
});

describe("listMessages", () => {
  async function setupConversationWithMessage(repo: InMemoryChatRepo) {
    const conversation = await repo.createConversation({
      productId: PRODUCT_ID,
      sellerId: SELLER_ID,
      buyerId: BUYER_ID,
      createdAt: new Date(),
      lastMessageAt: new Date(),
    });
    await repo.insertMessage({
      conversationId: conversation._id,
      senderId: BUYER_ID,
      kind: "text",
      text: "안녕하세요",
      masked: false,
      createdAt: new Date(),
    });
    return conversation;
  }

  it("returns messages for a participant (buyer)", async () => {
    const repo = new InMemoryChatRepo();
    const conversation = await setupConversationWithMessage(repo);

    const messages = await listMessages(repo, BUYER_ID, conversation._id);
    expect(messages.length).toBe(1);
    expect(messages[0].text).toBe("안녕하세요");
  });

  it("returns messages for a participant (seller)", async () => {
    const repo = new InMemoryChatRepo();
    const conversation = await setupConversationWithMessage(repo);

    const messages = await listMessages(repo, SELLER_ID, conversation._id);
    expect(messages.length).toBe(1);
  });

  it("rejects a non-participant (third user C) with FORBIDDEN 403 — participant isolation", async () => {
    const repo = new InMemoryChatRepo();
    const conversation = await setupConversationWithMessage(repo);

    await expect(listMessages(repo, OTHER_ID, conversation._id)).rejects.toMatchObject({
      code: "FORBIDDEN",
      httpStatus: 403,
    });
  });

  it("returns NOT_FOUND for a missing conversation", async () => {
    const repo = new InMemoryChatRepo();
    await expect(listMessages(repo, BUYER_ID, "nope")).rejects.toMatchObject({
      code: "NOT_FOUND",
      httpStatus: 404,
    });
  });
});

describe("blockUser / unblockUser", () => {
  it("blocks and unblocks a user", async () => {
    const repo = new InMemoryChatRepo();

    await blockUser(repo, BUYER_ID, SELLER_ID);
    expect(await repo.isBlocked(BUYER_ID, SELLER_ID)).toBe(true);

    await unblockUser(repo, BUYER_ID, SELLER_ID);
    expect(await repo.isBlocked(BUYER_ID, SELLER_ID)).toBe(false);
  });
});

describe("blockConversationCounterparty / unblockConversationCounterparty", () => {
  async function setupConversation(repo: InMemoryChatRepo) {
    return repo.createConversation({
      productId: PRODUCT_ID,
      sellerId: SELLER_ID,
      buyerId: BUYER_ID,
      createdAt: new Date(),
      lastMessageAt: new Date(),
    });
  }

  it("resolves the OTHER participant from conversationId and blocks/unblocks them — the client never supplies a raw userId", async () => {
    const repo = new InMemoryChatRepo();
    const conversation = await setupConversation(repo);

    await blockConversationCounterparty(repo, BUYER_ID, conversation._id);
    expect(await repo.isBlocked(BUYER_ID, SELLER_ID)).toBe(true);

    await unblockConversationCounterparty(repo, BUYER_ID, conversation._id);
    expect(await repo.isBlocked(BUYER_ID, SELLER_ID)).toBe(false);
  });

  it("works from the seller's side too (resolves buyer as the counterparty)", async () => {
    const repo = new InMemoryChatRepo();
    const conversation = await setupConversation(repo);

    await blockConversationCounterparty(repo, SELLER_ID, conversation._id);
    expect(await repo.isBlocked(SELLER_ID, BUYER_ID)).toBe(true);
  });

  it("rejects a non-participant (third user) with FORBIDDEN — participant isolation", async () => {
    const repo = new InMemoryChatRepo();
    const conversation = await setupConversation(repo);

    await expect(blockConversationCounterparty(repo, OTHER_ID, conversation._id)).rejects.toMatchObject({
      code: "FORBIDDEN",
      httpStatus: 403,
    });
  });

  it("returns NOT_FOUND for a missing conversation", async () => {
    const repo = new InMemoryChatRepo();
    await expect(blockConversationCounterparty(repo, BUYER_ID, "nope")).rejects.toMatchObject({
      code: "NOT_FOUND",
      httpStatus: 404,
    });
  });
});

describe("reportMessage / reportUser", () => {
  it("reports a message with status open", async () => {
    const repo = new InMemoryChatRepo();
    const conversation = await repo.createConversation({
      productId: PRODUCT_ID,
      sellerId: SELLER_ID,
      buyerId: BUYER_ID,
      createdAt: new Date(),
      lastMessageAt: new Date(),
    });
    const message = await repo.insertMessage({
      conversationId: conversation._id,
      senderId: BUYER_ID,
      kind: "text",
      text: "안녕하세요",
      rawText: "안녕하세요",
      masked: false,
      createdAt: new Date(),
    });
    const insertReportSpy = vi.spyOn(repo, "mergeUserReport");

    await reportMessage(repo, BUYER_ID, message._id, "욕설");

    expect(insertReportSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        reporterId: BUYER_ID,
        targetType: "message",
        targetId: message._id,
        reason: "욕설",
        status: "open",
      }),
    );
  });

  it("returns NOT_FOUND when reporting a missing messageId", async () => {
    const repo = new InMemoryChatRepo();

    await expect(reportMessage(repo, BUYER_ID, "nope", "욕설")).rejects.toMatchObject({
      code: "NOT_FOUND",
      httpStatus: 404,
    });
  });

  it("snapshots the ORIGINAL (pre-mask) text as admin evidence, while the delivered/listed text stays masked", async () => {
    const repo = new InMemoryChatRepo();
    const db = fakeDb();

    const started = await startConversation(repo, db, BUYER_ID, PRODUCT_ID, "시발 이거 팔아요?");

    // Delivered message (what the participant sees) is masked.
    expect(started.message.text).not.toContain("시발");
    expect(started.message.text).toContain("*");

    const insertReportSpy = vi.spyOn(repo, "mergeUserReport");
    await reportMessage(repo, SELLER_ID, started.message._id, "욕설 신고");

    expect(insertReportSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        snapshot: expect.stringContaining("시발"),
      }),
    );

    // Listed message for participants must still be masked, never the raw profanity.
    const listed = await listMessages(repo, BUYER_ID, started.conversationId);
    expect(listed[0].text).not.toContain("시발");
  });

  it("does not leak rawText to participants via startConversation/sendMessage returns or listMessages", async () => {
    const repo = new InMemoryChatRepo();
    const db = fakeDb();

    const started = await startConversation(repo, db, BUYER_ID, PRODUCT_ID, "시발 이거 팔아요?");
    expect((started.message as { rawText?: string }).rawText).toBeUndefined();
    expect(JSON.stringify(started.message)).not.toContain("시발");

    const sent = await sendMessage(repo, SELLER_ID, started.conversationId, {
      kind: "text",
      text: "개새끼야 비싸잖아",
    });
    expect((sent as { rawText?: string }).rawText).toBeUndefined();
    expect(JSON.stringify(sent)).not.toContain("개새끼");

    const listed = await listMessages(repo, BUYER_ID, started.conversationId);
    for (const message of listed) {
      expect((message as { rawText?: string }).rawText).toBeUndefined();
    }
    const serialized = JSON.stringify(listed);
    expect(serialized).not.toContain("시발");
    expect(serialized).not.toContain("개새끼");
  });

  it("reports a user with status open", async () => {
    const repo = new InMemoryChatRepo();
    const insertReportSpy = vi.spyOn(repo, "mergeUserReport");

    await reportUser(repo, BUYER_ID, SELLER_ID, "사기 의심");

    expect(insertReportSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        reporterId: BUYER_ID,
        targetType: "user",
        targetId: SELLER_ID,
        reason: "사기 의심",
        status: "open",
      }),
    );
  });
});

describe("reportConversationCounterparty", () => {
  it("resolves the OTHER participant from conversationId and reports them — the client never supplies a raw userId", async () => {
    const repo = new InMemoryChatRepo();
    const conversation = await repo.createConversation({
      productId: PRODUCT_ID,
      sellerId: SELLER_ID,
      buyerId: BUYER_ID,
      createdAt: new Date(),
      lastMessageAt: new Date(),
    });
    const insertReportSpy = vi.spyOn(repo, "mergeUserReport");

    await reportConversationCounterparty(repo, BUYER_ID, conversation._id, "사기 의심");

    expect(insertReportSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        reporterId: BUYER_ID,
        targetType: "user",
        targetId: SELLER_ID,
        reason: "사기 의심",
        status: "open",
      }),
    );
  });

  it("rejects a non-participant (third user) with FORBIDDEN — participant isolation", async () => {
    const repo = new InMemoryChatRepo();
    const conversation = await repo.createConversation({
      productId: PRODUCT_ID,
      sellerId: SELLER_ID,
      buyerId: BUYER_ID,
      createdAt: new Date(),
      lastMessageAt: new Date(),
    });

    await expect(
      reportConversationCounterparty(repo, OTHER_ID, conversation._id, "사기 의심"),
    ).rejects.toMatchObject({ code: "FORBIDDEN", httpStatus: 403 });
  });

  it("returns NOT_FOUND for a missing conversation", async () => {
    const repo = new InMemoryChatRepo();
    await expect(reportConversationCounterparty(repo, BUYER_ID, "nope", "사기 의심")).rejects.toMatchObject({
      code: "NOT_FOUND",
      httpStatus: 404,
    });
  });
});

describe("입력 검증(서버단)", () => {
  it("이미지 경로가 업로드 형식이 아니면 400 — 임의 문자열은 저장되지 않는다", async () => {
    const repo = new InMemoryChatRepo();
    const db = fakeDb({});
    const { conversationId } = await startConversation(repo, db, BUYER_ID, PRODUCT_ID, "안녕하세요");
    await sendMessage(repo, SELLER_ID, conversationId, { kind: "text", text: "네 안녕하세요" });

    for (const bad of ["img/1.png", "../../etc/passwd", "products/not-a-uuid.webp", "", undefined]) {
      await expect(
        sendMessage(repo, BUYER_ID, conversationId, { kind: "image", imagePath: bad as string }),
      ).rejects.toMatchObject({ code: "INVALID_IMAGE", httpStatus: 400 });
    }
  });

  it("메시지가 1000자를 넘으면 400", async () => {
    const repo = new InMemoryChatRepo();
    const db = fakeDb({});
    const { conversationId } = await startConversation(repo, db, BUYER_ID, PRODUCT_ID, "안녕하세요");
    await expect(
      sendMessage(repo, BUYER_ID, conversationId, { kind: "text", text: "가".repeat(1001) }),
    ).rejects.toMatchObject({ code: "TEXT_TOO_LONG", httpStatus: 400 });
  });

  it("신고 사유가 비었거나 500자를 넘으면 400", async () => {
    const repo = new InMemoryChatRepo();
    await expect(reportUser(repo, BUYER_ID, SELLER_ID, "   ")).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(reportUser(repo, BUYER_ID, SELLER_ID, "가".repeat(501))).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  it("대화 참여자가 아니면 그 메시지를 신고할 수 없다(403)", async () => {
    const repo = new InMemoryChatRepo();
    const db = fakeDb({});
    const { conversationId, message } = await startConversation(repo, db, BUYER_ID, PRODUCT_ID, "안녕하세요");
    expect(conversationId).toBeTruthy();
    await expect(reportMessage(repo, "third-party", message._id, "욕설/비방")).rejects.toMatchObject({
      code: "FORBIDDEN",
      httpStatus: 403,
    });
  });
});

describe("비속어 자동 감지(관리자 전용, 사용자에게는 조용히)", () => {
  it("비속어 메시지는 관리자용 자동 신고가 남고, 발신자 응답에는 아무 표시도 없다", async () => {
    const repo = new InMemoryChatRepo();
    const db = fakeDb({});
    const { conversationId } = await startConversation(repo, db, BUYER_ID, PRODUCT_ID, "안녕하세요");

    const delivered = await sendMessage(repo, BUYER_ID, conversationId, { kind: "text", text: "야 이 시발" });
    // 전달본은 마스킹되고, 자동 감지 사실은 응답 어디에도 없다.
    expect(delivered.text).not.toContain("시발");
    expect(JSON.stringify(delivered)).not.toContain("자동 감지");

    const reports = await repo.listReports({ status: "open" });
    const auto = reports.find((r) => r.auto);
    expect(auto).toBeTruthy();
    expect(auto!.reason).toBe("자동 감지: 비속어");
    expect(auto!.snapshot).toContain("시발"); // 관리자 증거는 원문
  });

  it("같은 메시지를 사용자가 신고하면 자동 건과 하나로 합쳐진다(중복 노출 없음)", async () => {
    const repo = new InMemoryChatRepo();
    const db = fakeDb({});
    const { conversationId } = await startConversation(repo, db, BUYER_ID, PRODUCT_ID, "안녕하세요");
    const bad = await sendMessage(repo, BUYER_ID, conversationId, { kind: "text", text: "야 이 시발" });

    await reportMessage(repo, SELLER_ID, bad._id, "욕설/비방");

    const reports = await repo.listReports({ status: "open" });
    const forMessage = reports.filter((r) => r.targetType === "message" && r.targetId === bad._id);
    expect(forMessage).toHaveLength(1); // 자동 + 사용자 신고가 한 건으로
    expect(forMessage[0].auto).toBe(true);
    expect(forMessage[0].reportedBy).toContain(SELLER_ID);
    expect(forMessage[0].reason).toBe("욕설/비방");
  });
});

describe("방 나가기 · 읽음 · 휴면", () => {
  it("나가면 내 목록에서만 사라지고 상대 목록에는 남는다", async () => {
    const repo = new InMemoryChatRepo();
    const db = fakeDb({});
    const { conversationId } = await startConversation(repo, db, BUYER_ID, PRODUCT_ID, "안녕하세요");

    await leaveConversation(repo, BUYER_ID, conversationId);

    expect(await listConversations(repo, db, BUYER_ID)).toHaveLength(0);
    expect(await listConversations(repo, db, SELLER_ID)).toHaveLength(1);
  });

  it("나간 뒤 상대가 새 메시지를 보내면 내 목록에 다시 나타난다", async () => {
    const repo = new InMemoryChatRepo();
    const db = fakeDb({});
    const { conversationId } = await startConversation(repo, db, BUYER_ID, PRODUCT_ID, "안녕하세요");
    await leaveConversation(repo, BUYER_ID, conversationId);
    expect(await listConversations(repo, db, BUYER_ID)).toHaveLength(0);

    await sendMessage(repo, SELLER_ID, conversationId, { kind: "text", text: "아직 있어요!" });

    expect(await listConversations(repo, db, BUYER_ID)).toHaveLength(1);
  });

  it("안 읽은 메시지 수를 세고, 읽으면 0이 된다", async () => {
    const repo = new InMemoryChatRepo();
    const db = fakeDb({});
    const { conversationId } = await startConversation(repo, db, BUYER_ID, PRODUCT_ID, "안녕하세요");
    await sendMessage(repo, SELLER_ID, conversationId, { kind: "text", text: "네" });
    await sendMessage(repo, SELLER_ID, conversationId, { kind: "text", text: "가능해요" });

    const before = await listConversations(repo, db, BUYER_ID);
    expect(before[0].unreadCount).toBe(2);

    await markConversationRead(repo, BUYER_ID, conversationId);
    const after = await listConversations(repo, db, BUYER_ID);
    expect(after[0].unreadCount).toBe(0);
  });

  it("양쪽 모두 나가고 새 메시지가 없으면 휴면 방이 되고, 관리자만 지울 수 있다", async () => {
    const repo = new InMemoryChatRepo();
    const db = fakeDb({});
    const { conversationId } = await startConversation(repo, db, BUYER_ID, PRODUCT_ID, "안녕하세요");

    await leaveConversation(repo, BUYER_ID, conversationId);
    expect(await listDormantConversations(repo)).toHaveLength(0); // 아직 한 명만 나감

    await leaveConversation(repo, SELLER_ID, conversationId);
    const dormant = await listDormantConversations(repo);
    expect(dormant.map((d) => d.conversationId)).toContain(conversationId);

    expect(await deleteDormantConversations(repo, [conversationId])).toBe(1);
    expect(await listDormantConversations(repo)).toHaveLength(0);
  });

  it("휴면이 아닌 방은 관리자도 지울 수 없다", async () => {
    const repo = new InMemoryChatRepo();
    const db = fakeDb({});
    const { conversationId } = await startConversation(repo, db, BUYER_ID, PRODUCT_ID, "안녕하세요");
    expect(await deleteDormantConversations(repo, [conversationId])).toBe(0);
    expect(await listConversations(repo, db, SELLER_ID)).toHaveLength(1);
  });

  it("참여자가 아니면 나가기·읽음 표시를 할 수 없다(403)", async () => {
    const repo = new InMemoryChatRepo();
    const db = fakeDb({});
    const { conversationId } = await startConversation(repo, db, BUYER_ID, PRODUCT_ID, "안녕하세요");
    await expect(leaveConversation(repo, "third", conversationId)).rejects.toMatchObject({ httpStatus: 403 });
    await expect(markConversationRead(repo, "third", conversationId)).rejects.toMatchObject({ httpStatus: 403 });
  });
});
