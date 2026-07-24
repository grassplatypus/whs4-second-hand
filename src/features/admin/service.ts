import type { EscrowStatus } from "@prisma/client";
import { AppError } from "@/features/_shared/error";
import type { ChatRepo, ListReportsOptions } from "@/features/chat/repo";
import type { AdminDb } from "./db";

/**
 * 관리자 액션 감사 로그. actor(관리자)를 userId에, 무엇을·대상을 event 문자열에 남긴다.
 * (AuthAuditLog 재사용 — actorId 전용 컬럼이 없어 event에 target을 인코딩한다. userId는 FK가 아니다.)
 */
async function audit(db: AdminDb, adminId: string, action: string, targetRef: string): Promise<void> {
  await db.authAuditLog.create({ data: { userId: adminId, event: `${action}:${targetRef}` } });
}

function notFound(msg: string): AppError {
  return new AppError("NOT_FOUND", msg, 404);
}

/**
 * 유저 정지(USER→SUSPENDED). DB-fresh RBAC가 이미 SUSPENDED를 전 경로에서 차단하므로 role 전환만으로 실효.
 * 권한 남용 방지: 자기 자신·다른 관리자는 정지할 수 없다(관리자 상호 무력화·자물쇠 방지).
 */
export async function suspendUser(db: AdminDb, adminId: string, targetId: string): Promise<void> {
  if (adminId === targetId) throw new AppError("CANNOT_SANCTION_SELF", "자신을 정지할 수 없어요.", 400);
  const target = await db.user.findUnique({ where: { id: targetId }, select: { role: true, deletedAt: true } });
  if (!target || target.deletedAt) throw notFound("유저를 찾을 수 없어요.");
  if (target.role === "ADMIN") throw new AppError("CANNOT_SANCTION_ADMIN", "관리자는 정지할 수 없어요.", 403);
  if (target.role === "SUSPENDED") throw new AppError("ALREADY_SUSPENDED", "이미 정지된 유저예요.", 409);
  await db.user.update({ where: { id: targetId }, data: { role: "SUSPENDED" } });
  await audit(db, adminId, "ADMIN_SUSPEND", targetId);
}

/** 정지 해제(SUSPENDED→USER). 정지 상태가 아니면 409. */
export async function liftSuspension(db: AdminDb, adminId: string, targetId: string): Promise<void> {
  const target = await db.user.findUnique({ where: { id: targetId }, select: { role: true, deletedAt: true } });
  if (!target || target.deletedAt) throw notFound("유저를 찾을 수 없어요.");
  if (target.role !== "SUSPENDED") throw new AppError("NOT_SUSPENDED", "정지 상태가 아니에요.", 409);
  await db.user.update({ where: { id: targetId }, data: { role: "USER" } });
  await audit(db, adminId, "ADMIN_LIFT", targetId);
}

/** 상품 강제 삭제(soft-delete, 소유권 무시). 부적절 게시물 제거. 되돌릴 수 있게 soft, 감사 필수. */
export async function forceDeleteProduct(db: AdminDb, adminId: string, productId: string): Promise<void> {
  const product = await db.product.findUnique({ where: { id: productId }, select: { deletedAt: true } });
  if (!product || product.deletedAt) throw notFound("상품을 찾을 수 없어요.");
  await db.product.update({ where: { id: productId }, data: { deletedAt: new Date() } });
  await audit(db, adminId, "ADMIN_FORCE_DELETE", productId);
}

export interface ReportView {
  id: string;
  reporterNickname: string;
  targetType: "message" | "user";
  /** user 신고면 대상 닉네임, message 신고면 대상 메시지 식별자(닉네임 조회 불가). */
  targetLabel: string;
  /** user 신고의 대상 userId(관리자가 정지 액션에 쓴다). message 신고는 null. 관리자 전용 surface라 id 노출 허용. */
  targetUserId: string | null;
  reason: string;
  /** 관리자 전용 원문 스냅샷(#4가 rawText를 관리자용으로 보존한 값). 참여자에겐 절대 안 감. */
  snapshot: string | null;
  status: string;
  createdAt: Date;
}

