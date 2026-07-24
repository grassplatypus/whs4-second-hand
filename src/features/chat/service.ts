import { AppError } from "@/features/_shared/error";
import { maskProfanity } from "./filter";
import { scanSensitive, type SensitiveSpan } from "./sensitive";
import { getFraudLookup } from "./fraud-lookup";
import type { ChatRepo, Conversation, Message } from "./repo";
import type { ChatDb } from "./db";

function notFound(): AppError {
  return new AppError("NOT_FOUND", "상품을 찾을 수 없어요.", 404);
}

function conversationNotFound(): AppError {
  return new AppError("NOT_FOUND", "대화를 찾을 수 없어요.", 404);
}

function forbidden(): AppError {
  return new AppError("FORBIDDEN", "권한이 없어요.", 403);
}

function blocked(): AppError {
  return new AppError("BLOCKED", "차단된 상대와는 대화할 수 없어요.", 403);
}

function messageNotFound(): AppError {
  return new AppError("NOT_FOUND", "메시지를 찾을 수 없어요.", 404);
}

/** 참여자에게 반환하는 메시지 모양 — rawText(마스킹 전 원문)는 절대 포함하지 않는다. */
export interface DeliveredMessage {
  _id: string;
  conversationId: string;
  senderId: string;
  kind: "text" | "image";
  text?: string;
  imagePath?: string;
  masked: boolean;
  createdAt: Date;
  /** 전화번호·계좌로 보이는 구간 — 화면에서 밑줄로 표시하고 안내 문구를 띄운다. */
  sensitive?: SensitiveSpan[];
}

/** repo의 Message(rawText 포함 가능)를 참여자 전달용 모양으로 변환한다 — rawText는 여기서 걸러진다. */
function toDelivered(msg: Message): DeliveredMessage {
  // 전달되는 텍스트(마스킹본) 기준으로 연락처·계좌 구간을 표시한다 — 화면에서 밑줄·안내에 쓴다.
  const sensitive = msg.text ? scanSensitive(msg.text).spans : [];
  return {
    _id: msg._id,
    conversationId: msg.conversationId,
    senderId: msg.senderId,
    kind: msg.kind,
    text: msg.text,
    imagePath: msg.imagePath,
    masked: msg.masked,
    createdAt: msg.createdAt,
    ...(sensitive.length > 0 ? { sensitive } : {}),
  };
}

/** 두 사용자 사이에 어느 방향으로든 차단이 걸려 있는지 확인한다(항상 양방향 체크). */
async function isEitherBlocked(repo: ChatRepo, userA: string, userB: string): Promise<boolean> {
  const [aBlockedB, bBlockedA] = await Promise.all([repo.isBlocked(userA, userB), repo.isBlocked(userB, userA)]);
  return aBlockedB || bBlockedA;
}

/** conversation의 참여자가 아니면 403. buyer/seller 둘 다 아닌 제3자는 절대 통과하지 못한다. */
function assertParticipant(conversation: Conversation, userId: string): void {
  if (conversation.buyerId !== userId && conversation.sellerId !== userId) throw forbidden();
}

function otherParticipant(conversation: Conversation, userId: string): string {
  return conversation.buyerId === userId ? conversation.sellerId : conversation.buyerId;
}

/**
 * 상품 채팅 시작 — 기존 (productId, buyerId) 대화가 있으면 재사용하고, 없으면 새로 만든다.
 * 첫 메시지는 항상 텍스트이며 마스킹을 거쳐 저장/반환된다(전달되는 텍스트에 원문 욕설이 남지 않는다).
 */
