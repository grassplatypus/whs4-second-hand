// @vitest-environment node
import { describe, it, expect, vi } from "vitest";
import {
  requestEscrow,
  counterEscrow,
  acceptEscrow,
  cancelEscrow,
  fundEscrow,
  confirmReceipt,
  refundEscrow,
  disputeEscrow,
  resolveDispute,
  getEscrow,
  listEscrows,
  countActiveEscrows,
} from "./service";
import type { EscrowDb } from "./db";

const BUYER = "buyer-1";
const SELLER = "seller-1";
const THIRD = "third-1";
const ADMIN = "admin-1";
const PRODUCT = "product-1";
const ESCROW = "escrow-1";

type Delegate = Record<string, ReturnType<typeof vi.fn>>;

/**
 * 목 DB. 상태 변경은 전부 $transaction 안의 조건부 쓰기(updateMany + count)로 이뤄진다.
 * tx 델리게이트를 노출해 어떤 where/data로 호출됐는지 단언한다.
 */
function fakeDb(over: {
  escrow?: Delegate;
  product?: Delegate;
  tx?: { escrow?: Delegate; escrowEvent?: Delegate; product?: Delegate };
}) {
  const tx = {
    escrow: over.tx?.escrow ?? { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    escrowEvent: over.tx?.escrowEvent ?? { create: vi.fn().mockResolvedValue({}) },
    product: over.tx?.product ?? { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
  };
  const db = {
    escrow: {
      findUnique: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockResolvedValue({ id: ESCROW }),
      count: vi.fn().mockResolvedValue(0),
      ...(over.escrow ?? {}),
    },
    product: {
      findFirst: vi.fn().mockResolvedValue(null),
      ...(over.product ?? {}),
    },
    user: {},
    $transaction: vi.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
  } as unknown as EscrowDb;
  return { db, tx };
}

function core(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: ESCROW,
    status: "REQUESTED",
    buyerId: BUYER,
    sellerId: SELLER,
    productId: PRODUCT,
    amount: 10000,
    lastProposerId: BUYER,
    ...over,
  };
}

describe("requestEscrow", () => {
  it("판매중 상품에 요청하면 REQUESTED로 생성하고 판매자·구매자를 스냅샷한다", async () => {
    const create = vi.fn().mockResolvedValue({ id: ESCROW });
    const { db } = fakeDb({
      product: { findFirst: vi.fn().mockResolvedValue({ sellerId: SELLER, status: "SELLING" }) },
      escrow: { create },
    });
    const r = await requestEscrow(db, BUYER, PRODUCT, 10000);
    expect(r).toEqual({ id: ESCROW });
    const data = create.mock.calls[0][0].data;
    expect(data).toMatchObject({ buyerId: BUYER, sellerId: SELLER, amount: 10000, status: "REQUESTED", lastProposerId: BUYER });
  });

  it("자기 상품이면 SELF_TRADE 400", async () => {
    const { db } = fakeDb({
      product: { findFirst: vi.fn().mockResolvedValue({ sellerId: BUYER, status: "SELLING" }) },
    });
    await expect(requestEscrow(db, BUYER, PRODUCT, 10000)).rejects.toMatchObject({ code: "SELF_TRADE", httpStatus: 400 });
  });

  it("판매중이 아니면 PRODUCT_UNAVAILABLE 409", async () => {
    const { db } = fakeDb({
      product: { findFirst: vi.fn().mockResolvedValue({ sellerId: SELLER, status: "RESERVED" }) },
    });
    await expect(requestEscrow(db, BUYER, PRODUCT, 10000)).rejects.toMatchObject({ code: "PRODUCT_UNAVAILABLE", httpStatus: 409 });
  });

  it("없는(또는 삭제된) 상품이면 404", async () => {
    const { db } = fakeDb({ product: { findFirst: vi.fn().mockResolvedValue(null) } });
    await expect(requestEscrow(db, BUYER, PRODUCT, 10000)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("금액이 0·음수·비정수·상한초과·비숫자면 400", async () => {
    const { db } = fakeDb({ product: { findFirst: vi.fn().mockResolvedValue({ sellerId: SELLER, status: "SELLING" }) } });
    for (const bad of [0, -1, 1.5, 1_000_000_001, "1000" as unknown]) {
      await expect(requestEscrow(db, BUYER, PRODUCT, bad)).rejects.toMatchObject({ code: "INVALID_AMOUNT" });
    }
  });
});

describe("counterEscrow", () => {
  it("상대 차례일 때 금액을 갱신하고 lastProposer를 나로 바꾼다(REQUESTED 조건부, 상태 유지)", async () => {
    const { db, tx } = fakeDb({
      escrow: { findUnique: vi.fn().mockResolvedValue(core({ lastProposerId: BUYER })) },
    });
    await counterEscrow(db, SELLER, ESCROW, 8000);
    const call = tx.escrow.updateMany.mock.calls[0][0];
    expect(call.where).toMatchObject({ id: ESCROW, status: "REQUESTED", lastProposerId: { not: SELLER } });
    expect(call.data).toMatchObject({ amount: 8000, lastProposerId: SELLER });
  });

  it("내가 마지막 제안자면 NOT_YOUR_TURN 400", async () => {
    const { db } = fakeDb({ escrow: { findUnique: vi.fn().mockResolvedValue(core({ lastProposerId: SELLER })) } });
    await expect(counterEscrow(db, SELLER, ESCROW, 8000)).rejects.toMatchObject({ code: "NOT_YOUR_TURN", httpStatus: 400 });
  });

  it("제3자는 403", async () => {
    const { db } = fakeDb({ escrow: { findUnique: vi.fn().mockResolvedValue(core()) } });
    await expect(counterEscrow(db, THIRD, ESCROW, 8000)).rejects.toMatchObject({ code: "FORBIDDEN", httpStatus: 403 });
  });

  it("REQUESTED가 아니면 409", async () => {
    const { db } = fakeDb({ escrow: { findUnique: vi.fn().mockResolvedValue(core({ status: "ACCEPTED", lastProposerId: BUYER })) } });
    await expect(counterEscrow(db, SELLER, ESCROW, 8000)).rejects.toMatchObject({ code: "INVALID_TRANSITION", httpStatus: 409 });
  });
});

describe("acceptEscrow", () => {
  it("상대가 수락하면 ACCEPTED(REQUESTED·비제안자 조건부 쓰기)", async () => {
    const { db, tx } = fakeDb({ escrow: { findUnique: vi.fn().mockResolvedValue(core({ lastProposerId: BUYER })) } });
    await acceptEscrow(db, SELLER, ESCROW);
    const call = tx.escrow.updateMany.mock.calls[0][0];
    expect(call.where).toMatchObject({ id: ESCROW, status: "REQUESTED", lastProposerId: { not: SELLER } });
    expect(call.data).toMatchObject({ status: "ACCEPTED" });
  });

  it("내 제안을 내가 수락하면 CANNOT_ACCEPT_OWN 400", async () => {
    const { db } = fakeDb({ escrow: { findUnique: vi.fn().mockResolvedValue(core({ lastProposerId: BUYER })) } });
    await expect(acceptEscrow(db, BUYER, ESCROW)).rejects.toMatchObject({ code: "CANNOT_ACCEPT_OWN", httpStatus: 400 });
  });

  it("동시성: 조건부 쓰기가 0행이면 409(이미 다른 전이가 선점)", async () => {
    const { db } = fakeDb({
      escrow: { findUnique: vi.fn().mockResolvedValue(core({ lastProposerId: BUYER })) },
      tx: { escrow: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) } },
    });
    await expect(acceptEscrow(db, SELLER, ESCROW)).rejects.toMatchObject({ code: "INVALID_TRANSITION", httpStatus: 409 });
  });

  it("REQUESTED가 아니면 409(예: 이미 ACCEPTED)", async () => {
    const { db } = fakeDb({ escrow: { findUnique: vi.fn().mockResolvedValue(core({ status: "ACCEPTED", lastProposerId: BUYER })) } });
    await expect(acceptEscrow(db, SELLER, ESCROW)).rejects.toMatchObject({ code: "INVALID_TRANSITION" });
  });
});

describe("cancelEscrow", () => {
  it("REQUESTED/ACCEPTED는 참여자가 취소할 수 있다", async () => {
    for (const status of ["REQUESTED", "ACCEPTED"]) {
      const { db, tx } = fakeDb({ escrow: { findUnique: vi.fn().mockResolvedValue(core({ status })) } });
      await cancelEscrow(db, SELLER, ESCROW);
      expect(tx.escrow.updateMany.mock.calls[0][0].data).toMatchObject({ status: "CANCELLED" });
      expect(tx.escrow.updateMany.mock.calls[0][0].where.status).toEqual({ in: ["REQUESTED", "ACCEPTED"] });
    }
  });

  it("FUNDED는 취소 불가 409", async () => {
    const { db } = fakeDb({ escrow: { findUnique: vi.fn().mockResolvedValue(core({ status: "FUNDED" })) } });
    await expect(cancelEscrow(db, BUYER, ESCROW)).rejects.toMatchObject({ code: "INVALID_TRANSITION", httpStatus: 409 });
  });
});

describe("fundEscrow", () => {
  it("구매자가 입금하면 상품 SELLING→RESERVED(조건부)·에스크로 ACCEPTED→FUNDED를 한 트랜잭션으로", async () => {
    const { db, tx } = fakeDb({
      escrow: { findUnique: vi.fn().mockResolvedValue(core({ status: "ACCEPTED" })) },
    });
    await fundEscrow(db, BUYER, ESCROW);
    expect(db.$transaction).toHaveBeenCalledOnce();
    const pCall = tx.product.updateMany.mock.calls[0][0];
    expect(pCall.where).toMatchObject({ id: PRODUCT, status: "SELLING", deletedAt: null });
    expect(pCall.data).toMatchObject({ status: "RESERVED" });
    expect(tx.escrow.updateMany.mock.calls[0][0].data).toMatchObject({ status: "FUNDED" });
    expect(tx.escrowEvent.create).toHaveBeenCalled();
  });

  it("판매자는 입금할 수 없다(403)", async () => {
    const { db } = fakeDb({ escrow: { findUnique: vi.fn().mockResolvedValue(core({ status: "ACCEPTED" })) } });
    await expect(fundEscrow(db, SELLER, ESCROW)).rejects.toMatchObject({ code: "FORBIDDEN", httpStatus: 403 });
  });

  it("이중보관 방지: 상품 조건부 갱신이 0행이면 PRODUCT_UNAVAILABLE 409", async () => {
    const { db } = fakeDb({
      escrow: { findUnique: vi.fn().mockResolvedValue(core({ status: "ACCEPTED" })) },
      tx: { product: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) } },
    });
    await expect(fundEscrow(db, BUYER, ESCROW)).rejects.toMatchObject({ code: "PRODUCT_UNAVAILABLE", httpStatus: 409 });
  });

  it("ACCEPTED가 아니면 409", async () => {
    const { db } = fakeDb({ escrow: { findUnique: vi.fn().mockResolvedValue(core({ status: "REQUESTED" })) } });
    await expect(fundEscrow(db, BUYER, ESCROW)).rejects.toMatchObject({ code: "INVALID_TRANSITION" });
  });
});

