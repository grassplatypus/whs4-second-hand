import { randomUUID } from "node:crypto";
import type { Filter, Sort } from "mongodb";
import { COLLECTIONS, getChatDb } from "./mongo";

export interface Conversation {
  _id: string;
  productId: string;
  sellerId: string;
  buyerId: string;
  createdAt: Date;
  lastMessageAt: Date;
}

export interface Message {
  _id: string;
  conversationId: string;
  senderId: string;
  kind: "text" | "image";
  text?: string;
  imagePath?: string;
  masked: boolean;
  createdAt: Date;
}

export interface Block {
  blockerId: string;
  blockedId: string;
  createdAt: Date;
}

export interface Report {
  _id: string;
  reporterId: string;
  targetType: "message" | "user";
  targetId: string;
  reason: string;
  snapshot?: string;
  createdAt: Date;
  status: "open";
}

export type NewConversation = Omit<Conversation, "_id">;
export type NewMessage = Omit<Message, "_id">;
export type NewReport = Omit<Report, "_id">;

export interface ListMessagesOptions {
  /** 이 시각(createdAt)보다 이전 메시지만 반환 — 페이지네이션 커서. */
  cursor?: Date;
  limit?: number;
}

/**
 * 채팅 저장소 추상화 — 서비스(Task 3)와 WS(Task 4)는 이 인터페이스에만 의존한다.
 * 단위 테스트는 InMemoryChatRepo를, 운영 코드는 MongoChatRepo(getChatRepo())를 사용한다.
 */
export interface ChatRepo {
  createConversation(data: NewConversation): Promise<Conversation>;
  findConversationByProduct(productId: string, buyerId: string): Promise<Conversation | null>;
  getConversation(id: string): Promise<Conversation | null>;
  /** userId가 buyer 또는 seller인 대화를 lastMessageAt 최신순으로 반환한다. */
  listConversations(userId: string): Promise<Conversation[]>;
  insertMessage(msg: NewMessage): Promise<Message>;
  listMessages(conversationId: string, opts?: ListMessagesOptions): Promise<Message[]>;
  countMessages(conversationId: string): Promise<number>;
  isBlocked(blockerId: string, blockedId: string): Promise<boolean>;
  block(blockerId: string, blockedId: string): Promise<void>;
  unblock(blockerId: string, blockedId: string): Promise<void>;
  insertReport(report: NewReport): Promise<void>;
  updateLastMessageAt(conversationId: string, at: Date): Promise<void>;
}

const DEFAULT_MESSAGE_LIMIT = 50;

/** 실제 Mongo 없이 서비스 단위테스트에서 쓰는 인메모리 fake. */
export class InMemoryChatRepo implements ChatRepo {
  private conversations: Conversation[] = [];
  private messages: Message[] = [];
  private blocks: Block[] = [];
  private reports: Report[] = [];

  async createConversation(data: NewConversation): Promise<Conversation> {
    const conversation: Conversation = { _id: randomUUID(), ...data };
    this.conversations.push(conversation);
    return { ...conversation };
  }

  async findConversationByProduct(productId: string, buyerId: string): Promise<Conversation | null> {
    const found = this.conversations.find((c) => c.productId === productId && c.buyerId === buyerId);
    return found ? { ...found } : null;
  }

  async getConversation(id: string): Promise<Conversation | null> {
    const found = this.conversations.find((c) => c._id === id);
    return found ? { ...found } : null;
  }

  async listConversations(userId: string): Promise<Conversation[]> {
    return this.conversations
      .filter((c) => c.buyerId === userId || c.sellerId === userId)
      .sort((a, b) => b.lastMessageAt.getTime() - a.lastMessageAt.getTime())
      .map((c) => ({ ...c }));
  }

  async insertMessage(msg: NewMessage): Promise<Message> {
    const message: Message = { _id: randomUUID(), ...msg };
    this.messages.push(message);
    return { ...message };
  }

