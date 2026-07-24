import type { EscrowStatus } from "@prisma/client";
import { AppError } from "@/features/_shared/error";
import { assertTransition } from "./status";
import type { EscrowDb } from "./db";

const AMOUNT_MAX = 1_000_000_000; // 10억원 — sanity 상한(오버플로우·오타 방지)

function forbidden(): AppError {
  return new AppError("FORBIDDEN", "권한이 없어요.", 403);
}
function notFound(): AppError {
  return new AppError("NOT_FOUND", "거래를 찾을 수 없어요.", 404);
}

/** 제안 금액 무결성 — 양의 정수·상한. 위반 시 400. */
function assertAmount(amount: unknown): asserts amount is number {
  if (typeof amount !== "number" || !Number.isInteger(amount) || amount <= 0 || amount > AMOUNT_MAX) {
    throw new AppError("INVALID_AMOUNT", "금액이 올바르지 않아요.", 400);
  }
}

/** 조회·행동의 공통 관문: 참여자(buyer/seller)만. 아니면 없으면 404, 제3자면 403. */
interface EscrowCore {
  id: string;
  status: EscrowStatus;
  buyerId: string;
  sellerId: string;
  productId: string;
  amount: number;
  lastProposerId: string;
}
async function loadParticipant(db: EscrowDb, id: string, userId: string): Promise<EscrowCore> {
  const e = await db.escrow.findUnique({
    where: { id },
    select: {
      id: true,
      status: true,
      buyerId: true,
      sellerId: true,
      productId: true,
      amount: true,
      lastProposerId: true,
    },
  });
  if (!e) throw notFound();
  if (e.buyerId !== userId && e.sellerId !== userId) throw forbidden();
  return e;
}

/**
 * 안전거래 요청(구매자). 판매자 본인 상품이면 자기거래 금지, 상품이 판매중이 아니면 요청 불가.
 * 판매자 id는 요청 시점 스냅샷(이후 상품 소유자가 바뀌어도 이 거래의 상대는 고정).
 */
export async function requestEscrow(
  db: EscrowDb,
  buyerId: string,
  productId: string,
  amount: unknown,
): Promise<{ id: string }> {
  assertAmount(amount);
  const product = await db.product.findFirst({
    where: { id: productId, deletedAt: null },
    select: { sellerId: true, status: true },
  });
  if (!product) throw notFound();
  if (product.sellerId === buyerId) throw new AppError("SELF_TRADE", "내 상품은 거래 요청할 수 없어요.", 400);
  if (product.status !== "SELLING") throw new AppError("PRODUCT_UNAVAILABLE", "지금은 거래할 수 없는 상품이에요.", 409);

  const created = await db.escrow.create({
    data: {
      productId,
      buyerId,
      sellerId: product.sellerId,
      amount,
      status: "REQUESTED",
      lastProposerId: buyerId,
      events: { create: { actorId: buyerId, from: null, to: "REQUESTED", amount } },
    },
    select: { id: true },
  });
  return { id: created.id };
}

/** 금액 재제안(조정). 참여자 중 "내 차례"(마지막 제안자가 상대일 때)만 가능. 상태는 REQUESTED 유지. */
export async function counterEscrow(
  db: EscrowDb,
  actorId: string,
  id: string,
  amount: unknown,
): Promise<void> {
  assertAmount(amount);
  const e = await loadParticipant(db, id, actorId);
  // 빠른 실패(좋은 에러 메시지)용 선검사. 실제 원자성은 아래 updateMany의 status·turn 조건이 강제한다.
  if (e.status !== "REQUESTED") throw new AppError("INVALID_TRANSITION", "지금은 금액을 바꿀 수 없어요.", 409);
  if (e.lastProposerId === actorId) throw new AppError("NOT_YOUR_TURN", "상대의 답을 기다리는 중이에요.", 400);
  await db.$transaction(async (tx) => {
    const n = await tx.escrow.updateMany({
      where: { id, status: "REQUESTED", lastProposerId: { not: actorId } },
      data: { amount, lastProposerId: actorId },
    });
    if (n.count !== 1) throw new AppError("NOT_YOUR_TURN", "상대의 답을 기다리는 중이에요.", 400);
    await tx.escrowEvent.create({ data: { escrowId: id, actorId, from: "REQUESTED", to: "REQUESTED", amount } });
  });
}