export async function startConversation(
  repo: ChatRepo,
  db: ChatDb,
  buyerId: string,
  productId: string,
  firstText: string,
): Promise<{ conversationId: string; message: DeliveredMessage }> {
  const product = await db.product.findFirst({
    where: { id: productId, deletedAt: null },
    select: { id: true, sellerId: true },
  });
  if (!product) throw notFound();

  if (product.sellerId === buyerId) {
    throw new AppError("SELF_CHAT", "자기 상품에는 채팅할 수 없어요.", 400);
  }

  if (await isEitherBlocked(repo, product.sellerId, buyerId)) throw blocked();

  const firstTextValidated = assertValidText(firstText);

  let conversation = await repo.findConversationByProduct(productId, buyerId);
  const now = new Date();
  if (!conversation) {
    conversation = await repo.createConversation({
      productId,
      sellerId: product.sellerId,
      buyerId,
      createdAt: now,
      lastMessageAt: now,
    });
  }

  const { masked, hit } = maskProfanity(firstTextValidated);
  const message = await repo.insertMessage({
    conversationId: conversation._id,
    senderId: buyerId,
    kind: "text",
    text: masked,
    rawText: firstTextValidated,
    masked: hit,
    createdAt: now,
  });
  await repo.updateLastMessageAt(conversation._id, now);
  // 나갔던 방에 상품 상세에서 다시 말을 건 경우 — 보낸 사람 목록에도 방이 돌아와야 한다.
  await repo.clearLeft(conversation._id, buyerId);
  if (hit) await flagProfanityForAdmin(repo, message);
  // 첫 접촉에서 연락처·계좌를 흘리는 경우가 가장 잦다 — 여기서도 같은 검사를 돌린다.
  const firstScan = scanSensitive(firstTextValidated);
  if (firstScan.spans.length > 0) await flagSensitiveForAdmin(repo, message, firstScan);

  return { conversationId: conversation._id, message: toDelivered(message) };
}

export interface SendMessageInput {
  kind: "text" | "image";
  text?: string;
  imagePath?: string;
}

/** 업로드 파이프라인이 만든 경로 형태만 허용 — 임의 문자열이 저장·서빙되는 걸 구조적으로 막는다. */
const IMAGE_PATH_PATTERN = /^products\/[0-9a-f-]{36}\.webp$/;
/** 메시지 텍스트 상한 — 무제한 저장(자원 남용) 방지. */
const MAX_TEXT_LENGTH = 1000;

function assertValidImagePath(path: string | undefined): asserts path is string {
  if (typeof path !== "string" || path.length > 200 || !IMAGE_PATH_PATTERN.test(path)) {
    throw new AppError("INVALID_IMAGE", "이미지를 다시 올려 주세요.", 400);
  }
}

/** 빈 값·상한 초과를 서버에서 최종 확인한다(클라 검증은 우회될 수 있다). */
function assertValidText(raw: string): string {
  const text = raw.trim();
  if (!text) throw new AppError("EMPTY_MESSAGE", "메시지를 입력해 주세요.", 400);
  if (text.length > MAX_TEXT_LENGTH) {
    throw new AppError("TEXT_TOO_LONG", `메시지는 ${MAX_TEXT_LENGTH}자까지 보낼 수 있어요.`, 400);
  }
  return text;
}

/** 신고 사유(선택한 사유 + 선택적 상세)도 서버에서 길이를 확인한다. */
function assertValidReason(raw: string): string {
  const reason = typeof raw === "string" ? raw.trim() : "";
  if (!reason) throw new AppError("INVALID_INPUT", "신고 사유를 골라 주세요.", 400);
  if (reason.length > 500) throw new AppError("INVALID_INPUT", "신고 사유가 너무 길어요.", 400);
  return reason;
}

/**
 * 전화번호·계좌번호가 오갔는지 살펴, 위험 신호면 관리자에게 조용히 알린다.
 * - 우회 표기(영1영-5O14 같은 필터 회피)는 그 자체가 신호라 바로 통보.
 * - 사기 신고 이력(더치트류 조회)이 있으면 함께 통보.
 * 사용자에게는 알리지 않는다(대화는 그대로 진행되고, 화면 안내는 별도).
 */
