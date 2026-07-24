// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import { AppError } from "@/features/_shared/error";
import { REFRESH_COOKIE } from "@/features/auth/cookies";

const currentUserFromRefresh = vi.fn();
const userFindUnique = vi.fn();
const reportMessage = vi.fn();
const reportUser = vi.fn();
const getChatRepo = vi.fn(() => ({ marker: "fake-repo" }));

vi.mock("@/features/_shared/prisma", () => ({
  prisma: { user: { findUnique: (...args: unknown[]) => userFindUnique(...args) } },
}));
vi.mock("@/features/auth/session", () => ({
  currentUserFromRefresh: (...args: unknown[]) => currentUserFromRefresh(...args),
}));
vi.mock("@/features/chat/repo", () => ({ getChatRepo: () => getChatRepo() }));
vi.mock("@/features/chat/service", async () => {
  const actual = await vi.importActual<typeof import("@/features/chat/service")>("@/features/chat/service");
  return {
    ...actual,
    reportMessage: (...args: unknown[]) => reportMessage(...args),
    reportUser: (...args: unknown[]) => reportUser(...args),
  };
});

const { POST } = await import("./route");

function req(body: unknown, cookie?: string): Request {
  return new Request("http://localhost/api/chat/report", {
    method: "POST",
    headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  currentUserFromRefresh.mockReset();
  userFindUnique.mockReset();
  reportMessage.mockReset();
  reportUser.mockReset();
  getChatRepo.mockClear();
  userFindUnique.mockResolvedValue({ role: "USER", deletedAt: null });
});

describe("POST /api/chat/report", () => {
  it("401s a guest and never calls the service", async () => {
    currentUserFromRefresh.mockResolvedValue(null);
    const res = await POST(req({ targetType: "message", targetId: "m1", reason: "욕설" }));
    expect(res.status).toBe(401);
    expect(reportMessage).not.toHaveBeenCalled();
    expect(reportUser).not.toHaveBeenCalled();
  });

  it("403s a suspended user and never calls the service", async () => {
    currentUserFromRefresh.mockResolvedValue({ userId: "u1" });
    userFindUnique.mockResolvedValue({ role: "SUSPENDED", deletedAt: null });
    const res = await POST(req({ targetType: "message", targetId: "m1", reason: "욕설" }, `${REFRESH_COOKIE}=tok`));
    expect(res.status).toBe(403);
    expect(reportMessage).not.toHaveBeenCalled();
  });

  it("400s an invalid targetType before calling the service", async () => {
    currentUserFromRefresh.mockResolvedValue({ userId: "u1" });
    const res = await POST(req({ targetType: "bogus", targetId: "m1", reason: "욕설" }, `${REFRESH_COOKIE}=tok`));
    expect(res.status).toBe(400);
    expect(reportMessage).not.toHaveBeenCalled();
    expect(reportUser).not.toHaveBeenCalled();
  });

  it("routes targetType=message to reportMessage with the AUTHENTICATED reporterId", async () => {
    currentUserFromRefresh.mockResolvedValue({ userId: "real-reporter" });
    reportMessage.mockResolvedValue(undefined);
    const res = await POST(
      req(
        { targetType: "message", targetId: "m1", reason: "욕설", reporterId: "impersonated" },
        `${REFRESH_COOKIE}=tok`,
      ),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(reportMessage).toHaveBeenCalledWith(getChatRepo(), "real-reporter", "m1", "욕설");
    expect(reportUser).not.toHaveBeenCalled();
  });

  it("routes targetType=user to reportUser with the AUTHENTICATED reporterId", async () => {
    currentUserFromRefresh.mockResolvedValue({ userId: "real-reporter" });
    reportUser.mockResolvedValue(undefined);
    const res = await POST(req({ targetType: "user", targetId: "u2", reason: "사기 의심" }, `${REFRESH_COOKIE}=tok`));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(reportUser).toHaveBeenCalledWith(getChatRepo(), "real-reporter", "u2", "사기 의심");
    expect(reportMessage).not.toHaveBeenCalled();
  });

  it("maps a service AppError (e.g. NOT_FOUND) to its status", async () => {
    currentUserFromRefresh.mockResolvedValue({ userId: "u1" });
    reportMessage.mockRejectedValue(new AppError("NOT_FOUND", "메시지를 찾을 수 없어요.", 404));
    const res = await POST(req({ targetType: "message", targetId: "m1", reason: "욕설" }, `${REFRESH_COOKIE}=tok`));
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ code: "NOT_FOUND" });
  });
});
