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
  if (e.status !== "REQUESTED") throw new AppError("INVALID_TRANSITION", "지금은 금액을 바꿀 수 없어요.", 409);
  if (e.lastProposerId === actorId) throw new AppError("NOT_YOUR_TURN", "상대의 답을 기다리는 중이에요.", 400);
  await db.escrow.update({
    where: { id },
    data: {
      amount,
      lastProposerId: actorId,
      events: { create: { actorId, from: "REQUESTED", to: "REQUESTED", amount } },
    },
  });
}

/** 제안 수락(조정 완료). 마지막 제안자 본인은 자기 제안을 수락할 수 없다(상대만 수락). */
export async function acceptEscrow(db: EscrowDb, actorId: string, id: string): Promise<void> {
  const e = await loadParticipant(db, id, actorId);
  assertTransition(e.status, "ACCEPTED");
  if (e.lastProposerId === actorId) throw new AppError("CANNOT_ACCEPT_OWN", "내 제안은 상대가 수락해요.", 400);
  await db.escrow.update({
    where: { id },
    data: {
      status: "ACCEPTED",
      events: { create: { actorId, from: e.status, to: "ACCEPTED", amount: e.amount } },
    },
  });
}

/** 입금 전 파기. 참여자 누구나 REQUESTED/ACCEPTED 단계에서 취소할 수 있다(FUNDED 이후는 반환/분쟁으로). */
export async function cancelEscrow(db: EscrowDb, actorId: string, id: string): Promise<void> {
  const e = await loadParticipant(db, id, actorId);
  assertTransition(e.status, "CANCELLED"); // FUNDED/DISPUTED/종착에서는 409
  await db.escrow.update({
    where: { id },
    data: {
      status: "CANCELLED",
      events: { create: { actorId, from: e.status, to: "CANCELLED" } },
    },
  });
}

/**
 * 대금 보관(구매자만). 합의된 금액을 에스크로가 보관한다(데모: 목 보관 — 실 이체 아님).
 * 상품 상태(SELLING→RESERVED)와 에스크로 상태를 한 트랜잭션으로 갱신한다.
 * 트랜잭션 안에서 상품이 여전히 SELLING인지 재확인 → 같은 상품 이중 보관을 막는다(409).
 */
export async function fundEscrow(db: EscrowDb, buyerId: string, id: string): Promise<void> {
  const e = await loadParticipant(db, id, buyerId);
  if (e.buyerId !== buyerId) throw forbidden(); // 판매자는 입금할 수 없다
  assertTransition(e.status, "FUNDED");
  await db.$transaction(async (tx) => {
    const product = await tx.product.findUnique({
      where: { id: e.productId },
      select: { status: true, deletedAt: true },
    });
    if (!product || product.deletedAt) throw notFound();
    if (product.status !== "SELLING")
      throw new AppError("PRODUCT_UNAVAILABLE", "이미 다른 거래가 진행 중이에요.", 409);
    await tx.product.update({ where: { id: e.productId }, data: { status: "RESERVED" } });
    await tx.escrow.update({ where: { id }, data: { status: "FUNDED", fundedAt: new Date() } });
    await tx.escrowEvent.create({ data: { escrowId: id, actorId: buyerId, from: e.status, to: "FUNDED", amount: e.amount } });
  });
}

/**
 * 수령 확인 → 판매자 정산(구매자만). 구매자가 물건을 받았다고 확인하면 보관 대금을 판매자에게 정산한다.
 * 상품 RESERVED→SOLD와 에스크로 FUNDED→RELEASED를 한 트랜잭션으로.
 */
export async function confirmReceipt(db: EscrowDb, buyerId: string, id: string): Promise<void> {
  const e = await loadParticipant(db, id, buyerId);
  if (e.buyerId !== buyerId) throw forbidden(); // 수령확인은 구매자만
  assertTransition(e.status, "RELEASED");
  await db.$transaction(async (tx) => {
    await tx.product.update({ where: { id: e.productId }, data: { status: "SOLD" } });
    await tx.escrow.update({ where: { id }, data: { status: "RELEASED", releasedAt: new Date() } });
    await tx.escrowEvent.create({ data: { escrowId: id, actorId: buyerId, from: e.status, to: "RELEASED", amount: e.amount } });
  });
}

/**
 * 대금 반환(판매자만). 판매자가 거래를 무르면 보관 대금을 구매자에게 반환하고 상품을 다시 판매중으로.
 * 상품 RESERVED→SELLING과 에스크로 FUNDED→REFUNDED를 한 트랜잭션으로.
 */
export async function refundEscrow(db: EscrowDb, sellerId: string, id: string): Promise<void> {
  const e = await loadParticipant(db, id, sellerId);
  if (e.sellerId !== sellerId) throw forbidden(); // 반환은 판매자만
  assertTransition(e.status, "REFUNDED");
  await db.$transaction(async (tx) => {
    await tx.product.update({ where: { id: e.productId }, data: { status: "SELLING" } });
    await tx.escrow.update({ where: { id }, data: { status: "REFUNDED", refundedAt: new Date() } });
    await tx.escrowEvent.create({ data: { escrowId: id, actorId: sellerId, from: e.status, to: "REFUNDED", amount: e.amount } });
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
  assertTransition(e.status, "DISPUTED");
  const trimmed = typeof note === "string" ? note.trim().slice(0, 500) : null;
  await db.escrow.update({
    where: { id },
    data: {
      status: "DISPUTED",
      events: { create: { actorId, from: e.status, to: "DISPUTED", note: trimmed || null } },
    },
  });
}

/**
 * 분쟁 조정(관리자만 — 라우트에서 requireAdmin으로 게이트). release면 판매자 정산, refund면 구매자 반환.
 * 상품 상태도 결정에 맞춰(release→SOLD, refund→SELLING) 한 트랜잭션으로 갱신한다.
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
  // 조정은 분쟁 상태에서만 — FUNDED→RELEASED는 assertTransition상 유효하므로,
  // 여기서 DISPUTED를 명시적으로 요구하지 않으면 관리자가 분쟁이 아닌 보관 거래를
  // 구매자 수령확인 없이 정산해버릴 수 있다.
  if (e.status !== "DISPUTED") throw new AppError("INVALID_TRANSITION", "분쟁 상태의 거래만 조정할 수 있어요.", 409);
  const next: EscrowStatus = resolution === "release" ? "RELEASED" : "REFUNDED";
  assertTransition(e.status, next);
  const productStatus = resolution === "release" ? "SOLD" : "SELLING";
  const stamp = resolution === "release" ? { releasedAt: new Date() } : { refundedAt: new Date() };
  await db.$transaction(async (tx) => {
    await tx.product.update({ where: { id: e.productId }, data: { status: productStatus } });
    await tx.escrow.update({ where: { id }, data: { status: next, ...stamp } });
    await tx.escrowEvent.create({ data: { escrowId: id, actorId: adminId, from: e.status, to: next, amount: e.amount, note: "관리자 조정" } });
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
