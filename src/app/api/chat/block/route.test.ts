// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import { AppError } from "@/features/_shared/error";
import { REFRESH_COOKIE } from "@/features/auth/cookies";

const currentUserFromRefresh = vi.fn();
const userFindUnique = vi.fn();
const blockConversationCounterparty = vi.fn();
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
    blockConversationCounterparty: (...args: unknown[]) => blockConversationCounterparty(...args),
  };
});

const { POST } = await import("./route");

function req(body: unknown, cookie?: string): Request {
  return new Request("http://localhost/api/chat/block", {
    method: "POST",
    headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  currentUserFromRefresh.mockReset();
  userFindUnique.mockReset();
  blockConversationCounterparty.mockReset();
  getChatRepo.mockClear();
  userFindUnique.mockResolvedValue({ role: "USER", deletedAt: null });
});

describe("POST /api/chat/block", () => {
  it("401s a guest and never calls the service", async () => {
    currentUserFromRefresh.mockResolvedValue(null);
    const res = await POST(req({ conversationId: "c1" }));
    expect(res.status).toBe(401);
    expect(blockConversationCounterparty).not.toHaveBeenCalled();
  });

  it("403s a suspended user and never calls the service", async () => {
    currentUserFromRefresh.mockResolvedValue({ userId: "u1" });
    userFindUnique.mockResolvedValue({ role: "SUSPENDED", deletedAt: null });
    const res = await POST(req({ conversationId: "c1" }, `${REFRESH_COOKIE}=tok`));
    expect(res.status).toBe(403);
    expect(blockConversationCounterparty).not.toHaveBeenCalled();
  });

  it("400s when conversationId is missing", async () => {
    currentUserFromRefresh.mockResolvedValue({ userId: "u1" });
    const res = await POST(req({}, `${REFRESH_COOKIE}=tok`));
    expect(res.status).toBe(400);
    expect(blockConversationCounterparty).not.toHaveBeenCalled();
  });

  it("200s and passes the AUTHENTICATED userId as blocker, never a body-supplied one — the target user id is derived server-side from conversationId, never sent by the client", async () => {
    currentUserFromRefresh.mockResolvedValue({ userId: "real-blocker" });
    blockConversationCounterparty.mockResolvedValue(undefined);
    const res = await POST(req({ conversationId: "c1", userId: "impersonated" }, `${REFRESH_COOKIE}=tok`));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(blockConversationCounterparty).toHaveBeenCalledWith(getChatRepo(), "real-blocker", "c1");
  });

  it("maps a service AppError to its status", async () => {
    currentUserFromRefresh.mockResolvedValue({ userId: "u1" });
    blockConversationCounterparty.mockRejectedValue(new AppError("NOT_FOUND", "대화를 찾을 수 없어요.", 404));
    const res = await POST(req({ conversationId: "c1" }, `${REFRESH_COOKIE}=tok`));
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ code: "NOT_FOUND" });
  });
});