/** 신고 목록(관리자). Mongo reports + Postgres 닉네임 보강. PII는 닉네임만. */
export async function listReports(
  repo: ChatRepo,
  db: AdminDb,
  opts?: ListReportsOptions,
): Promise<ReportView[]> {
  const reports = await repo.listReports(opts);
  // 신고자 + user 신고 대상의 닉네임을 한 번에 조회(N+1 방지).
  const userIds = new Set<string>();
  for (const r of reports) {
    userIds.add(r.reporterId);
    if (r.targetType === "user") userIds.add(r.targetId);
  }
  const users = userIds.size
    ? await db.user.findMany({ where: { id: { in: [...userIds] } }, select: { id: true, nickname: true } })
    : [];
  const nick = new Map(users.map((u) => [u.id, u.nickname]));
  return reports.map((r) => ({
    id: r._id,
    reporterNickname: nick.get(r.reporterId) ?? "(탈퇴)",
    targetType: r.targetType,
    targetLabel: r.targetType === "user" ? (nick.get(r.targetId) ?? "(탈퇴)") : r.targetId,
    targetUserId: r.targetType === "user" ? r.targetId : null,
    reason: r.reason,
    snapshot: r.snapshot ?? null,
    status: r.status,
    createdAt: r.createdAt,
  }));
}

/** 신고 처리(관리자). resolve=처리 완료, dismiss=반려. 감사 로그. */
export async function resolveReport(
  repo: ChatRepo,
  db: AdminDb,
  adminId: string,
  reportId: string,
  action: "resolve" | "dismiss",
): Promise<void> {
  if (action !== "resolve" && action !== "dismiss") {
    throw new AppError("INVALID_INPUT", "처리 방식이 올바르지 않아요.", 400);
  }
  const status = action === "resolve" ? "resolved" : "dismissed";
  const matched = await repo.updateReportStatus(reportId, status);
  if (!matched) throw notFound("신고를 찾을 수 없어요."); // 없는 신고에 거짓 감사 로그를 남기지 않는다
  await audit(db, adminId, action === "resolve" ? "ADMIN_RESOLVE_REPORT" : "ADMIN_DISMISS_REPORT", reportId);
}

export interface DisputedEscrowView {
  id: string;
  amount: number;
  buyerNickname: string;
  sellerNickname: string;
  product: { id: string; title: string };
  updatedAt: Date;
}

/** 분쟁 상태 에스크로 목록(관리자 조정 대기). 조정 자체는 #5 `/api/escrow/[id]/resolve` 재사용. PII 없음. */
export async function listDisputedEscrows(db: AdminDb): Promise<DisputedEscrowView[]> {
  const rows = await db.escrow.findMany({
    where: { status: "DISPUTED" },
    select: {
      id: true,
      amount: true,
      updatedAt: true,
      buyer: { select: { nickname: true } },
      seller: { select: { nickname: true } },
      product: { select: { id: true, title: true } },
    },
    orderBy: { updatedAt: "asc" },
  });
  return rows.map((r) => ({
    id: r.id,
    amount: r.amount,
    buyerNickname: r.buyer.nickname,
    sellerNickname: r.seller.nickname,
    product: { id: r.product.id, title: r.product.title },
    updatedAt: r.updatedAt,
  }));
}

export interface DashboardStats {
  users: number;
  suspended: number;
  products: { selling: number; reserved: number; sold: number };
  openReports: number;
  activeEscrows: number;
  disputedEscrows: number;
}

/** 대시보드 집계(읽기 전용, PII 없음 — 수치만). */
export async function dashboardStats(db: AdminDb, repo: ChatRepo): Promise<DashboardStats> {
  const active: EscrowStatus[] = ["REQUESTED", "ACCEPTED", "FUNDED", "DISPUTED"];
  const [users, suspended, selling, reserved, sold, activeEscrows, disputedEscrows, openReports] =
    await Promise.all([
      db.user.count({ where: { deletedAt: null } }),
      db.user.count({ where: { role: "SUSPENDED", deletedAt: null } }),
      db.product.count({ where: { status: "SELLING", deletedAt: null } }),
      db.product.count({ where: { status: "RESERVED", deletedAt: null } }),
      db.product.count({ where: { status: "SOLD", deletedAt: null } }),
      db.escrow.count({ where: { status: { in: active } } }),
      db.escrow.count({ where: { status: "DISPUTED" } }),
      repo.countReports("open"),
    ]);
  return {
    users,
    suspended,
    products: { selling, reserved, sold },
    openReports,
    activeEscrows,
    disputedEscrows,
  };
}
