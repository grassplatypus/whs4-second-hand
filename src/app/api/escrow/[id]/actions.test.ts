// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import { AppError } from "@/features/_shared/error";
import { REFRESH_COOKIE } from "@/features/auth/cookies";

const currentUserFromRefresh = vi.fn();
const userFindUnique = vi.fn();
const fundEscrow = vi.fn();
const counterEscrow = vi.fn();
const acceptEscrow = vi.fn();
const confirmReceipt = vi.fn();
const refundEscrow = vi.fn();
const disputeEscrow = vi.fn();
const cancelEscrow = vi.fn();
const resolveDispute = vi.fn();
const getEscrow = vi.fn();
const setMeetup = vi.fn();
const leaveReview = vi.fn();

vi.mock("@/features/_shared/prisma", () => ({
  prisma: { user: { findUnique: (...a: unknown[]) => userFindUnique(...a) } },
}));
vi.mock("@/features/auth/session", () => ({
  currentUserFromRefresh: (...a: unknown[]) => currentUserFromRefresh(...a),
}));
vi.mock("@/features/escrow/service", async () => {
  const actual = await vi.importActual<typeof import("@/features/escrow/service")>("@/features/escrow/service");
  return {
    ...actual,
    fundEscrow: (...a: unknown[]) => fundEscrow(...a),
    counterEscrow: (...a: unknown[]) => counterEscrow(...a),
    acceptEscrow: (...a: unknown[]) => acceptEscrow(...a),
    confirmReceipt: (...a: unknown[]) => confirmReceipt(...a),
    refundEscrow: (...a: unknown[]) => refundEscrow(...a),
    disputeEscrow: (...a: unknown[]) => disputeEscrow(...a),
    cancelEscrow: (...a: unknown[]) => cancelEscrow(...a),
    resolveDispute: (...a: unknown[]) => resolveDispute(...a),
    getEscrow: (...a: unknown[]) => getEscrow(...a),
    setMeetup: (...a: unknown[]) => setMeetup(...a),
    leaveReview: (...a: unknown[]) => leaveReview(...a),
  };
});

const { POST: fundPost } = await import("./fund/route");
const { POST: counterPost } = await import("./counter/route");
const { POST: acceptPost } = await import("./accept/route");
const { POST: resolvePost } = await import("./resolve/route");
const { GET: detailGet } = await import("./route");
const { POST: meetupPost } = await import("./meetup/route");
const { POST: reviewPost } = await import("./review/route");