async function flagSensitiveForAdmin(
  repo: ChatRepo,
  message: { _id: string; rawText?: string; text?: string },
  scan: { spans: { kind: "phone" | "account"; evasive: boolean; digits: string }[]; hasEvasive: boolean },
): Promise<void> {
  const raw = message.rawText ?? message.text ?? "";
  const reasons: string[] = [];
  if (scan.hasEvasive) reasons.push("자동 감지: 연락처·계좌 우회 표기");

  // 사기 이력 조회(데모 목업) — 감지된 각 번호를 확인한다.
  const lookup = getFraudLookup();
  for (const span of scan.spans) {
    // 감지한 그 번호만 조회한다 — 메시지 전체의 숫자를 이어 붙이면(가격·시간까지) 엉뚱한 값이 된다.
    if (!span.digits) continue;
    const result = await lookup.check(span.kind, span.digits).catch(() => null);
    if (result?.reported) {
      reasons.push(`자동 감지: 사기 신고 이력 ${result.count}건(${span.kind === "phone" ? "전화번호" : "계좌"})`);
      break;
    }
  }

  if (reasons.length === 0) return;
  await repo.upsertAutoReport({
    reporterId: "system",
    targetType: "message",
    targetId: message._id,
    reason: reasons.join(" · "),
    snapshot: raw,
    createdAt: new Date(),
    status: "open",
    auto: true,
  });
}

/**
 * 비속어가 감지되면 관리자에게 조용히 알린다 — 보낸 사람에게는 아무 표시도 하지 않는다.
 * 나중에 같은 메시지를 사용자가 신고하면 messageId로 합쳐져 관리자 화면에 한 건으로 보인다.
 */
async function flagProfanityForAdmin(repo: ChatRepo, message: { _id: string; senderId: string; rawText?: string; text?: string }): Promise<void> {
  await repo.upsertAutoReport({
    reporterId: "system",
    targetType: "message",
    targetId: message._id,
    reason: "자동 감지: 비속어",
    snapshot: message.rawText ?? message.text,
    createdAt: new Date(),
    status: "open",
    auto: true,
  });
}

/**
 * 대화에 메시지 전송 — 참여자만, 차단 관계는 양방향 확인.
 * 이미지는 상대방(발신자가 아닌 다른 참여자)이 이 대화에서 메시지를 한 번이라도 보낸 뒤에만 허용된다
 * (발신자 혼자 여러 번 말해도, 상대가 아직 한 번도 답하지 않았다면 이미지는 계속 막힌다).
 * 텍스트는 항상 마스킹을 거쳐 저장/반환된다.
 */
export async function sendMessage(
  repo: ChatRepo,
  senderId: string,
  conversationId: string,
  input: SendMessageInput,
): Promise<DeliveredMessage> {
  const conversation = await repo.getConversation(conversationId);
  if (!conversation) throw conversationNotFound();

  assertParticipant(conversation, senderId);
  const other = otherParticipant(conversation, senderId);

  if (await isEitherBlocked(repo, senderId, other)) throw blocked();

  const now = new Date();

  if (input.kind === "image") {
    if (!(await repo.hasMessageFrom(conversationId, other))) {
      throw new AppError("IMAGE_BEFORE_REPLY", "상대가 답하기 전에는 사진을 보낼 수 없어요.", 400);
    }
    assertValidImagePath(input.imagePath);
    const message = await repo.insertMessage({
      conversationId,
      senderId,
      kind: "image",
      imagePath: input.imagePath,
      masked: false,
      createdAt: now,
    });
    await repo.updateLastMessageAt(conversationId, now);
    await repo.clearLeft(conversationId, senderId);
    return toDelivered(message);
  }

  const rawText = assertValidText(input.text ?? "");

  const { masked, hit } = maskProfanity(rawText);
  const message = await repo.insertMessage({
    conversationId,
    senderId,
    kind: "text",
    text: masked,
    rawText,
    masked: hit,
    createdAt: now,
  });
  await repo.updateLastMessageAt(conversationId, now);
  // 나갔던 방에 다시 말을 걸었다면 나간 표시를 지운다 — 내 목록에도 다시 보여야 한다.
  await repo.clearLeft(conversationId, senderId);
  // 비속어면 관리자에게만 조용히 기록한다(보낸 사람에겐 알리지 않는다).
  if (hit) await flagProfanityForAdmin(repo, message);
  // 연락처·계좌가 오갔고 위험 신호(우회 표기·사기 이력)가 있으면 역시 조용히 기록한다.
  const scan = scanSensitive(rawText);
  if (scan.spans.length > 0) await flagSensitiveForAdmin(repo, message, scan);
  return toDelivered(message);
}