  async listMessages(conversationId: string, opts: ListMessagesOptions = {}): Promise<Message[]> {
    const limit = opts.limit ?? DEFAULT_MESSAGE_LIMIT;
    let list = this.messages
      .filter((m) => m.conversationId === conversationId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    if (opts.cursor) {
      const cursorTime = opts.cursor.getTime();
      list = list.filter((m) => m.createdAt.getTime() < cursorTime);
    }
    return list.slice(0, limit).map((m) => ({ ...m }));
  }

  async countMessages(conversationId: string): Promise<number> {
    return this.messages.filter((m) => m.conversationId === conversationId).length;
  }

  async isBlocked(blockerId: string, blockedId: string): Promise<boolean> {
    return this.blocks.some((b) => b.blockerId === blockerId && b.blockedId === blockedId);
  }

  async block(blockerId: string, blockedId: string): Promise<void> {
    if (await this.isBlocked(blockerId, blockedId)) return;
    this.blocks.push({ blockerId, blockedId, createdAt: new Date() });
  }

  async unblock(blockerId: string, blockedId: string): Promise<void> {
    this.blocks = this.blocks.filter((b) => !(b.blockerId === blockerId && b.blockedId === blockedId));
  }

  async insertReport(report: NewReport): Promise<void> {
    this.reports.push({ _id: randomUUID(), ...report });
  }

  async updateLastMessageAt(conversationId: string, at: Date): Promise<void> {
    const conversation = this.conversations.find((c) => c._id === conversationId);
    if (conversation) conversation.lastMessageAt = at;
  }
}

let indexesEnsured = false;

/** 실제 Mongo 위에서 동작하는 구현. */
export class MongoChatRepo implements ChatRepo {
  private async ensureIndexes(): Promise<void> {
    if (indexesEnsured) return;
    const db = await getChatDb();
    await Promise.all([
      db.collection(COLLECTIONS.conversations).createIndex({ productId: 1, buyerId: 1 }),
      db.collection(COLLECTIONS.messages).createIndex({ conversationId: 1, createdAt: 1 }),
      db.collection(COLLECTIONS.blocks).createIndex({ blockerId: 1, blockedId: 1 }, { unique: true }),
    ]);
    indexesEnsured = true;
  }

  async createConversation(data: NewConversation): Promise<Conversation> {
    await this.ensureIndexes();
    const db = await getChatDb();
    const conversation: Conversation = { _id: randomUUID(), ...data };
    await db.collection<Conversation>(COLLECTIONS.conversations).insertOne(conversation);
    return conversation;
  }

  async findConversationByProduct(productId: string, buyerId: string): Promise<Conversation | null> {
    await this.ensureIndexes();
    const db = await getChatDb();
    return db.collection<Conversation>(COLLECTIONS.conversations).findOne({ productId, buyerId });
  }

  async getConversation(id: string): Promise<Conversation | null> {
    const db = await getChatDb();
    return db.collection<Conversation>(COLLECTIONS.conversations).findOne({ _id: id });
  }

  async listConversations(userId: string): Promise<Conversation[]> {
    const db = await getChatDb();
    const filter: Filter<Conversation> = { $or: [{ buyerId: userId }, { sellerId: userId }] };
    const sort: Sort = { lastMessageAt: -1 };
    return db.collection<Conversation>(COLLECTIONS.conversations).find(filter).sort(sort).toArray();
  }

  async insertMessage(msg: NewMessage): Promise<Message> {
    await this.ensureIndexes();
    const db = await getChatDb();
    const message: Message = { _id: randomUUID(), ...msg };
    await db.collection<Message>(COLLECTIONS.messages).insertOne(message);
    return message;
  }

  async listMessages(conversationId: string, opts: ListMessagesOptions = {}): Promise<Message[]> {
    const limit = opts.limit ?? DEFAULT_MESSAGE_LIMIT;
    const db = await getChatDb();
    const filter: Filter<Message> = opts.cursor
      ? { conversationId, createdAt: { $lt: opts.cursor } }
      : { conversationId };
    const sort: Sort = { createdAt: -1 };
    return db.collection<Message>(COLLECTIONS.messages).find(filter).sort(sort).limit(limit).toArray();
  }

  async countMessages(conversationId: string): Promise<number> {
    const db = await getChatDb();
    return db.collection<Message>(COLLECTIONS.messages).countDocuments({ conversationId });
  }

  async isBlocked(blockerId: string, blockedId: string): Promise<boolean> {
    const db = await getChatDb();
    const found = await db.collection<Block>(COLLECTIONS.blocks).findOne({ blockerId, blockedId });
    return found !== null;
  }

  async block(blockerId: string, blockedId: string): Promise<void> {
    await this.ensureIndexes();
    const db = await getChatDb();
    await db
      .collection<Block>(COLLECTIONS.blocks)
      .updateOne({ blockerId, blockedId }, { $setOnInsert: { blockerId, blockedId, createdAt: new Date() } }, { upsert: true });
  }

  async unblock(blockerId: string, blockedId: string): Promise<void> {
    const db = await getChatDb();
    await db.collection<Block>(COLLECTIONS.blocks).deleteOne({ blockerId, blockedId });
  }

  async insertReport(report: NewReport): Promise<void> {
    const db = await getChatDb();
    const doc: Report = { _id: randomUUID(), ...report };
    await db.collection<Report>(COLLECTIONS.reports).insertOne(doc);
  }

  async updateLastMessageAt(conversationId: string, at: Date): Promise<void> {
    const db = await getChatDb();
    await db.collection<Conversation>(COLLECTIONS.conversations).updateOne({ _id: conversationId }, { $set: { lastMessageAt: at } });
  }
}

let repo: ChatRepo | null = null;

/** 운영 코드용 단일 접근자 — 항상 MongoChatRepo를 반환한다(테스트는 InMemoryChatRepo를 직접 주입). */
export function getChatRepo(): ChatRepo {
  if (!repo) repo = new MongoChatRepo();
  return repo;
}
