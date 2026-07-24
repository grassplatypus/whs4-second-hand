import { AppError } from "@/features/_shared/error";
import { maskProfanity } from "./filter";
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
}

/** repo의 Message(rawText 포함 가능)를 참여자 전달용 모양으로 변환한다 — rawText는 여기서 걸러진다. */
function toDelivered(msg: Message): DeliveredMessage {
  return {
    _id: msg._id,
    conversationId: msg.conversationId,
    senderId: msg.senderId,
    kind: msg.kind,
    text: msg.text,
    imagePath: msg.imagePath,
    masked: msg.masked,
    createdAt: msg.createdAt,
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

  if (!firstText.trim()) {
    throw new AppError("EMPTY_MESSAGE", "메시지를 입력해 주세요.", 400);
  }

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

  const { masked, hit } = maskProfanity(firstText);
  const message = await repo.insertMessage({
    conversationId: conversation._id,
    senderId: buyerId,
    kind: "text",
    text: masked,
    rawText: firstText,
    masked: hit,
    createdAt: now,
  });
  await repo.updateLastMessageAt(conversation._id, now);

  return { conversationId: conversation._id, message: toDelivered(message) };
}

export interface SendMessageInput {
  kind: "text" | "image";
  text?: string;
  imagePath?: string;
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
    const message = await repo.insertMessage({
      conversationId,
      senderId,
      kind: "image",
      imagePath: input.imagePath,
      masked: false,
      createdAt: now,
    });
    await repo.updateLastMessageAt(conversationId, now);
    return toDelivered(message);
  }

  const rawText = input.text ?? "";
  if (!rawText.trim()) {
    throw new AppError("EMPTY_MESSAGE", "메시지를 입력해 주세요.", 400);
  }

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
  return toDelivered(message);
}

/** 목록/상세에 절대 노출하면 안 되는 필드(이메일/전화/정확 위치 등)를 담지 않는 안전한 요약. */
export interface ConversationSummary {
  conversationId: string;
  otherNickname: string;
  productId: string;
  lastMessageAt: Date;
}

/**
 * 내 대화 목록 — 상대방은 닉네임만 노출한다(이메일/전화/식별정보는 select조차 하지 않는다).
 */
export async function listConversations(repo: ChatRepo, db: ChatDb, userId: string): Promise<ConversationSummary[]> {
  const conversations = await repo.listConversations(userId);

  return Promise.all(
    conversations.map(async (conversation) => {
      const otherId = otherParticipant(conversation, userId);
      const other = await db.user.findUnique({ where: { id: otherId }, select: { nickname: true } });
      return {
        conversationId: conversation._id,
        otherNickname: other?.nickname ?? "",
        productId: conversation.productId,
        lastMessageAt: conversation.lastMessageAt,
      };
    }),
  );
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
 * 메시지 신고 — status는 항상 "open". snapshot은 관리자 심사용 증거로 마스킹 전 원문
 * (rawText)을 저장한다(없으면 마스킹된 text로 대체). 대상 메시지가 없으면 404.
 */
export async function reportMessage(
  repo: ChatRepo,
  reporterId: string,
  messageId: string,
  reason: string,
): Promise<void> {
  const message = await repo.getMessage(messageId);
  if (!message) throw messageNotFound();

  await repo.insertReport({
    reporterId,
    targetType: "message",
    targetId: messageId,
    reason,
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
  await repo.insertReport({
    reporterId,
    targetType: "user",
    targetId: targetUserId,
    reason,
    createdAt: new Date(),
    status: "open",
  });
}