/** 목록/상세에 절대 노출하면 안 되는 필드(이메일/전화/정확 위치 등)를 담지 않는 안전한 요약. */
export interface ConversationSummary {
  conversationId: string;
  otherNickname: string;
  otherAvatarPath: string | null;
  product: { id: string; title: string };
  lastMessageAt: Date;
  /** 내가 마지막으로 본 뒤 상대가 보낸 메시지 수 — 목록의 안 읽은 뱃지에 쓴다. */
  unreadCount: number;
}

/**
 * 내 대화 목록 — 상대방은 닉네임만 노출한다(이메일/전화/식별정보는 select조차 하지 않는다).
 * 목록의 대표 텍스트는 상품명이므로 상품 title도 함께 조회한다(삭제된 상품이면 빈 문자열 — 화면이 폴백 문구를 보여준다).
 */
export async function listConversations(repo: ChatRepo, db: ChatDb, userId: string): Promise<ConversationSummary[]> {
  const conversations = await repo.listConversations(userId);

  // 내가 나간 방은 숨긴다 — 단, 나간 뒤 상대가 새로 보냈으면 다시 보여준다.
  // (나간 직후 같은 밀리초에 메시지가 올 수 있어 시각 비교 대신 "그 뒤 상대 메시지 수"로 판정한다.)
  const visible: Conversation[] = [];
  for (const c of conversations) {
    const leftAt = c.buyerId === userId ? c.buyerLeftAt : c.sellerLeftAt;
    if (!leftAt) {
      visible.push(c);
      continue;
    }
    const since = new Date(leftAt.getTime() - 1); // 같은 ms에 도착한 메시지도 "나간 뒤"로 본다
    if ((await repo.countUnread(c._id, userId, since)) > 0) visible.push(c);
  }

  return Promise.all(
    visible.map(async (conversation) => {
      const otherId = otherParticipant(conversation, userId);
      const readAt = conversation.buyerId === userId ? conversation.buyerReadAt : conversation.sellerReadAt;
      const [other, product, unread] = await Promise.all([
        db.user.findUnique({ where: { id: otherId }, select: { nickname: true, avatarPath: true } }),
        db.product.findFirst({ where: { id: conversation.productId }, select: { title: true } }),
        repo.countUnread(conversation._id, userId, readAt),
      ]);
      return {
        conversationId: conversation._id,
        otherNickname: other?.nickname ?? "",
        otherAvatarPath: other?.avatarPath ?? null,
        product: { id: conversation.productId, title: product?.title ?? "" },
        lastMessageAt: conversation.lastMessageAt,
        unreadCount: unread,
      };
    }),
  );
}

/**
 * 방 나가기 — 내 목록에서만 사라진다. 상대는 그대로 보이고, 상대가 새 메시지를 보내면
 * 내 목록에도 다시 나타난다. 둘 다 나가고 새 메시지도 없으면 휴면 방이 되어
 * 관리자가 지울 수 있게 된다.
 */
export async function leaveConversation(repo: ChatRepo, userId: string, conversationId: string): Promise<void> {
  const conversation = await repo.getConversation(conversationId);
  if (!conversation) throw conversationNotFound();
  assertParticipant(conversation, userId);
  await repo.markLeft(conversationId, userId, new Date());
}

/** 방을 열어봤다고 표시한다 — 안 읽은 수가 0이 되고, 상대에게 읽음으로 보인다. */
export async function markConversationRead(repo: ChatRepo, userId: string, conversationId: string): Promise<void> {
  const conversation = await repo.getConversation(conversationId);
  if (!conversation) throw conversationNotFound();
  assertParticipant(conversation, userId);
  await repo.markRead(conversationId, userId, new Date());
}

