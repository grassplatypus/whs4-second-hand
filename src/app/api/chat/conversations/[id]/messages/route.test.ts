// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import { AppError } from "@/features/_shared/error";
import { REFRESH_COOKIE } from "@/features/auth/cookies";

const currentUserFromRefresh = vi.fn();
const userFindUnique = vi.fn();
const listMessages = vi.fn();
const sendMessage = vi.fn();
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
    listMessages: (...args: unknown[]) => listMessages(...args),
    sendMessage: (...args: unknown[]) => sendMessage(...args),
  };
});

const { GET, POST } = await import("./route");

function ctx(id: string) {
  return { params: Promise.resolve({ id }) };
}

function getReq(cookie?: string, query = ""): Request {
  return new Request(`http://localhost/api/chat/conversations/c1/messages${query}`, {
    headers: cookie ? { cookie } : {},
  });
}

function postReq(body: unknown, cookie?: string): Request {
  return new Request("http://localhost/api/chat/conversations/c1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  currentUserFromRefresh.mockReset();
  userFindUnique.mockReset();
  listMessages.mockReset();
  sendMessage.mockReset();
  getChatRepo.mockClear();
  userFindUnique.mockResolvedValue({ role: "USER", deletedAt: null });
});

describe("GET /api/chat/conversations/[id]/messages", () => {
  it("401s a guest and never calls the service", async () => {
    currentUserFromRefresh.mockResolvedValue(null);
    const res = await GET(getReq(), ctx("c1"));
    expect(res.status).toBe(401);
    expect(listMessages).not.toHaveBeenCalled();
  });

  it("403s a suspended user and never calls the service", async () => {
    currentUserFromRefresh.mockResolvedValue({ userId: "u1" });
    userFindUnique.mockResolvedValue({ role: "SUSPENDED", deletedAt: null });
    const res = await GET(getReq(`${REFRESH_COOKIE}=tok`), ctx("c1"));
    expect(res.status).toBe(403);
    expect(listMessages).not.toHaveBeenCalled();
  });

  it("passes the authenticated userId and conversation id to the service", async () => {
    currentUserFromRefresh.mockResolvedValue({ userId: "u1" });
    listMessages.mockResolvedValue([]);
    const res = await GET(getReq(`${REFRESH_COOKIE}=tok`), ctx("c1"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ messages: [] });
    expect(listMessages).toHaveBeenCalledWith(getChatRepo(), "u1", "c1", undefined);
  });

  it("parses a valid cursor query param into a Date", async () => {
    currentUserFromRefresh.mockResolvedValue({ userId: "u1" });
    listMessages.mockResolvedValue([]);
    const iso = "2026-01-01T00:00:00.000Z";
    await GET(getReq(`${REFRESH_COOKIE}=tok`, `?cursor=${encodeURIComponent(iso)}`), ctx("c1"));
    const passedCursor = listMessages.mock.calls[0][3] as Date;
    expect(passedCursor.toISOString()).toBe(iso);
  });

  it("400s an invalid cursor query param", async () => {
    currentUserFromRefresh.mockResolvedValue({ userId: "u1" });
    const res = await GET(getReq(`${REFRESH_COOKIE}=tok`, "?cursor=not-a-date"), ctx("c1"));
    expect(res.status).toBe(400);
    expect(listMessages).not.toHaveBeenCalled();
  });

  it("maps a non-participant's 403 FORBIDDEN from the service through unchanged", async () => {
    currentUserFromRefresh.mockResolvedValue({ userId: "outsider" });
    listMessages.mockRejectedValue(new AppError("FORBIDDEN", "권한이 없어요.", 403));
    const res = await GET(getReq(`${REFRESH_COOKIE}=tok`), ctx("c1"));
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: "FORBIDDEN" });
  });

  it("computes mine per-message from the authenticated userId and never leaks senderId to the client", async () => {
    currentUserFromRefresh.mockResolvedValue({ userId: "buyer-1" });
    const createdAt = new Date();
    listMessages.mockResolvedValue([
      { _id: "m1", conversationId: "c1", senderId: "buyer-1", kind: "text", text: "안녕", masked: false, createdAt },
      { _id: "m2", conversationId: "c1", senderId: "seller-1", kind: "text", text: "네", masked: false, createdAt },
    ]);
    const res = await GET(getReq(`${REFRESH_COOKIE}=tok`), ctx("c1"));
    const body = (await res.json()) as { messages: Record<string, unknown>[] };
    expect(body.messages).toEqual([
      { _id: "m1", conversationId: "c1", kind: "text", text: "안녕", masked: false, createdAt: createdAt.toISOString(), mine: true },
      { _id: "m2", conversationId: "c1", kind: "text", text: "네", masked: false, createdAt: createdAt.toISOString(), mine: false },
    ]);
    expect(JSON.stringify(body.messages)).not.toContain("senderId");
  });
});

