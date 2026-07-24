// @vitest-environment node
import { describe, it, expect, afterEach } from "vitest";
import { io as Client, type Socket } from "socket.io-client";
import { signAccessToken } from "@/features/auth/tokens";
import { InMemoryChatRepo } from "@/features/chat/repo";
import { createWsServer } from "./index";

const BUYER_ID = "buyer-1";
const SELLER_ID = "seller-1";
const OTHER_ID = "other-1"; // 대화의 참여자가 아닌 제3자

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 이벤트가 오면 resolve, timeoutMs 안에 안 오면 null로 resolve(수신하지 않았음을 증명하는 용도). */
function waitForEventOrNull<T>(socket: Socket, event: string, timeoutMs = 300): Promise<T | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), timeoutMs);
    socket.once(event, (payload: T) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}

async function connectAs(port: number, userId: string): Promise<Socket> {
  const token = await signAccessToken({ userId, role: "USER" });
  const socket = Client(`http://localhost:${port}`, {
    transports: ["websocket"],
    auth: { token },
  });
  await new Promise<void>((resolve) => socket.on("connect", () => resolve()));
  return socket;
}

describe("ws chat events (auth + rooms + broadcast)", () => {
  let server: ReturnType<typeof createWsServer> | null = null;
  const sockets: Socket[] = [];

  afterEach(() => {
    for (const s of sockets.splice(0)) s.close();
    server?.close();
    server = null;
  });

  async function setup() {
    const repo = new InMemoryChatRepo();
    const conversation = await repo.createConversation({
      productId: "product-1",
      sellerId: SELLER_ID,
      buyerId: BUYER_ID,
      createdAt: new Date(),
      lastMessageAt: new Date(),
    });
    server = createWsServer({ repo });
    const port = await server.listen(0);
    return { repo, conversation, port };
  }

  it("only joins a participant to the room; a non-participant's join is rejected", async () => {
    const { conversation, port } = await setup();

    const buyer = await connectAs(port, BUYER_ID);
    const other = await connectAs(port, OTHER_ID);
    sockets.push(buyer, other);

    const otherError = waitForEventOrNull<{ code: string }>(other, "error");
    buyer.emit("join", conversation._id);
    other.emit("join", conversation._id);

    expect(await otherError).toEqual({ code: "FORBIDDEN" });
  });

  it("room isolation: broadcasts a message only to participants who joined, masked, via the service", async () => {
    const { conversation, port } = await setup();

    const buyer = await connectAs(port, BUYER_ID);
    const seller = await connectAs(port, SELLER_ID);
    const other = await connectAs(port, OTHER_ID);
    sockets.push(buyer, seller, other);

    buyer.emit("join", conversation._id);
    seller.emit("join", conversation._id);
    other.emit("join", conversation._id); // rejected by the server, never joins the room
    await delay(50);

    const sellerMessage = waitForEventOrNull<Record<string, unknown>>(seller, "message");
    const otherMessage = waitForEventOrNull<Record<string, unknown>>(other, "message");

    buyer.emit("message", { conversationId: conversation._id, kind: "text", text: "시발 이거 얼마예요" });

    const [received, notReceived] = await Promise.all([sellerMessage, otherMessage]);

    expect(received).not.toBeNull();
    expect(received!.text).not.toContain("시발");
    expect(received!.text).toContain("*");
    expect(received!.masked).toBe(true);
    // 상대의 원본 userId는 실어 보내지 않는다 — 받는 쪽 기준으로 계산한 mine만 내려간다(REST와 동일).
    expect(received).not.toHaveProperty("senderId");
    expect(received).not.toHaveProperty("rawText");
    expect(received!.mine).toBe(false);

    // 제3자는 room에 join되지 않았으므로 room으로의 broadcast를 절대 받지 못한다(엿듣기 방지).
    expect(notReceived).toBeNull();
  });

  it("computes mine per recipient: the sender gets mine=true, the other side mine=false, and nobody gets senderId", async () => {
    const { conversation, port } = await setup();

    const buyer = await connectAs(port, BUYER_ID);
    const seller = await connectAs(port, SELLER_ID);
    sockets.push(buyer, seller);

    buyer.emit("join", conversation._id);
    seller.emit("join", conversation._id);
    await delay(50);

    const buyerCopy = waitForEventOrNull<Record<string, unknown>>(buyer, "message");
    const sellerCopy = waitForEventOrNull<Record<string, unknown>>(seller, "message");

    buyer.emit("message", { conversationId: conversation._id, kind: "text", text: "안녕하세요" });

    const [mineForSender, mineForOther] = await Promise.all([buyerCopy, sellerCopy]);

    expect(mineForSender).not.toBeNull();
    expect(mineForOther).not.toBeNull();
    // 같은 메시지지만 받는 사람에 따라 mine이 다르게 계산된다.
    expect(mineForSender!._id).toBe(mineForOther!._id);
    expect(mineForSender!.mine).toBe(true);
    expect(mineForOther!.mine).toBe(false);
    for (const copy of [mineForSender!, mineForOther!]) {
      expect(copy).not.toHaveProperty("senderId");
      expect(copy).not.toHaveProperty("rawText");
    }
  });

  it("a non-participant's message is rejected by the service (error to sender, no broadcast)", async () => {
    const { conversation, port } = await setup();

    const seller = await connectAs(port, SELLER_ID);
    const other = await connectAs(port, OTHER_ID);
    sockets.push(seller, other);

    seller.emit("join", conversation._id);
    await delay(50);

    const sellerMessage = waitForEventOrNull<Record<string, unknown>>(seller, "message");
    const otherError = waitForEventOrNull<{ code: string }>(other, "error");

    other.emit("message", { conversationId: conversation._id, kind: "text", text: "몰래 보냄" });

    expect(await otherError).toEqual({ code: "FORBIDDEN" });
    // 서비스가 거부했으므로 저장/브로드캐스트는 일어나지 않는다.
    expect(await sellerMessage).toBeNull();
  });
});