export interface DormantConversation {
  conversationId: string;
  productId: string;
  lastMessageAt: Date;
}

/** 휴면 방 목록(관리자용) — 양쪽 모두 나갔고 그 뒤 새 메시지가 없는 방. */
export async function listDormantConversations(repo: ChatRepo): Promise<DormantConversation[]> {
  const rows = await repo.listDormantConversations();
  return rows.map((c) => ({
    conversationId: c._id,
    productId: c.productId,
    lastMessageAt: c.lastMessageAt,
  }));
}

/**
 * 상대가 알려준 번호의 사기 신고 이력을 확인한다(데모: 흉내 조회).
 * 아무 번호나 조회하는 창구가 되지 않게, 그 대화에서 실제로 오간 번호만 확인해 준다.
 */
export async function checkConversationNumber(
  repo: ChatRepo,
  userId: string,
  conversationId: string,
  value: string,
): Promise<{ reported: boolean; count: number }> {
  const conversation = await repo.getConversation(conversationId);
  if (!conversation) throw conversationNotFound();
  assertParticipant(conversation, userId);

  const digits = value.replace(/\D/g, "");
  if (digits.length < 8) {
    throw new AppError("INVALID_INPUT", "번호를 다시 확인해 주세요.", 400);
  }

  /**
   * 대화 전체를 오래된 쪽으로 훑으며, **상대가 보낸** 메시지에서 그 번호를 찾는다.
   *
   * - 내가 보낸 메시지는 제외한다. 그러지 않으면 아무 번호나 스스로 적어 놓고 조회하는 창구가 된다.
   * - 최근 몇 건만 보면 옛 메시지의 번호는 화면에 버튼이 떠 있어도 늘 실패한다 — 끝까지 훑는다.
   */
  let matched: { kind: "phone" | "account" } | undefined;
  let cursor: Date | undefined;
  // 커서는 시각 기준이라, 같은 밀리초에 저장된 메시지가 쪽 경계에 걸리면 건너뛸 수 있다.
  // 이미 본 id를 기억해 두고, 새로 나온 게 하나도 없을 때만 멈춘다.
  const seen = new Set<string>();
  // 한 번의 확인이 대화 전체를 무한정 훑지 않도록 상한을 둔다(아주 긴 대화에서도 응답이 늦지 않게).
  const MAX_PAGES = 25; // 200건 × 25 = 최근 5000건
  scan: for (let page_i = 0; page_i < MAX_PAGES; page_i++) {
    const page = await repo.listMessages(conversationId, { limit: 200, cursor });
    let fresh = 0;
    for (const m of page) {
      if (seen.has(m._id)) continue;
      seen.add(m._id);
      fresh += 1;
      if (!m.text || m.senderId === userId) continue;
      const span = scanSensitive(m.text).spans.find((s) => s.digits === digits);
      if (span) {
        matched = { kind: span.kind };
        break scan;
      }
    }
    if (fresh === 0 || page.length === 0) break;
    // 같은 밀리초를 다시 포함하도록 1ms 뒤로 물려 잡는다(위의 seen이 중복을 걸러낸다).
    const oldest = page[page.length - 1].createdAt;
    cursor = new Date(oldest.getTime() + 1);
  }
  if (!matched) {
    throw new AppError("NOT_IN_CONVERSATION", "상대가 이 대화에서 알려준 번호만 확인할 수 있어요.", 400);
  }

  const result = await getFraudLookup().check(matched.kind, digits);
  return { reported: result.reported, count: result.count };
}

/** 휴면 방 삭제(관리자용) — 휴면이 아닌 방은 지우지 않는다. */
export async function deleteDormantConversations(repo: ChatRepo, ids: string[]): Promise<number> {
  const dormant = new Set((await repo.listDormantConversations()).map((c) => c._id));
  const deletable = ids.filter((id) => dormant.has(id));
  if (deletable.length === 0) return 0;
  return repo.deleteConversations(deletable);
}