/** 제안 수락(조정 완료). 마지막 제안자 본인은 자기 제안을 수락할 수 없다(상대만 수락). */
export async function acceptEscrow(db: EscrowDb, actorId: string, id: string): Promise<void> {
  const e = await loadParticipant(db, id, actorId);
  assertTransition(e.status, "ACCEPTED");
  if (e.lastProposerId === actorId) throw new AppError("CANNOT_ACCEPT_OWN", "내 제안은 상대가 수락해요.", 400);
  await db.$transaction(async (tx) => {
    // 조건부 쓰기: REQUESTED이고 내가 마지막 제안자가 아닐 때만. 동시 counter/accept 경합을 원자적으로 차단.
    const n = await tx.escrow.updateMany({
      where: { id, status: "REQUESTED", lastProposerId: { not: actorId } },
      data: { status: "ACCEPTED" },
    });
    if (n.count !== 1) throw new AppError("INVALID_TRANSITION", "지금은 수락할 수 없어요.", 409);
    await tx.escrowEvent.create({ data: { escrowId: id, actorId, from: "REQUESTED", to: "ACCEPTED", amount: e.amount } });
  });
}

/** 입금 전 파기. 참여자 누구나 REQUESTED/ACCEPTED 단계에서 취소할 수 있다(FUNDED 이후는 반환/분쟁으로). */
export async function cancelEscrow(db: EscrowDb, actorId: string, id: string): Promise<void> {
  const e = await loadParticipant(db, id, actorId);
  assertTransition(e.status, "CANCELLED"); // FUNDED/DISPUTED/종착에서는 409
  await db.$transaction(async (tx) => {
    const n = await tx.escrow.updateMany({
      where: { id, status: { in: ["REQUESTED", "ACCEPTED"] } },
      data: { status: "CANCELLED" },
    });
    if (n.count !== 1) throw new AppError("INVALID_TRANSITION", "지금은 취소할 수 없어요.", 409);
    await tx.escrowEvent.create({ data: { escrowId: id, actorId, from: e.status, to: "CANCELLED" } });
  });
}

/**
 * 대금 보관(구매자만). 합의된 금액을 에스크로가 보관한다(데모: 목 보관 — 실 이체 아님).
 * 상품 상태(SELLING→RESERVED)와 에스크로 상태를 한 트랜잭션으로 갱신한다.
 *
 * 이중 보관 방지(중점): 상품 상태를 "SELLING일 때만" 조건부(updateMany)로 RESERVED로 바꾸고
 * 실제 갱신 행 수(count)를 확인한다. 비잠금 SELECT 후 무조건 UPDATE였다면 두 구매자가 동시에
 * 같은 상품을 입금할 수 있으나(READ COMMITTED), 조건부 쓰기는 둘 중 하나만 성공(count=1)한다.
 */
export async function fundEscrow(db: EscrowDb, buyerId: string, id: string): Promise<void> {
  const e = await loadParticipant(db, id, buyerId);
  if (e.buyerId !== buyerId) throw forbidden(); // 판매자는 입금할 수 없다
  assertTransition(e.status, "FUNDED");
  await db.$transaction(async (tx) => {
    const p = await tx.product.updateMany({
      where: { id: e.productId, status: "SELLING", deletedAt: null },
      data: { status: "RESERVED" },
    });
    if (p.count !== 1) throw new AppError("PRODUCT_UNAVAILABLE", "이미 다른 거래가 진행 중이에요.", 409);
    const n = await tx.escrow.updateMany({
      where: { id, status: "ACCEPTED" },
      data: { status: "FUNDED", fundedAt: new Date() },
    });
    if (n.count !== 1) throw new AppError("INVALID_TRANSITION", "지금은 입금할 수 없어요.", 409); // 상품 RESERVED도 롤백
    await tx.escrowEvent.create({ data: { escrowId: id, actorId: buyerId, from: "ACCEPTED", to: "FUNDED", amount: e.amount } });
  });
}

/**
 * 수령 확인 → 판매자 정산(구매자만). 구매자가 물건을 받았다고 확인하면 보관 대금을 판매자에게 정산한다.
 * 상품 RESERVED→SOLD와 에스크로 FUNDED→RELEASED를 한 트랜잭션으로.
 *
 * 이중 정산·정산/반환 경합 방지(중점): FUNDED일 때만 조건부로 RELEASED로 바꾸고 count를 확인한다.
 * 동시 confirm+refund가 각각 사전읽기에서 FUNDED를 보더라도, 에스크로 조건부 쓰기는 하나만 성공한다.
 * (DISPUTED에서 참여자가 정산하지 못하도록 소스 상태도 명시적으로 FUNDED로 제한 — 조정은 관리자만.)
 */