describe("confirmReceipt", () => {
  it("구매자 수령확인 → 에스크로 FUNDED→RELEASED(조건부)·상품 SOLD", async () => {
    const { db, tx } = fakeDb({ escrow: { findUnique: vi.fn().mockResolvedValue(core({ status: "FUNDED" })) } });
    await confirmReceipt(db, BUYER, ESCROW);
    expect(tx.escrow.updateMany.mock.calls[0][0].where).toMatchObject({ id: ESCROW, status: "FUNDED" });
    expect(tx.escrow.updateMany.mock.calls[0][0].data).toMatchObject({ status: "RELEASED" });
    expect(tx.product.updateMany.mock.calls[0][0].data).toMatchObject({ status: "SOLD" });
  });

  it("판매자는 수령확인할 수 없다(403)", async () => {
    const { db } = fakeDb({ escrow: { findUnique: vi.fn().mockResolvedValue(core({ status: "FUNDED" })) } });
    await expect(confirmReceipt(db, SELLER, ESCROW)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("DISPUTED 거래는 참여자가 정산할 수 없다(관리자 조정 우회 차단) 409", async () => {
    const { db } = fakeDb({ escrow: { findUnique: vi.fn().mockResolvedValue(core({ status: "DISPUTED" })) } });
    await expect(confirmReceipt(db, BUYER, ESCROW)).rejects.toMatchObject({ code: "INVALID_TRANSITION", httpStatus: 409 });
  });

  it("동시성: 조건부 쓰기가 0행이면 409(이미 반환·정산됨)", async () => {
    const { db } = fakeDb({
      escrow: { findUnique: vi.fn().mockResolvedValue(core({ status: "FUNDED" })) },
      tx: { escrow: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) } },
    });
    await expect(confirmReceipt(db, BUYER, ESCROW)).rejects.toMatchObject({ code: "INVALID_TRANSITION", httpStatus: 409 });
  });

  it("FUNDED가 아니면 409", async () => {
    const { db } = fakeDb({ escrow: { findUnique: vi.fn().mockResolvedValue(core({ status: "ACCEPTED" })) } });
    await expect(confirmReceipt(db, BUYER, ESCROW)).rejects.toMatchObject({ code: "INVALID_TRANSITION" });
  });
});

describe("refundEscrow", () => {
  it("판매자 반환 → 에스크로 FUNDED→REFUNDED(조건부)·상품 SELLING 복귀", async () => {
    const { db, tx } = fakeDb({ escrow: { findUnique: vi.fn().mockResolvedValue(core({ status: "FUNDED" })) } });
    await refundEscrow(db, SELLER, ESCROW);
    expect(tx.escrow.updateMany.mock.calls[0][0].data).toMatchObject({ status: "REFUNDED" });
    expect(tx.product.updateMany.mock.calls[0][0].data).toMatchObject({ status: "SELLING" });
  });

  it("구매자는 반환할 수 없다(403)", async () => {
    const { db } = fakeDb({ escrow: { findUnique: vi.fn().mockResolvedValue(core({ status: "FUNDED" })) } });
    await expect(refundEscrow(db, BUYER, ESCROW)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("DISPUTED 거래는 판매자가 반환할 수 없다(관리자 조정 우회 차단) 409", async () => {
    const { db } = fakeDb({ escrow: { findUnique: vi.fn().mockResolvedValue(core({ status: "DISPUTED" })) } });
    await expect(refundEscrow(db, SELLER, ESCROW)).rejects.toMatchObject({ code: "INVALID_TRANSITION", httpStatus: 409 });
  });
});

describe("disputeEscrow", () => {
  it("참여자가 FUNDED에서 분쟁 접수 → DISPUTED(노트 trim, 이벤트에 기록)", async () => {
    const { db, tx } = fakeDb({ escrow: { findUnique: vi.fn().mockResolvedValue(core({ status: "FUNDED" })) } });
    await disputeEscrow(db, BUYER, ESCROW, "  물건이 설명과 달라요  ");
    expect(tx.escrow.updateMany.mock.calls[0][0].where).toMatchObject({ id: ESCROW, status: "FUNDED" });
    expect(tx.escrow.updateMany.mock.calls[0][0].data).toMatchObject({ status: "DISPUTED" });
    expect(tx.escrowEvent.create.mock.calls[0][0].data.note).toBe("물건이 설명과 달라요");
  });

  it("FUNDED가 아니면 409", async () => {
    const { db } = fakeDb({ escrow: { findUnique: vi.fn().mockResolvedValue(core({ status: "ACCEPTED" })) } });
    await expect(disputeEscrow(db, BUYER, ESCROW)).rejects.toMatchObject({ code: "INVALID_TRANSITION" });
  });
});

describe("resolveDispute", () => {
  it("release면 에스크로 DISPUTED→RELEASED(조건부)·상품 SOLD(actor=admin)", async () => {
    const { db, tx } = fakeDb({ escrow: { findUnique: vi.fn().mockResolvedValue({ status: "DISPUTED", productId: PRODUCT, amount: 10000 }) } });
    await resolveDispute(db, ADMIN, ESCROW, "release");
    expect(tx.escrow.updateMany.mock.calls[0][0].where).toMatchObject({ id: ESCROW, status: "DISPUTED" });
    expect(tx.escrow.updateMany.mock.calls[0][0].data).toMatchObject({ status: "RELEASED" });
    expect(tx.product.updateMany.mock.calls[0][0].data).toMatchObject({ status: "SOLD" });
    expect(tx.escrowEvent.create.mock.calls[0][0].data).toMatchObject({ actorId: ADMIN, to: "RELEASED" });
  });

  it("refund면 에스크로 REFUNDED·상품 SELLING", async () => {
    const { db, tx } = fakeDb({ escrow: { findUnique: vi.fn().mockResolvedValue({ status: "DISPUTED", productId: PRODUCT, amount: 10000 }) } });
    await resolveDispute(db, ADMIN, ESCROW, "refund");
    expect(tx.escrow.updateMany.mock.calls[0][0].data).toMatchObject({ status: "REFUNDED" });
    expect(tx.product.updateMany.mock.calls[0][0].data).toMatchObject({ status: "SELLING" });
  });

  it("DISPUTED가 아니면(예: FUNDED) 409 — 관리자도 분쟁 아닌 거래는 조정 못함", async () => {
    const { db } = fakeDb({ escrow: { findUnique: vi.fn().mockResolvedValue({ status: "FUNDED", productId: PRODUCT, amount: 10000 }) } });
    await expect(resolveDispute(db, ADMIN, ESCROW, "release")).rejects.toMatchObject({ code: "INVALID_TRANSITION", httpStatus: 409 });
  });

  it("잘못된 resolution은 400", async () => {
    const { db } = fakeDb({});
    await expect(resolveDispute(db, ADMIN, ESCROW, "steal" as "release")).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });
});

describe("getEscrow (참여자만·PII 없음)", () => {
  const row = {
    id: ESCROW,
    status: "REQUESTED",
    amount: 10000,
    buyerId: BUYER,
    sellerId: SELLER,
    lastProposerId: BUYER,
    createdAt: new Date("2026-07-24"),
    buyer: { nickname: "구매왕" },
    seller: { nickname: "판매왕" },
    product: { id: PRODUCT, title: "아이폰", status: "SELLING" },
    events: [{ actorId: BUYER, to: "REQUESTED", amount: 10000, note: null, createdAt: new Date("2026-07-24") }],
  };

  it("구매자 관점: myRole=buyer, 상대 닉네임만, myTurn=false(내가 마지막 제안자), id 미노출", async () => {
    const { db } = fakeDb({ escrow: { findUnique: vi.fn().mockResolvedValue(row) } });
    const d = await getEscrow(db, BUYER, ESCROW);
    expect(d.myRole).toBe("buyer");
    expect(d.counterparty).toEqual({ nickname: "판매왕" });
    expect(d.myTurn).toBe(false);
    expect(d.events[0].actor).toBe("me");
    expect(JSON.stringify(d)).not.toContain("buyer-1");
    expect(JSON.stringify(d)).not.toContain("seller-1");
  });

  it("판매자 관점: myTurn=true(상대가 마지막 제안자), 이벤트 actor=other", async () => {
    const { db } = fakeDb({ escrow: { findUnique: vi.fn().mockResolvedValue(row) } });
    const d = await getEscrow(db, SELLER, ESCROW);
    expect(d.myRole).toBe("seller");
    expect(d.counterparty).toEqual({ nickname: "구매왕" });
    expect(d.myTurn).toBe(true);
    expect(d.events[0].actor).toBe("other");
  });

  it("관리자 이벤트는 actor=admin으로 표기(참여자 id 대조 후 비참여자면 admin)", async () => {
    const disputed = { ...row, status: "DISPUTED", events: [{ actorId: ADMIN, to: "RELEASED", amount: 10000, note: "관리자 조정", createdAt: new Date() }] };
    const { db } = fakeDb({ escrow: { findUnique: vi.fn().mockResolvedValue(disputed) } });
    const d = await getEscrow(db, BUYER, ESCROW);
    expect(d.events[0].actor).toBe("admin");
  });

  it("제3자는 403", async () => {
    const { db } = fakeDb({ escrow: { findUnique: vi.fn().mockResolvedValue(row) } });
    await expect(getEscrow(db, THIRD, ESCROW)).rejects.toMatchObject({ code: "FORBIDDEN", httpStatus: 403 });
  });
});

describe("listEscrows / countActiveEscrows", () => {
  it("참여 거래 목록을 상대 닉네임과 함께 반환(PII·id 없음)", async () => {
    const { db } = fakeDb({
      escrow: {
        findMany: vi.fn().mockResolvedValue([
          { id: ESCROW, status: "FUNDED", amount: 10000, buyerId: BUYER, updatedAt: new Date(), buyer: { nickname: "구매왕" }, seller: { nickname: "판매왕" }, product: { id: PRODUCT, title: "아이폰" } },
        ]),
      },
    });
    const list = await listEscrows(db, BUYER);
    expect(list[0]).toMatchObject({ myRole: "buyer", counterparty: { nickname: "판매왕" } });
    expect(JSON.stringify(list)).not.toContain("buyer-1");
  });

  it("countActiveEscrows는 미종착(ACCEPTED/FUNDED/DISPUTED)만 센다", async () => {
    const count = vi.fn().mockResolvedValue(2);
    const { db } = fakeDb({ escrow: { count } });
    const n = await countActiveEscrows(db, BUYER);
    expect(n).toBe(2);
    expect(count.mock.calls[0][0].where.status).toEqual({ in: ["ACCEPTED", "FUNDED", "DISPUTED"] });
  });
});
