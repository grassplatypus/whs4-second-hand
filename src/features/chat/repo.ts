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
  /** 마스킹 전 원문 — 관리자(신고 처리) 전용. 참여자에게는 절대 반환하지 않는다. */
  rawText?: string;
  imagePath?: string;
  masked: boolean;
  createdAt: Date;
}

export interface Block {
  blockerId: string;
  blockedId: string;
  createdAt: Date;
}

export type ReportStatus = "open" | "resolved" | "dismissed";

export interface Report {
  _id: string;
  reporterId: string;
  targetType: "message" | "user";
  targetId: string;
  reason: string;
  snapshot?: string;
  createdAt: Date;
  status: ReportStatus;
}

export interface ListReportsOptions {
  /** 특정 상태만(미지정이면 전체). 목록은 항상 open 우선·최신순. */
  status?: ReportStatus;
  limit?: number;
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
  getMessage(id: string): Promise<Message | null>;
  listMessages(conversationId: string, opts?: ListMessagesOptions): Promise<Message[]>;
  countMessages(conversationId: string): Promise<number>;
  /** conversationId 안에서 senderId가 보낸 메시지가 하나라도 있는지 — "상대가 답장했는가" 판단에 쓴다. */
  hasMessageFrom(conversationId: string, senderId: string): Promise<boolean>;
  isBlocked(blockerId: string, blockedId: string): Promise<boolean>;
  block(blockerId: string, blockedId: string): Promise<void>;
  unblock(blockerId: string, blockedId: string): Promise<void>;
  insertReport(report: NewReport): Promise<void>;
  /** 관리자 신고 관리(#6)용 — open 우선·최신순 목록. */
  listReports(opts?: ListReportsOptions): Promise<Report[]>;
  /** 관리자 대시보드용 — 상태별 신고 수(문서를 메모리에 올리지 않고 카운트만). */
  countReports(status?: ReportStatus): Promise<number>;
  /** 관리자 신고 처리(#6)용 — 상태를 resolved/dismissed로. 대상이 있었으면 true. */
  updateReportStatus(id: string, status: Exclude<ReportStatus, "open">): Promise<boolean>;
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

  async getMessage(id: string): Promise<Message | null> {
    const found = this.messages.find((m) => m._id === id);
    return found ? { ...found } : null;
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

  async hasMessageFrom(conversationId: string, senderId: string): Promise<boolean> {
    return this.messages.some((m) => m.conversationId === conversationId && m.senderId === senderId);
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

  async listReports(opts?: ListReportsOptions): Promise<Report[]> {
    const rank = (s: ReportStatus) => (s === "open" ? 0 : 1); // open을 항상 앞으로
    let rows = this.reports.slice();
    if (opts?.status) rows = rows.filter((r) => r.status === opts.status);
    rows.sort((a, b) => rank(a.status) - rank(b.status) || b.createdAt.getTime() - a.createdAt.getTime());
    return (opts?.limit ? rows.slice(0, opts.limit) : rows).map((r) => ({ ...r }));
  }

  async countReports(status?: ReportStatus): Promise<number> {
    return status ? this.reports.filter((r) => r.status === status).length : this.reports.length;
  }

  async updateReportStatus(id: string, status: Exclude<ReportStatus, "open">): Promise<boolean> {
    const report = this.reports.find((r) => r._id === id);
    if (!report) return false;
    report.status = status;
    return true;
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

  async getMessage(id: string): Promise<Message | null> {
    const db = await getChatDb();
    return db.collection<Message>(COLLECTIONS.messages).findOne({ _id: id });
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

  async hasMessageFrom(conversationId: string, senderId: string): Promise<boolean> {
    const db = await getChatDb();
    const found = await db.collection<Message>(COLLECTIONS.messages).findOne({ conversationId, senderId });
    return found !== null;
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

  async listReports(opts?: ListReportsOptions): Promise<Report[]> {
    const db = await getChatDb();
    // open 우선·그다음 최신순 정렬을 DB에서 계산한 뒤 limit을 건다 — limit을 재정렬 전에 걸면
    // 오래된 미처리(open) 신고가 최신 처리완료 건에 밀려 잘려나갈 수 있다.
    const pipeline: object[] = [];
    if (opts?.status) pipeline.push({ $match: { status: opts.status } });
    pipeline.push(
      { $addFields: { _openRank: { $cond: [{ $eq: ["$status", "open"] }, 0, 1] } } },
      { $sort: { _openRank: 1, createdAt: -1 } },
    );
    if (opts?.limit) pipeline.push({ $limit: opts.limit });
    pipeline.push({ $project: { _openRank: 0 } });
    return db.collection<Report>(COLLECTIONS.reports).aggregate<Report>(pipeline).toArray();
  }

  async countReports(status?: ReportStatus): Promise<number> {
    const db = await getChatDb();
    return db.collection<Report>(COLLECTIONS.reports).countDocuments(status ? { status } : {});
  }

  async updateReportStatus(id: string, status: Exclude<ReportStatus, "open">): Promise<boolean> {
    const db = await getChatDb();
    const res = await db.collection<Report>(COLLECTIONS.reports).updateOne({ _id: id }, { $set: { status } });
    return res.matchedCount === 1;
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
