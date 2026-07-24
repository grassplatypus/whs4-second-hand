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
  /** 각자 마지막으로 방을 열어본 시각 — 안 읽은 수와 읽음 표시의 기준. */
  buyerReadAt?: Date;
  sellerReadAt?: Date;
  /**
   * 각자 방을 나간 시각. 나간 뒤로 새 메시지가 없으면 그 사람 목록에서 숨긴다.
   * 상대가 새로 보내면 다시 보이고, 둘 다 나가고 새 메시지도 없으면 휴면 방이 된다.
   */
  buyerLeftAt?: Date;
  sellerLeftAt?: Date;
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
  /** 시스템이 비속어를 감지해 자동으로 올린 건(사용자에게는 알리지 않는다). */
  auto?: boolean;
  /** 사용자 신고가 합쳐진 경우 그 신고자들 — 관리자 화면에서 한 건으로 보이게 한다. */
  reportedBy?: string[];
}

/** 자동 감지 신고의 신고자 id — 실제 유저가 아니라서 사용자 조회를 하면 안 된다. */
export const SYSTEM_REPORTER_ID = "system";

/** 신고 사유를 잇는 구분자 — 자동 감지와 사용자 신고가 같은 규칙을 쓴다. */
const REASON_SEPARATOR = " · ";

/**
 * 같은 대상에 사유가 겹칠 때 중복 없이 이어 붙인다.
 * 이미 있는 문구와 같으면 다시 붙이지 않고, 다른 문구면 " · "로 잇는다.
 * (들어오는 사유가 이미 여러 개 이어진 문자열이어도 조각 단위로 비교한다.)
 */
export function mergeReportReasons(existing: string | undefined, incoming: string): string {
  const reasons = new Set((existing ?? "").split(REASON_SEPARATOR).filter(Boolean));
  for (const part of incoming.split(REASON_SEPARATOR)) {
    if (part) reasons.add(part);
  }
  return [...reasons].join(REASON_SEPARATOR);
}

/** 신고 목록 페이지네이션 커서 — 마지막으로 받은 신고의 위치를 그대로 가리킨다. */
export interface ReportCursor {
  /** 마지막으로 받은 신고의 createdAt. */
  createdAt: Date;
  /** 그 신고의 상태. open 우선 정렬을 이어가려면 순위도 알아야 한다. */
  status: ReportStatus;
  /** 그 신고의 id — 같은 밀리초에 만들어진 건들 사이에서 순서를 못박는다. */
  id?: string;
}

export interface ListReportsOptions {
  /** 특정 상태만(미지정이면 전체). 목록은 항상 open 우선·최신순. */
  status?: ReportStatus;
  limit?: number;
  /** 이 위치보다 뒤(더 오래된 쪽)만 반환 — "더 보기"용. */
  cursor?: ReportCursor;
}

