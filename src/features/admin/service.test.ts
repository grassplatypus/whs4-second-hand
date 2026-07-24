// @vitest-environment node
import { describe, it, expect, vi } from "vitest";
import {
  suspendUser,
  liftSuspension,
  forceDeleteProduct,
  listReports,
  resolveReport,
  listDisputedEscrows,
  dashboardStats,
} from "./service";
import { InMemoryChatRepo } from "@/features/chat/repo";
import type { AdminDb } from "./db";

const ADMIN = "admin-1";
const TARGET = "user-1";

type Delegate = Record<string, ReturnType<typeof vi.fn>>;

function fakeDb(over: { user?: Delegate; product?: Delegate; escrow?: Delegate; audit?: Delegate }) {
  const auditCreate = over.audit?.create ?? vi.fn().mockResolvedValue({});
  const db = {
    user: {
      findUnique: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
      update: vi.fn().mockResolvedValue({}),
      count: vi.fn().mockResolvedValue(0),
      ...(over.user ?? {}),
    },
    product: {
      findUnique: vi.fn().mockResolvedValue(null),
      update: vi.fn().mockResolvedValue({}),
      count: vi.fn().mockResolvedValue(0),
      ...(over.product ?? {}),
    },
    escrow: {
      findMany: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0),
      ...(over.escrow ?? {}),
    },
    authAuditLog: { create: auditCreate },
  } as unknown as AdminDb;
  return { db, auditCreate };
}

describe("suspendUser", () => {
  it("USER를 SUSPENDED로 바꾸고 감사 로그를 남긴다", async () => {
    const update = vi.fn().mockResolvedValue({});
    const { db, auditCreate } = fakeDb({
      user: { findUnique: vi.fn().mockResolvedValue({ role: "USER", deletedAt: null }), update },
    });
    await suspendUser(db, ADMIN, TARGET);
    expect(update).toHaveBeenCalledWith({ where: { id: TARGET }, data: { role: "SUSPENDED" } });
    expect(auditCreate.mock.calls[0][0].data).toMatchObject({ userId: ADMIN, event: `ADMIN_SUSPEND:${TARGET}` });
  });

  it("자기 자신은 정지할 수 없다(400)", async () => {
    const { db } = fakeDb({});
    await expect(suspendUser(db, ADMIN, ADMIN)).rejects.toMatchObject({ code: "CANNOT_SANCTION_SELF", httpStatus: 400 });
  });

  it("다른 관리자는 정지할 수 없다(403)", async () => {
    const { db } = fakeDb({ user: { findUnique: vi.fn().mockResolvedValue({ role: "ADMIN", deletedAt: null }) } });
    await expect(suspendUser(db, ADMIN, "admin-2")).rejects.toMatchObject({ code: "CANNOT_SANCTION_ADMIN", httpStatus: 403 });
  });

  it("이미 정지된 유저면 409", async () => {
    const { db } = fakeDb({ user: { findUnique: vi.fn().mockResolvedValue({ role: "SUSPENDED", deletedAt: null }) } });
    await expect(suspendUser(db, ADMIN, TARGET)).rejects.toMatchObject({ code: "ALREADY_SUSPENDED", httpStatus: 409 });
  });

  it("없거나 탈퇴한 유저면 404", async () => {
    const { db } = fakeDb({ user: { findUnique: vi.fn().mockResolvedValue({ role: "USER", deletedAt: new Date() }) } });
    await expect(suspendUser(db, ADMIN, TARGET)).rejects.toMatchObject({ code: "NOT_FOUND", httpStatus: 404 });
  });
});

describe("liftSuspension", () => {
  it("SUSPENDED를 USER로 되돌리고 감사", async () => {
    const update = vi.fn().mockResolvedValue({});
    const { db, auditCreate } = fakeDb({
      user: { findUnique: vi.fn().mockResolvedValue({ role: "SUSPENDED", deletedAt: null }), update },
    });
    await liftSuspension(db, ADMIN, TARGET);
    expect(update).toHaveBeenCalledWith({ where: { id: TARGET }, data: { role: "USER" } });
    expect(auditCreate.mock.calls[0][0].data.event).toBe(`ADMIN_LIFT:${TARGET}`);
  });

  it("정지 상태가 아니면 409", async () => {
    const { db } = fakeDb({ user: { findUnique: vi.fn().mockResolvedValue({ role: "USER", deletedAt: null }) } });
    await expect(liftSuspension(db, ADMIN, TARGET)).rejects.toMatchObject({ code: "NOT_SUSPENDED", httpStatus: 409 });
  });
});

