// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import { AppError } from "@/features/_shared/error";
import { REFRESH_COOKIE } from "@/features/auth/cookies";

const currentUserFromRefresh = vi.fn();
const userFindUnique = vi.fn();
const startConversation = vi.fn();
const listConversations = vi.fn();
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
    startConversation: (...args: unknown[]) => startConversation(...args),
    listConversations: (...args: unknown[]) => listConversations(...args),
  };
});

const { GET, POST } = await import("./route");

function postReq(body: unknown, cookie?: string): Request {
  return new Request("http://localhost/api/chat/conversations", {
    method: "POST",
    headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body),
  });
}

function getReq(cookie?: string): Request {
  return new Request("http://localhost/api/chat/conversations", {
    headers: cookie ? { cookie } : {},
  });
}

beforeEach(() => {
  currentUserFromRefresh.mockReset();
  userFindUnique.mockReset();
  startConversation.mockReset();
  listConversations.mockReset();
  getChatRepo.mockClear();
  userFindUnique.mockResolvedValue({ role: "USER", deletedAt: null });
});

describe("POST /api/chat/conversations", () => {
  it("401s a guest (no session) and never calls the service", async () => {
    currentUserFromRefresh.mockResolvedValue(null);
    const res = await POST(postReq({ productId: "p1", firstText: "안녕하세요" }));
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ code: "UNAUTHENTICATED" });
    expect(startConversation).not.toHaveBeenCalled();
  });

  it("403s a suspended user and never calls the service", async () => {
    currentUserFromRefresh.mockResolvedValue({ userId: "u1" });
    userFindUnique.mockResolvedValue({ role: "SUSPENDED", deletedAt: null });
    const res = await POST(postReq({ productId: "p1", firstText: "안녕하세요" }, `${REFRESH_COOKIE}=tok`));
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: "ACCOUNT_SUSPENDED" });
    expect(startConversation).not.toHaveBeenCalled();
  });

  it("400s when productId/firstText are missing, before calling the service", async () => {
    currentUserFromRefresh.mockResolvedValue({ userId: "u1" });
    const res = await POST(postReq({}, `${REFRESH_COOKIE}=tok`));
    expect(res.status).toBe(400);
    expect(startConversation).not.toHaveBeenCalled();
  });

  it("201s and passes the AUTHENTICATED userId (never a body-supplied one) to the service", async () => {
    currentUserFromRefresh.mockResolvedValue({ userId: "buyer-1" });
    const delivered = {
      _id: "m1",
      conversationId: "c1",
      senderId: "buyer-1",
      kind: "text",
      text: "안녕하세요",
      masked: false,
      createdAt: new Date(),
    };
    startConversation.mockResolvedValue({ conversationId: "c1", message: delivered });
    const res = await POST(
      postReq({ productId: "p1", firstText: "안녕하세요", senderId: "someone-else" }, `${REFRESH_COOKIE}=tok`),
    );
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ conversationId: "c1", message: JSON.parse(JSON.stringify(delivered)) });
    expect(startConversation).toHaveBeenCalledWith(getChatRepo(), expect.anything(), "buyer-1", "p1", "안녕하세요");
  });

  it("maps a service AppError (e.g. BLOCKED) to its status", async () => {
    currentUserFromRefresh.mockResolvedValue({ userId: "buyer-1" });
    startConversation.mockRejectedValue(new AppError("BLOCKED", "차단된 상대와는 대화할 수 없어요.", 403));
    const res = await POST(postReq({ productId: "p1", firstText: "안녕하세요" }, `${REFRESH_COOKIE}=tok`));
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: "BLOCKED" });
  });
});

describe("GET /api/chat/conversations", () => {
  it("401s a guest and never calls the service", async () => {
    currentUserFromRefresh.mockResolvedValue(null);
    const res = await GET(getReq());
    expect(res.status).toBe(401);
    expect(listConversations).not.toHaveBeenCalled();
  });

  it("200s and passes the authenticated userId — never a client-supplied one", async () => {
    currentUserFromRefresh.mockResolvedValue({ userId: "u1" });
    listConversations.mockResolvedValue([]);
    const res = await GET(getReq(`${REFRESH_COOKIE}=tok`));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ conversations: [] });
    expect(listConversations).toHaveBeenCalledWith(getChatRepo(), expect.anything(), "u1");
  });
});