/** open 우선 정렬 순위 — Mongo aggregation의 `_openRank`와 같은 규칙. */
function openRank(status: ReportStatus): number {
  return status === "open" ? 0 : 1;
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
  /**
   * 같은 대상(메시지)에 대한 신고를 한 건으로 유지한다.
   * - 자동 감지(auto)든 사용자 신고든 대상이 같으면 하나의 레코드로 합친다.
   * - 사용자가 신고하면 reportedBy에 추가하고 사유를 갱신한다(관리자 화면에 중복 노출 방지).
   */
  upsertAutoReport(report: NewReport): Promise<void>;
  /** 사용자 신고를 기존(자동 포함) 신고와 합친다. 합칠 대상이 없으면 새로 만든다. */
  mergeUserReport(report: NewReport): Promise<void>;
  /** 방을 열어본 시각을 기록한다 — 읽음 표시와 안 읽은 수의 기준. */
  markRead(conversationId: string, userId: string, at: Date): Promise<void>;
  /** 방을 나간 시각을 기록한다(상대에게는 그대로 남는다). */
  markLeft(conversationId: string, userId: string, at: Date): Promise<void>;
  /** 나갔던 사람이 다시 말을 걸면 나간 표시를 지운다 — 그 사람 목록에 방이 정상으로 돌아온다. */
  clearLeft(conversationId: string, userId: string): Promise<void>;
  /** 특정 시각 이후 상대가 보낸 메시지 수 — 안 읽은 수 뱃지에 쓴다. */
  countUnread(conversationId: string, userId: string, since: Date | undefined): Promise<number>;
  /** 양쪽 모두 나갔고 그 뒤로 새 메시지가 없는 방(휴면) — 관리자만 지울 수 있다. */
  listDormantConversations(): Promise<Conversation[]>;
  /** 방과 그 메시지를 실제로 지운다(관리자 전용). */
  deleteConversations(ids: string[]): Promise<number>;
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

  async upsertAutoReport(report: NewReport): Promise<void> {
    const existing = this.reports.find(
      (r) => r.targetType === report.targetType && r.targetId === report.targetId && r.status === "open",
    );
    if (existing) {
      existing.auto = true;
      // 같은 문구면 다시 붙이지 않고, 다른 문구면 이어 붙인다(사용자 신고와 같은 규칙).
      existing.reason = mergeReportReasons(existing.reason, report.reason);
      existing.snapshot = existing.snapshot ?? report.snapshot;
      return;
    }
    this.reports.push({ _id: randomUUID(), ...report, auto: true });
  }

  async mergeUserReport(report: NewReport): Promise<void> {
    const existing = this.reports.find(
      (r) => r.targetType === report.targetType && r.targetId === report.targetId && r.status === "open",
    );
    if (existing) {
      existing.reportedBy = [...new Set([...(existing.reportedBy ?? []), report.reporterId])];
      // 기존 사유(자동 감지 포함)는 지우지 않고 덧붙인다 — 먼저 남은 증거를 덮어쓰지 못하게.
      existing.reason = mergeReportReasons(existing.reason, report.reason);
      existing.snapshot = existing.snapshot ?? report.snapshot;
      return;
    }
    this.reports.push({ _id: randomUUID(), ...report, reportedBy: [report.reporterId] });
  }

  async markRead(conversationId: string, userId: string, at: Date): Promise<void> {
    const c = this.conversations.find((x) => x._id === conversationId);
    if (!c) return;
    if (c.buyerId === userId) c.buyerReadAt = at;
    if (c.sellerId === userId) c.sellerReadAt = at;
  }

  async markLeft(conversationId: string, userId: string, at: Date): Promise<void> {
    const c = this.conversations.find((x) => x._id === conversationId);
    if (!c) return;
    if (c.buyerId === userId) c.buyerLeftAt = at;
    if (c.sellerId === userId) c.sellerLeftAt = at;
  }

  async clearLeft(conversationId: string, userId: string): Promise<void> {
    const c = this.conversations.find((x) => x._id === conversationId);
    if (!c) return;
    if (c.buyerId === userId) delete c.buyerLeftAt;
    if (c.sellerId === userId) delete c.sellerLeftAt;
  }

  async countUnread(conversationId: string, userId: string, since: Date | undefined): Promise<number> {
    return this.messages.filter(
      (m) =>
        m.conversationId === conversationId &&
        m.senderId !== userId &&
        (!since || m.createdAt > since),
    ).length;
  }

  async listDormantConversations(): Promise<Conversation[]> {
    return this.conversations
      .filter((c) => {
        if (!c.buyerLeftAt || !c.sellerLeftAt) return false;
        // 먼저 나간 쪽 기준이다. 그 뒤에 온 메시지가 있으면 그 사람 목록에는 방이 다시 떠 있으므로
        // 아직 버려진 방이 아니다(같은 밀리초 도착까지 "그 전"으로 본다).
        const earlier = c.buyerLeftAt < c.sellerLeftAt ? c.buyerLeftAt : c.sellerLeftAt;
        return c.lastMessageAt.getTime() <= earlier.getTime();
      })
      .map((c) => ({ ...c }));
  }

  async deleteConversations(ids: string[]): Promise<number> {
    const before = this.conversations.length;
    this.conversations = this.conversations.filter((c) => !ids.includes(c._id));
    this.messages = this.messages.filter((m) => !ids.includes(m.conversationId));
    return before - this.conversations.length;
  }

  async listReports(opts?: ListReportsOptions): Promise<Report[]> {
    let rows = this.reports.slice();
    if (opts?.status) rows = rows.filter((r) => r.status === opts.status);
    // open을 항상 앞으로, 그다음 최신순. 같은 밀리초면 id로 순서를 못박는다
    // (그래야 "더 보기"가 같은 건을 다시 주거나 건너뛰지 않는다).
    rows.sort(
      (a, b) =>
        openRank(a.status) - openRank(b.status) ||
        b.createdAt.getTime() - a.createdAt.getTime() ||
        a._id.localeCompare(b._id),
    );
    if (opts?.cursor) {
      // 정렬 기준(순위 → 최신순 → id)에서 커서보다 뒤에 있는 것만 남긴다.
      const cursorRank = openRank(opts.cursor.status);
      const cursorTime = opts.cursor.createdAt.getTime();
      const cursorId = opts.cursor.id;
      rows = rows.filter((r) => {
        const rank = openRank(r.status);
        if (rank !== cursorRank) return rank > cursorRank;
        const at = r.createdAt.getTime();
        if (at !== cursorTime) return at < cursorTime;
        return cursorId ? r._id.localeCompare(cursorId) > 0 : false;
      });
    }
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

  async upsertAutoReport(report: NewReport): Promise<void> {
    const db = await getChatDb();
    const col = db.collection<Report>(COLLECTIONS.reports);
    // 같은 대상의 열린 신고가 있으면 사유를 합치고, 없으면 새로 만든다.
    const existing = await col.findOne({
      targetType: report.targetType,
      targetId: report.targetId,
      status: "open",
    });
    if (existing) {
      // 이미 있는 문구는 다시 붙이지 않는다 — 같은 감지가 여러 번 걸려도 사유가 불어나지 않게.
      const update: Partial<Report> = {
        auto: true,
        reason: mergeReportReasons(existing.reason, report.reason),
      };
      // 먼저 남은 증거(스냅샷)를 덮어쓰지 않는다.
      const snapshot = existing.snapshot ?? report.snapshot;
      if (snapshot !== undefined) update.snapshot = snapshot;
      await col.updateOne({ _id: existing._id }, { $set: update });
      return;
    }
    await col.insertOne({ _id: randomUUID(), ...report, auto: true });
  }

  async mergeUserReport(report: NewReport): Promise<void> {
    const db = await getChatDb();
    const col = db.collection<Report>(COLLECTIONS.reports);
    const existing = await col.findOne({
      targetType: report.targetType,
      targetId: report.targetId,
      status: "open",
    });
    if (existing) {
      // 기존 사유(자동 감지 포함)를 덮어쓰지 않고 합친다 — 먼저 남은 증거 보존.
      await col.updateOne(
        { _id: existing._id },
        {
          $set: { reason: mergeReportReasons(existing.reason, report.reason) },
          $addToSet: { reportedBy: report.reporterId },
        },
      );
      return;
    }
    await col.insertOne({ _id: randomUUID(), ...report, reportedBy: [report.reporterId] });
  }

  async markRead(conversationId: string, userId: string, at: Date): Promise<void> {
    const db = await getChatDb();
    const col = db.collection<Conversation>(COLLECTIONS.conversations);
    await col.updateOne({ _id: conversationId, buyerId: userId }, { $set: { buyerReadAt: at } });
    await col.updateOne({ _id: conversationId, sellerId: userId }, { $set: { sellerReadAt: at } });
  }

  async markLeft(conversationId: string, userId: string, at: Date): Promise<void> {
    const db = await getChatDb();
    const col = db.collection<Conversation>(COLLECTIONS.conversations);
    await col.updateOne({ _id: conversationId, buyerId: userId }, { $set: { buyerLeftAt: at } });
    await col.updateOne({ _id: conversationId, sellerId: userId }, { $set: { sellerLeftAt: at } });
  }

  async clearLeft(conversationId: string, userId: string): Promise<void> {
    const db = await getChatDb();
    const col = db.collection<Conversation>(COLLECTIONS.conversations);
    await col.updateOne({ _id: conversationId, buyerId: userId }, { $unset: { buyerLeftAt: "" } });
    await col.updateOne({ _id: conversationId, sellerId: userId }, { $unset: { sellerLeftAt: "" } });
  }

  async countUnread(conversationId: string, userId: string, since: Date | undefined): Promise<number> {
    const db = await getChatDb();
    const filter: Filter<Message> = { conversationId, senderId: { $ne: userId } };
    if (since) filter.createdAt = { $gt: since };
    return db.collection<Message>(COLLECTIONS.messages).countDocuments(filter);
  }

  async listDormantConversations(): Promise<Conversation[]> {
    const db = await getChatDb();
    // 둘 다 나갔고, "먼저 나간 시각" 이후로 새 메시지가 없는 방.
    // 나중에 온 메시지가 있으면 먼저 나간 사람 목록에 방이 다시 떠 있으므로 지우면 안 된다.
    return db
      .collection<Conversation>(COLLECTIONS.conversations)
      .aggregate<Conversation>([
        { $match: { buyerLeftAt: { $ne: null }, sellerLeftAt: { $ne: null } } },
        { $addFields: { _earlierLeft: { $min: ["$buyerLeftAt", "$sellerLeftAt"] } } },
        { $match: { $expr: { $lte: ["$lastMessageAt", "$_earlierLeft"] } } },
        { $project: { _earlierLeft: 0 } },
      ])
      .toArray();
  }

  async deleteConversations(ids: string[]): Promise<number> {
    if (ids.length === 0) return 0;
    const db = await getChatDb();
    await db.collection<Message>(COLLECTIONS.messages).deleteMany({ conversationId: { $in: ids } });
    const res = await db.collection<Conversation>(COLLECTIONS.conversations).deleteMany({ _id: { $in: ids } });
    return res.deletedCount ?? 0;
  }

  async listReports(opts?: ListReportsOptions): Promise<Report[]> {
    const db = await getChatDb();
    // open 우선·그다음 최신순 정렬을 DB에서 계산한 뒤 limit을 건다 — limit을 재정렬 전에 걸면
    // 오래된 미처리(open) 신고가 최신 처리완료 건에 밀려 잘려나갈 수 있다.
    const pipeline: object[] = [];
    if (opts?.status) pipeline.push({ $match: { status: opts.status } });
    pipeline.push({ $addFields: { _openRank: { $cond: [{ $eq: ["$status", "open"] }, 0, 1] } } });
    if (opts?.cursor) {
      // 커서는 정렬 기준(_openRank → createdAt → _id)을 그대로 따라간다.
      // 순위가 더 뒤이거나 / 순위가 같고 더 오래됐거나 / 같은 밀리초면 id가 더 뒤인 건만 남긴다.
      const cursorRank = openRank(opts.cursor.status);
      const cursorAt = opts.cursor.createdAt;
      const cursorId = opts.cursor.id;
      pipeline.push({
        $match: {
          $expr: {
            $or: [
              { $gt: ["$_openRank", cursorRank] },
              { $and: [{ $eq: ["$_openRank", cursorRank] }, { $lt: ["$createdAt", cursorAt] }] },
              ...(cursorId
                ? [
                    {
                      $and: [
                        { $eq: ["$_openRank", cursorRank] },
                        { $eq: ["$createdAt", cursorAt] },
                        { $gt: ["$_id", cursorId] },
                      ],
                    },
                  ]
                : []),
            ],
          },
        },
      });
    }
    pipeline.push({ $sort: { _openRank: 1, createdAt: -1, _id: 1 } });
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