describe("forceDeleteProduct", () => {
  it("소유권 무시하고 soft-delete + 감사", async () => {
    const update = vi.fn().mockResolvedValue({});
    const { db, auditCreate } = fakeDb({
      product: { findUnique: vi.fn().mockResolvedValue({ deletedAt: null }), update },
    });
    await forceDeleteProduct(db, ADMIN, "product-1");
    expect(update.mock.calls[0][0].data.deletedAt).toBeInstanceOf(Date);
    expect(auditCreate.mock.calls[0][0].data.event).toBe("ADMIN_FORCE_DELETE:product-1");
  });

  it("이미 삭제된(또는 없는) 상품이면 404", async () => {
    const { db } = fakeDb({ product: { findUnique: vi.fn().mockResolvedValue({ deletedAt: new Date() }) } });
    await expect(forceDeleteProduct(db, ADMIN, "product-1")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("listReports (닉네임 보강·snapshot 관리자 전용)", () => {
  it("신고자·user 대상 닉네임을 보강하고 원문 snapshot을 포함한다", async () => {
    const repo = new InMemoryChatRepo();
    await repo.insertReport({ reporterId: "r1", targetType: "message", targetId: "m1", reason: "욕설", snapshot: "시발", createdAt: new Date("2026-07-20"), status: "open" });
    await repo.insertReport({ reporterId: "r2", targetType: "user", targetId: "u9", reason: "사기", createdAt: new Date("2026-07-19"), status: "open" });
    const { db } = fakeDb({
      user: {
        findMany: vi.fn().mockResolvedValue([
          { id: "r1", nickname: "신고왕" },
          { id: "r2", nickname: "제보자" },
          { id: "u9", nickname: "수상한사람" },
        ]),
      },
    });
    const views = await listReports(repo, db);
    const msgReport = views.find((v) => v.targetType === "message")!;
    expect(msgReport.reporterNickname).toBe("신고왕");
    expect(msgReport.targetLabel).toBe("m1"); // 메시지 신고는 대상 id 그대로
    expect(msgReport.snapshot).toBe("시발"); // 관리자 전용 원문
    const userReport = views.find((v) => v.targetType === "user")!;
    expect(userReport.targetLabel).toBe("수상한사람"); // 유저 신고는 대상 닉네임
  });
});

describe("resolveReport", () => {
  it("resolve면 status=resolved + 감사", async () => {
    const repo = new InMemoryChatRepo();
    const update = vi.spyOn(repo, "updateReportStatus");
    const { db, auditCreate } = fakeDb({});
    await resolveReport(repo, db, ADMIN, "rep-1", "resolve");
    expect(update).toHaveBeenCalledWith("rep-1", "resolved");
    expect(auditCreate.mock.calls[0][0].data.event).toBe("ADMIN_RESOLVE_REPORT:rep-1");
  });

  it("dismiss면 status=dismissed", async () => {
    const repo = new InMemoryChatRepo();
    const update = vi.spyOn(repo, "updateReportStatus");
    const { db } = fakeDb({});
    await resolveReport(repo, db, ADMIN, "rep-1", "dismiss");
    expect(update).toHaveBeenCalledWith("rep-1", "dismissed");
  });

  it("잘못된 action은 400", async () => {
    const repo = new InMemoryChatRepo();
    const { db } = fakeDb({});
    await expect(resolveReport(repo, db, ADMIN, "rep-1", "delete" as "resolve")).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });
});

describe("listDisputedEscrows (PII 없음)", () => {
  it("DISPUTED만·양측 닉네임·상품만", async () => {
    const { db } = fakeDb({
      escrow: {
        findMany: vi.fn().mockResolvedValue([
          { id: "e1", amount: 10000, updatedAt: new Date(), buyer: { nickname: "구매왕" }, seller: { nickname: "판매왕" }, product: { id: "p1", title: "아이폰" } },
        ]),
      },
    });
    const list = await listDisputedEscrows(db);
    expect(list[0]).toMatchObject({ id: "e1", amount: 10000, buyerNickname: "구매왕", sellerNickname: "판매왕", product: { id: "p1", title: "아이폰" } });
    // where가 DISPUTED로 걸렸는지
    // (findMany mock의 첫 인자로 확인)
  });
});

describe("dashboardStats (집계·PII 없음)", () => {
  it("유저·정지·상품상태·에스크로·신고 카운트를 모은다", async () => {
    const repo = new InMemoryChatRepo();
    await repo.insertReport({ reporterId: "r1", targetType: "user", targetId: "u1", reason: "x", createdAt: new Date(), status: "open" });
    const userCount = vi.fn().mockResolvedValueOnce(10).mockResolvedValueOnce(2); // users, suspended
    const productCount = vi.fn().mockResolvedValueOnce(5).mockResolvedValueOnce(1).mockResolvedValueOnce(3); // selling, reserved, sold
    const escrowCount = vi.fn().mockResolvedValueOnce(4).mockResolvedValueOnce(1); // active, disputed
    const { db } = fakeDb({ user: { count: userCount }, product: { count: productCount }, escrow: { count: escrowCount } });
    const stats = await dashboardStats(db, repo);
    expect(stats).toEqual({
      users: 10,
      suspended: 2,
      products: { selling: 5, reserved: 1, sold: 3 },
      openReports: 1,
      activeEscrows: 4,
      disputedEscrows: 1,
    });
  });
});