export async function confirmReceipt(db: EscrowDb, buyerId: string, id: string): Promise<void> {
  const e = await loadParticipant(db, id, buyerId);
  if (e.buyerId !== buyerId) throw forbidden(); // 수령확인은 구매자만
  if (e.status !== "FUNDED") throw new AppError("INVALID_TRANSITION", "지금은 수령확인할 수 없어요.", 409);
  await db.$transaction(async (tx) => {
    const n = await tx.escrow.updateMany({
      where: { id, status: "FUNDED" },
      data: { status: "RELEASED", releasedAt: new Date() },
    });
    if (n.count !== 1) throw new AppError("INVALID_TRANSITION", "지금은 수령확인할 수 없어요.", 409);
    await tx.product.updateMany({ where: { id: e.productId }, data: { status: "SOLD" } });
    await tx.escrowEvent.create({ data: { escrowId: id, actorId: buyerId, from: "FUNDED", to: "RELEASED", amount: e.amount } });
  });
}

/**
 * 대금 반환(판매자만). 판매자가 거래를 무르면 보관 대금을 구매자에게 반환하고 상품을 다시 판매중으로.
 * 상품 RESERVED→SELLING과 에스크로 FUNDED→REFUNDED를 한 트랜잭션으로.
 * (confirm과 동일하게 소스 FUNDED 조건부 쓰기 — 이중 반환·정산 경합 차단, DISPUTED 우회 차단.)
 */
export async function refundEscrow(db: EscrowDb, sellerId: string, id: string): Promise<void> {
  const e = await loadParticipant(db, id, sellerId);
  if (e.sellerId !== sellerId) throw forbidden(); // 반환은 판매자만
  if (e.status !== "FUNDED") throw new AppError("INVALID_TRANSITION", "지금은 반환할 수 없어요.", 409);
  await db.$transaction(async (tx) => {
    const n = await tx.escrow.updateMany({
      where: { id, status: "FUNDED" },
      data: { status: "REFUNDED", refundedAt: new Date() },
    });
    if (n.count !== 1) throw new AppError("INVALID_TRANSITION", "지금은 반환할 수 없어요.", 409);
    await tx.product.updateMany({ where: { id: e.productId }, data: { status: "SELLING" } });
    await tx.escrowEvent.create({ data: { escrowId: id, actorId: sellerId, from: "FUNDED", to: "REFUNDED", amount: e.amount } });
  });
}

/** 분쟁 접수(참여자). 보관 상태에서 이견이 있으면 관리자 조정 대기 상태로 넘긴다. 처리 UI는 #6. */
export async function disputeEscrow(
  db: EscrowDb,
  actorId: string,
  id: string,
  note?: string,
): Promise<void> {
  const e = await loadParticipant(db, id, actorId);
  assertTransition(e.status, "DISPUTED"); // FUNDED에서만
  const trimmed = typeof note === "string" ? note.trim().slice(0, 500) : null;
  await db.$transaction(async (tx) => {
    const n = await tx.escrow.updateMany({
      where: { id, status: "FUNDED" },
      data: { status: "DISPUTED" },
    });
    if (n.count !== 1) throw new AppError("INVALID_TRANSITION", "지금은 분쟁을 열 수 없어요.", 409);
    await tx.escrowEvent.create({ data: { escrowId: id, actorId, from: "FUNDED", to: "DISPUTED", note: trimmed || null } });
  });
}

/**
 * 분쟁 조정(관리자만 — 라우트에서 requireAdmin으로 게이트). release면 판매자 정산, refund면 구매자 반환.
 * 상품 상태도 결정에 맞춰(release→SOLD, refund→SELLING) 한 트랜잭션으로 갱신한다.
 *
 * 소스 상태를 DISPUTED로 명시 제한한다 — FUNDED→RELEASED는 assertTransition상 유효하므로,
 * 명시하지 않으면 관리자가 분쟁이 아닌 보관 거래를 구매자 수령확인 없이 정산해버릴 수 있다.
 * 조건부 쓰기(count)로 이중 조정도 막는다.
 */
export async function resolveDispute(
  db: EscrowDb,
  adminId: string,
  id: string,
  resolution: "release" | "refund",
): Promise<void> {
  if (resolution !== "release" && resolution !== "refund") {
    throw new AppError("INVALID_INPUT", "조정 결과가 올바르지 않아요.", 400);
  }
  const e = await db.escrow.findUnique({
    where: { id },
    select: { status: true, productId: true, amount: true },
  });
  if (!e) throw notFound();
  if (e.status !== "DISPUTED") throw new AppError("INVALID_TRANSITION", "분쟁 상태의 거래만 조정할 수 있어요.", 409);
  const next: EscrowStatus = resolution === "release" ? "RELEASED" : "REFUNDED";
  const productStatus = resolution === "release" ? "SOLD" : "SELLING";
  const stamp = resolution === "release" ? { releasedAt: new Date() } : { refundedAt: new Date() };
  await db.$transaction(async (tx) => {
    const n = await tx.escrow.updateMany({ where: { id, status: "DISPUTED" }, data: { status: next, ...stamp } });
    if (n.count !== 1) throw new AppError("INVALID_TRANSITION", "지금은 조정할 수 없어요.", 409);
    await tx.product.updateMany({ where: { id: e.productId }, data: { status: productStatus } });
    await tx.escrowEvent.create({ data: { escrowId: id, actorId: adminId, from: "DISPUTED", to: next, amount: e.amount, note: "관리자 조정" } });
  });
}

