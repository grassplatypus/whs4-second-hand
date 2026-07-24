// @vitest-environment node
import { describe, it, expect, vi, afterEach } from "vitest";
import { startConversation, sendMessage, checkConversationNumber, leaveConversation, listConversations } from "./service";
import { InMemoryChatRepo } from "./repo";
import { setFraudLookup, mockFraudLookup, type FraudLookup } from "./fraud-lookup";
import type { ChatDb } from "./db";

const SELLER_ID = "seller-1";
const BUYER_ID = "buyer-1";
const PRODUCT_ID = "product-1";

function fakeDb(): ChatDb {
  return {
    product: {
      findFirst: vi.fn().mockResolvedValue({ id: PRODUCT_ID, sellerId: SELLER_ID, title: "상품 제목" }),
    },
    user: { findUnique: vi.fn().mockResolvedValue({ nickname: "닉네임" }) },
  } as unknown as ChatDb;
}

afterEach(() => {
  setFraudLookup(mockFraudLookup);
  vi.restoreAllMocks();
});

describe("사기 이력 확인은 상대가 알려준 번호만", () => {
  it("내가 적어 넣은 번호는 조회해 주지 않는다", async () => {
    const repo = new InMemoryChatRepo();
    const db = fakeDb();
    const { conversationId } = await startConversation(repo, db, BUYER_ID, PRODUCT_ID, "안녕하세요");
    // 남의 계좌를 내 메시지에 적어 두고 조회를 시도하는 상황.
    await sendMessage(repo, BUYER_ID, conversationId, {
      kind: "text",
      text: "국민 110-234-567890 맞나요?",
    });

    await expect(
      checkConversationNumber(repo, BUYER_ID, conversationId, "110234567890"),
    ).rejects.toMatchObject({ httpStatus: 400, code: "NOT_IN_CONVERSATION" });
  });

  it("상대가 보낸 번호는 확인해 준다", async () => {
    const repo = new InMemoryChatRepo();
    const db = fakeDb();
    const { conversationId } = await startConversation(repo, db, BUYER_ID, PRODUCT_ID, "안녕하세요");
    await sendMessage(repo, SELLER_ID, conversationId, {
      kind: "text",
      text: "국민 110-234-567890 으로 보내주세요",
    });

    const result = await checkConversationNumber(repo, BUYER_ID, conversationId, "110234567890");
    expect(result).toMatchObject({ reported: expect.any(Boolean), count: expect.any(Number) });
  });

  it("한참 지난 옛 메시지의 번호도 끝까지 찾아 확인해 준다", async () => {
    const repo = new InMemoryChatRepo();
    const db = fakeDb();
    const { conversationId } = await startConversation(repo, db, BUYER_ID, PRODUCT_ID, "안녕하세요");
    await sendMessage(repo, SELLER_ID, conversationId, {
      kind: "text",
      text: "국민 110-234-567890 으로 보내주세요",
    });
    // 한 페이지(200건)를 훌쩍 넘기도록 대화를 이어간다.
    for (let i = 0; i < 260; i++) {
      await sendMessage(repo, i % 2 === 0 ? BUYER_ID : SELLER_ID, conversationId, {
        kind: "text",
        text: `그다음 이야기 ${i}`,
      });
    }

    const result = await checkConversationNumber(repo, BUYER_ID, conversationId, "110234567890");
    expect(result).toMatchObject({ reported: expect.any(Boolean) });
  });
});

describe("쪽 경계에 같은 시각 메시지가 걸려도", () => {
  it("건너뛰지 않고 찾아낸다", async () => {
    const repo = new InMemoryChatRepo();
    const db = fakeDb();
    const { conversationId } = await startConversation(repo, db, BUYER_ID, PRODUCT_ID, "안녕하세요");
    // 한 페이지(200건) 경계 부근에 같은 밀리초로 여러 건이 쌓인 상황을 만든다.
    vi.useFakeTimers();
    try {
      for (let i = 0; i < 230; i++) {
        await sendMessage(repo, i % 2 === 0 ? BUYER_ID : SELLER_ID, conversationId, {
          kind: "text",
          text: `이야기 ${i}`,
        });
        if (i % 5 === 0) vi.advanceTimersByTime(1); // 시각이 겹치는 구간을 일부러 만든다
      }
      await sendMessage(repo, SELLER_ID, conversationId, {
        kind: "text",
        text: "국민 110-234-567890 으로 보내주세요",
      });
      // 위 계좌 메시지가 가장 오래된 쪽으로 밀리도록 뒤에 더 쌓는다.
      for (let i = 0; i < 230; i++) {
        await sendMessage(repo, BUYER_ID, conversationId, { kind: "text", text: `그 뒤 ${i}` });
        if (i % 5 === 0) vi.advanceTimersByTime(1);
      }
    } finally {
      vi.useRealTimers();
    }

    const result = await checkConversationNumber(repo, BUYER_ID, conversationId, "110234567890");
    expect(result).toMatchObject({ reported: expect.any(Boolean) });
  });
});

describe("자동 통보는 감지한 그 번호로 조회한다", () => {
  it("메시지에 가격 등 다른 숫자가 섞여 있어도 계좌번호만 조회한다", async () => {
    const seen: string[] = [];
    const spy: FraudLookup = {
      async check(kind, digits) {
        seen.push(digits);
        return { reported: false, count: 0, kind };
      },
    };
    setFraudLookup(spy);

    const repo = new InMemoryChatRepo();
    const db = fakeDb();
    const { conversationId } = await startConversation(repo, db, BUYER_ID, PRODUCT_ID, "안녕하세요");
    await sendMessage(repo, SELLER_ID, conversationId, {
      kind: "text",
      text: "국민 110-234-567890 으로 5만원 보내주세요",
    });

    expect(seen).toContain("110234567890");
    expect(seen.some((d) => d.length > 12)).toBe(false); // 가격 숫자가 붙지 않았다
  });
});

describe("상품 상세에서 다시 말을 걸면", () => {
  it("나갔던 방이 내 목록에 다시 보인다", async () => {
    const repo = new InMemoryChatRepo();
    const db = fakeDb();
    const { conversationId } = await startConversation(repo, db, BUYER_ID, PRODUCT_ID, "안녕하세요");
    await leaveConversation(repo, BUYER_ID, conversationId);
    expect(await listConversations(repo, db, BUYER_ID)).toHaveLength(0);

    // 목록이 아니라 상품 상세에서 다시 채팅을 시작하는 경로.
    await startConversation(repo, db, BUYER_ID, PRODUCT_ID, "역시 살게요");

    expect(await listConversations(repo, db, BUYER_ID)).toHaveLength(1);
  });
});