/** 대화 메시지 목록 — 참여자가 아니면 403(제3자 격리). 저장된 마스킹 텍스트를 그대로 반환한다. */
export async function listMessages(
  repo: ChatRepo,
  userId: string,
  conversationId: string,
  cursor?: Date,
): Promise<DeliveredMessage[]> {
  const conversation = await repo.getConversation(conversationId);
  if (!conversation) throw conversationNotFound();

  assertParticipant(conversation, userId);

  const messages = await repo.listMessages(conversationId, cursor ? { cursor } : undefined);
  return messages.map(toDelivered);
}

export async function blockUser(repo: ChatRepo, userId: string, targetId: string): Promise<void> {
  await repo.block(userId, targetId);
}

export async function unblockUser(repo: ChatRepo, userId: string, targetId: string): Promise<void> {
  await repo.unblock(userId, targetId);
}

/**
 * 대화 상대를 차단/신고할 때 클라이언트가 상대의 원본 userId를 알 필요가 없도록,
 * conversationId만 받아 서버에서 상대를 계산한다(참여자가 아니면 403 — 제3자가 임의 차단 불가).
 */
export async function blockConversationCounterparty(
  repo: ChatRepo,
  userId: string,
  conversationId: string,
): Promise<void> {
  const conversation = await repo.getConversation(conversationId);
  if (!conversation) throw conversationNotFound();
  assertParticipant(conversation, userId);
  await repo.block(userId, otherParticipant(conversation, userId));
}

export async function unblockConversationCounterparty(
  repo: ChatRepo,
  userId: string,
  conversationId: string,
): Promise<void> {
  const conversation = await repo.getConversation(conversationId);
  if (!conversation) throw conversationNotFound();
  assertParticipant(conversation, userId);
  await repo.unblock(userId, otherParticipant(conversation, userId));
}

/**
 * 메시지 신고 — status는 항상 "open". snapshot은 관리자 심사용 증거로 마스킹 전 원문
 * (rawText)을 저장한다(없으면 마스킹된 text로 대체). 대상 메시지가 없으면 404.
 */
export async function reportMessage(
  repo: ChatRepo,
  reporterId: string,
  messageId: string,
  reason: string,
): Promise<void> {
  const cleanReason = assertValidReason(reason);
  const message = await repo.getMessage(messageId);
  if (!message) throw messageNotFound();

  // 신고자는 그 메시지가 오간 대화의 참여자여야 한다 — 아무 메시지나 id로 신고하는 걸 막는다.
  const conversation = await repo.getConversation(message.conversationId);
  if (!conversation) throw messageNotFound();
  assertParticipant(conversation, reporterId);

  // 자동 감지(비속어)로 이미 올라온 건이 있으면 합쳐서 관리자 화면에 한 건으로 보이게 한다.
  await repo.mergeUserReport({
    reporterId,
    targetType: "message",
    targetId: messageId,
    reason: cleanReason,
    snapshot: message.rawText ?? message.text,
    createdAt: new Date(),
    status: "open",
  });
}

export async function reportUser(
  repo: ChatRepo,
  reporterId: string,
  targetUserId: string,
  reason: string,
): Promise<void> {
  const cleanReason = assertValidReason(reason);
  await repo.mergeUserReport({
    reporterId,
    targetType: "user",
    targetId: targetUserId,
    reason: cleanReason,
    createdAt: new Date(),
    status: "open",
  });
}

/** 신고 화면도 conversationId만 받아 상대를 서버에서 계산한다(reportUser와 동일한 이유). */
export async function reportConversationCounterparty(
  repo: ChatRepo,
  reporterId: string,
  conversationId: string,
  reason: string,
): Promise<void> {
  const conversation = await repo.getConversation(conversationId);
  if (!conversation) throw conversationNotFound();
  assertParticipant(conversation, reporterId);
  await reportUser(repo, reporterId, otherParticipant(conversation, reporterId), reason);
}