// ── 조회(참여자만·PII 없음) ──────────────────────────────────────────

export interface EscrowEventView {
  status: EscrowStatus;
  amount: number | null;
  note: string | null;
  at: Date;
  actor: "me" | "other" | "admin";
}
export interface EscrowDetail {
  id: string;
  status: EscrowStatus;
  amount: number;
  myRole: "buyer" | "seller";
  /** 조정 단계에서 지금 내가 수락/재제안할 차례인가(마지막 제안자가 상대인가). */
  myTurn: boolean;
  counterparty: { nickname: string };
  product: { id: string; title: string; status: string };
  events: EscrowEventView[];
  createdAt: Date;
}

/** 상세 조회. 참여자만. 상대는 닉네임만 — 이메일/전화/정확좌표·상대 userId 원본은 노출하지 않는다. */
export async function getEscrow(db: EscrowDb, userId: string, id: string): Promise<EscrowDetail> {
  const e = await db.escrow.findUnique({
    where: { id },
    select: {
      id: true,
      status: true,
      amount: true,
      buyerId: true,
      sellerId: true,
      lastProposerId: true,
      createdAt: true,
      buyer: { select: { nickname: true } },
      seller: { select: { nickname: true } },
      product: { select: { id: true, title: true, status: true } },
      events: {
        select: { actorId: true, to: true, amount: true, note: true, createdAt: true },
        orderBy: { createdAt: "asc" },
      },
    },
  });
  if (!e) throw notFound();
  if (e.buyerId !== userId && e.sellerId !== userId) throw forbidden();

  const myRole: "buyer" | "seller" = e.buyerId === userId ? "buyer" : "seller";
  const counterId = myRole === "buyer" ? e.sellerId : e.buyerId;
  const actorOf = (actorId: string): "me" | "other" | "admin" =>
    actorId === userId ? "me" : actorId === counterId ? "other" : "admin";

  return {
    id: e.id,
    status: e.status,
    amount: e.amount,
    myRole,
    myTurn: e.status === "REQUESTED" && e.lastProposerId !== userId,
    counterparty: { nickname: (myRole === "buyer" ? e.seller : e.buyer).nickname },
    product: { id: e.product.id, title: e.product.title, status: e.product.status },
    events: e.events.map((ev) => ({
      status: ev.to,
      amount: ev.amount,
      note: ev.note,
      at: ev.createdAt,
      actor: actorOf(ev.actorId),
    })),
    createdAt: e.createdAt,
  };
}

export interface EscrowListItem {
  id: string;
  status: EscrowStatus;
  amount: number;
  myRole: "buyer" | "seller";
  counterparty: { nickname: string };
  product: { id: string; title: string };
  updatedAt: Date;
}

/** 내가 참여(구매자 또는 판매자)한 거래 목록. PII 없음. */
export async function listEscrows(db: EscrowDb, userId: string): Promise<EscrowListItem[]> {
  const rows = await db.escrow.findMany({
    where: { OR: [{ buyerId: userId }, { sellerId: userId }] },
    select: {
      id: true,
      status: true,
      amount: true,
      buyerId: true,
      updatedAt: true,
      buyer: { select: { nickname: true } },
      seller: { select: { nickname: true } },
      product: { select: { id: true, title: true } },
    },
    orderBy: { updatedAt: "desc" },
  });
  return rows.map((r) => {
    const myRole: "buyer" | "seller" = r.buyerId === userId ? "buyer" : "seller";
    return {
      id: r.id,
      status: r.status,
      amount: r.amount,
      myRole,
      counterparty: { nickname: (myRole === "buyer" ? r.seller : r.buyer).nickname },
      product: { id: r.product.id, title: r.product.title },
      updatedAt: r.updatedAt,
    };
  });
}

/** #7 탈퇴 가드용: 참여 중 미종착(진행 중) 거래 수 — 대금이 걸려 있어 탈퇴를 막아야 하는 상태. */
export async function countActiveEscrows(db: EscrowDb, userId: string): Promise<number> {
  return db.escrow.count({
    where: {
      OR: [{ buyerId: userId }, { sellerId: userId }],
      status: { in: ["ACCEPTED", "FUNDED", "DISPUTED"] },
    },
  });
}