const ctx = { params: Promise.resolve({ id: "e1" }) };
function post(body: unknown, cookie?: string): Request {
  return new Request("http://localhost/api/escrow/e1/x", {
    method: "POST",
    headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  currentUserFromRefresh.mockReset();
  userFindUnique.mockReset().mockResolvedValue({ role: "USER", deletedAt: null });
  [
    fundEscrow,
    counterEscrow,
    acceptEscrow,
    confirmReceipt,
    refundEscrow,
    disputeEscrow,
    cancelEscrow,
    resolveDispute,
    getEscrow,
    setMeetup,
    leaveReview,
  ].forEach((m) => m.mockReset());
});

describe("행동 라우트: 인증 + 행위자 = 인증된 userId", () => {
  it("fund: GUEST 401, 서비스 미호출", async () => {
    currentUserFromRefresh.mockResolvedValue(null);
    const res = await fundPost(post({}), ctx);
    expect(res.status).toBe(401);
    expect(fundEscrow).not.toHaveBeenCalled();
  });

  it("fund: 인증된 userId를 행위자로 넘긴다(body userId 위조 무시)", async () => {
    currentUserFromRefresh.mockResolvedValue({ userId: "real-buyer" });
    fundEscrow.mockResolvedValue(undefined);
    const res = await fundPost(post({ userId: "impersonated", buyerId: "x" }, `${REFRESH_COOKIE}=t`), ctx);
    expect(res.status).toBe(200);
    expect(fundEscrow).toHaveBeenCalledWith(expect.anything(), "real-buyer", "e1");
  });

  it("accept: 인증된 userId를 행위자로", async () => {
    currentUserFromRefresh.mockResolvedValue({ userId: "u1" });
    acceptEscrow.mockResolvedValue(undefined);
    const res = await acceptPost(post({}, `${REFRESH_COOKIE}=t`), ctx);
    expect(res.status).toBe(200);
    expect(acceptEscrow).toHaveBeenCalledWith(expect.anything(), "u1", "e1");
  });

  it("counter: 금액이 숫자 아니면 400, 서비스 미호출", async () => {
    currentUserFromRefresh.mockResolvedValue({ userId: "u1" });
    const res = await counterPost(post({ amount: "만원" }, `${REFRESH_COOKIE}=t`), ctx);
    expect(res.status).toBe(400);
    expect(counterEscrow).not.toHaveBeenCalled();
  });

  it("counter: 유효 금액이면 인증 userId로 호출", async () => {
    currentUserFromRefresh.mockResolvedValue({ userId: "u1" });
    counterEscrow.mockResolvedValue(undefined);
    const res = await counterPost(post({ amount: 8000 }, `${REFRESH_COOKIE}=t`), ctx);
    expect(res.status).toBe(200);
    expect(counterEscrow).toHaveBeenCalledWith(expect.anything(), "u1", "e1", 8000);
  });

  it("detail GET: 참여자 격리는 서비스 위임, 인증 userId 전달", async () => {
    currentUserFromRefresh.mockResolvedValue({ userId: "u1" });
    getEscrow.mockRejectedValue(new AppError("FORBIDDEN", "권한이 없어요.", 403));
    const res = await detailGet(post({}, `${REFRESH_COOKIE}=t`), ctx);
    expect(res.status).toBe(403);
    expect(getEscrow).toHaveBeenCalledWith(expect.anything(), "u1", "e1");
  });
});

describe("resolve: 관리자 전용", () => {
  it("GUEST 401", async () => {
    currentUserFromRefresh.mockResolvedValue(null);
    const res = await resolvePost(post({ resolution: "release" }), ctx);
    expect(res.status).toBe(401);
    expect(resolveDispute).not.toHaveBeenCalled();
  });

  it("일반 USER는 403(requireAdmin), 서비스 미호출", async () => {
    currentUserFromRefresh.mockResolvedValue({ userId: "u1" });
    userFindUnique.mockResolvedValue({ role: "USER", deletedAt: null });
    const res = await resolvePost(post({ resolution: "release" }, `${REFRESH_COOKIE}=t`), ctx);
    expect(res.status).toBe(403);
    expect(resolveDispute).not.toHaveBeenCalled();
  });

  it("ADMIN이 잘못된 resolution을 주면 400", async () => {
    currentUserFromRefresh.mockResolvedValue({ userId: "admin-1" });
    userFindUnique.mockResolvedValue({ role: "ADMIN", deletedAt: null });
    const res = await resolvePost(post({ resolution: "steal" }, `${REFRESH_COOKIE}=t`), ctx);
    expect(res.status).toBe(400);
    expect(resolveDispute).not.toHaveBeenCalled();
  });

  it("ADMIN이 release로 조정하면 인증 adminId로 호출", async () => {
    currentUserFromRefresh.mockResolvedValue({ userId: "admin-1" });
    userFindUnique.mockResolvedValue({ role: "ADMIN", deletedAt: null });
    resolveDispute.mockResolvedValue(undefined);
    const res = await resolvePost(post({ resolution: "release", adminId: "fake" }, `${REFRESH_COOKIE}=t`), ctx);
    expect(res.status).toBe(200);
    expect(resolveDispute).toHaveBeenCalledWith(expect.anything(), "admin-1", "e1", "release");
  });
});

describe("meetup: 직거래 약속", () => {
  it("GUEST 401, 서비스 미호출", async () => {
    currentUserFromRefresh.mockResolvedValue(null);
    const res = await meetupPost(post({ place: "강남역", at: "2026-08-01T10:00:00.000Z" }), ctx);
    expect(res.status).toBe(401);
    expect(setMeetup).not.toHaveBeenCalled();
  });

  it("place/at이 문자열이 아니면 400, 서비스 미호출", async () => {
    currentUserFromRefresh.mockResolvedValue({ userId: "u1" });
    const res = await meetupPost(post({ place: 123, at: "2026-08-01T10:00:00.000Z" }, `${REFRESH_COOKIE}=t`), ctx);
    expect(res.status).toBe(400);
    expect(setMeetup).not.toHaveBeenCalled();
  });

  it("유효한 입력이면 인증된 userId를 행위자로 넘긴다(body userId 위조 무시)", async () => {
    currentUserFromRefresh.mockResolvedValue({ userId: "real-buyer" });
    setMeetup.mockResolvedValue(undefined);
    const res = await meetupPost(
      post({ place: "강남역 2번 출구", at: "2026-08-01T10:00:00.000Z", userId: "impersonated" }, `${REFRESH_COOKIE}=t`),
      ctx,
    );
    expect(res.status).toBe(200);
    expect(setMeetup).toHaveBeenCalledWith(expect.anything(), "real-buyer", "e1", {
      place: "강남역 2번 출구",
      at: "2026-08-01T10:00:00.000Z",
    });
  });

  it("서비스가 던진 에러(예: 409)를 그대로 상태코드에 반영한다", async () => {
    currentUserFromRefresh.mockResolvedValue({ userId: "u1" });
    setMeetup.mockRejectedValue(new AppError("INVALID_TRANSITION", "지금은 약속을 정할 수 없어요.", 409));
    const res = await meetupPost(post({ place: "강남역", at: "2026-08-01T10:00:00.000Z" }, `${REFRESH_COOKIE}=t`), ctx);
    expect(res.status).toBe(409);
  });
});

describe("review: 거래 후기", () => {
  it("GUEST 401, 서비스 미호출", async () => {
    currentUserFromRefresh.mockResolvedValue(null);
    const res = await reviewPost(post({ rating: "GOOD" }), ctx);
    expect(res.status).toBe(401);
    expect(leaveReview).not.toHaveBeenCalled();
  });

  it("rating이 문자열이 아니면 400, 서비스 미호출", async () => {
    currentUserFromRefresh.mockResolvedValue({ userId: "u1" });
    const res = await reviewPost(post({ rating: 1 }, `${REFRESH_COOKIE}=t`), ctx);
    expect(res.status).toBe(400);
    expect(leaveReview).not.toHaveBeenCalled();
  });

  it("유효한 입력이면 인증된 userId를 작성자로 넘긴다(body authorId/targetId 위조 무시)", async () => {
    currentUserFromRefresh.mockResolvedValue({ userId: "real-author" });
    leaveReview.mockResolvedValue(undefined);
    const res = await reviewPost(
      post({ rating: "GOOD", comment: "좋았어요", authorId: "fake", targetId: "fake" }, `${REFRESH_COOKIE}=t`),
      ctx,
    );
    expect(res.status).toBe(200);
    expect(leaveReview).toHaveBeenCalledWith(expect.anything(), "real-author", "e1", {
      rating: "GOOD",
      comment: "좋았어요",
    });
  });

  it("comment가 없으면 undefined로 넘긴다", async () => {
    currentUserFromRefresh.mockResolvedValue({ userId: "u1" });
    leaveReview.mockResolvedValue(undefined);
    const res = await reviewPost(post({ rating: "OK" }, `${REFRESH_COOKIE}=t`), ctx);
    expect(res.status).toBe(200);
    expect(leaveReview).toHaveBeenCalledWith(expect.anything(), "u1", "e1", { rating: "OK", comment: undefined });
  });

  it("이미 후기를 남겼으면(ALREADY_REVIEWED) 409를 그대로 반영한다", async () => {
    currentUserFromRefresh.mockResolvedValue({ userId: "u1" });
    leaveReview.mockRejectedValue(new AppError("ALREADY_REVIEWED", "이미 후기를 남겼어요.", 409));
    const res = await reviewPost(post({ rating: "GOOD" }, `${REFRESH_COOKIE}=t`), ctx);
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("ALREADY_REVIEWED");
  });
});