describe("POST /api/chat/conversations/[id]/messages", () => {
  it("401s a guest and never calls the service", async () => {
    currentUserFromRefresh.mockResolvedValue(null);
    const res = await POST(postReq({ kind: "text", text: "hi" }), ctx("c1"));
    expect(res.status).toBe(401);
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it("403s a suspended user and never calls the service", async () => {
    currentUserFromRefresh.mockResolvedValue({ userId: "u1" });
    userFindUnique.mockResolvedValue({ role: "SUSPENDED", deletedAt: null });
    const res = await POST(postReq({ kind: "text", text: "hi" }, `${REFRESH_COOKIE}=tok`), ctx("c1"));
    expect(res.status).toBe(403);
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it("400s an invalid kind before calling the service", async () => {
    currentUserFromRefresh.mockResolvedValue({ userId: "u1" });
    const res = await POST(postReq({ kind: "video" }, `${REFRESH_COOKIE}=tok`), ctx("c1"));
    expect(res.status).toBe(400);
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it("passes the AUTHENTICATED userId as sender, never a body-supplied senderId — and the response never carries a raw senderId, only a server-computed mine flag", async () => {
    currentUserFromRefresh.mockResolvedValue({ userId: "real-sender" });
    const delivered = {
      _id: "m2",
      conversationId: "c1",
      senderId: "real-sender",
      kind: "text",
      text: "hi masked",
      masked: false,
      createdAt: new Date(),
    };
    sendMessage.mockResolvedValue(delivered);
    const res = await POST(
      postReq({ kind: "text", text: "hi", senderId: "impersonated" }, `${REFRESH_COOKIE}=tok`),
      ctx("c1"),
    );
    expect(res.status).toBe(201);
    const json = (await res.json()) as { message: Record<string, unknown> };
    expect(json.message).toEqual({
      _id: "m2",
      conversationId: "c1",
      kind: "text",
      text: "hi masked",
      masked: false,
      createdAt: delivered.createdAt.toISOString(),
      mine: true,
    });
    expect(json.message).not.toHaveProperty("senderId");
    expect(sendMessage).toHaveBeenCalledWith(getChatRepo(), "real-sender", "c1", {
      kind: "text",
      text: "hi",
      imagePath: undefined,
    });
  });

  it("does not echo/reconstruct rawText — only what the service returns is sent back", async () => {
    currentUserFromRefresh.mockResolvedValue({ userId: "u1" });
    const delivered = {
      _id: "m3",
      conversationId: "c1",
      senderId: "u1",
      kind: "text",
      text: "***",
      masked: true,
      createdAt: new Date(),
    };
    sendMessage.mockResolvedValue(delivered);
    const res = await POST(postReq({ kind: "text", text: "raw profanity here" }, `${REFRESH_COOKIE}=tok`), ctx("c1"));
    const json = (await res.json()) as { message: Record<string, unknown> };
    expect(json.message).not.toHaveProperty("rawText");
    expect(json.message.text).toBe("***");
  });

  it("maps a service AppError (e.g. FIRST_MSG_TEXT_ONLY) to its status", async () => {
    currentUserFromRefresh.mockResolvedValue({ userId: "u1" });
    sendMessage.mockRejectedValue(new AppError("FIRST_MSG_TEXT_ONLY", "첫 메시지는 글로 보내 주세요.", 400));
    const res = await POST(postReq({ kind: "image", imagePath: "/x.png" }, `${REFRESH_COOKIE}=tok`), ctx("c1"));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: "FIRST_MSG_TEXT_ONLY" });
  });
});
