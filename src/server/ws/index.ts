import { Server, type Socket } from "socket.io";
import { createServer, type Server as HttpServer } from "node:http";
import { authenticateSocket } from "./auth";
import { getChatRepo, type ChatRepo } from "@/features/chat/repo";
import { sendMessage, type SendMessageInput, type DeliveredMessage } from "@/features/chat/service";
import { AppError } from "@/features/_shared/error";
import { getEnv } from "@/features/_shared/env";

export interface WsServerOptions {
  /** 테스트에서 InMemoryChatRepo를 주입한다. 기본값은 운영용 MongoChatRepo(getChatRepo()). */
  repo?: ChatRepo;
}

interface SocketData {
  userId: string;
}

interface MessagePayload {
  conversationId: string;
  kind: "text" | "image";
  text?: string;
  imagePath?: string;
}

/** conversationId 하나당 room 하나 — 참여자만 join하므로 이 room으로의 emit은 곧 참여자에게만 전달된다. */
function roomFor(conversationId: string): string {
  return `conv:${conversationId}`;
}

function userIdOf(socket: Socket): string {
  return (socket.data as SocketData).userId;
}

/**
 * 받는 사람 기준으로 다듬은 메시지 — REST(GET/POST .../messages)가 내려주는 모양과 똑같다.
 * senderId(상대의 원본 userId)는 싣지 않고, 서버가 각 소켓의 인증된 userId로 계산한 mine만 넣는다.
 * rawText(마스킹 전 원문)는 애초에 DeliveredMessage에 없다 — 여기서도 필드를 하나씩 골라 담아 새어 나갈 길을 없앤다.
 */
function toMessageView(message: DeliveredMessage, userId: string) {
  return {
    _id: message._id,
    conversationId: message.conversationId,
    kind: message.kind,
    text: message.text,
    imagePath: message.imagePath,
    masked: message.masked,
    createdAt: message.createdAt,
    mine: message.senderId === userId,
    ...(message.sensitive?.length ? { sensitive: message.sensitive } : {}),
  };
}

export function createWsServer(options: WsServerOptions = {}) {
  const repo = options.repo ?? getChatRepo();
  const http: HttpServer = createServer();
  const io = new Server(http, { cors: { origin: "*" } });

  io.use((socket, next) => {
    authenticateSocket(socket.handshake.auth?.token)
      .then((auth) => {
        if (!auth) {
          next(new Error("unauthorized"));
          return;
        }
        (socket.data as SocketData).userId = auth.userId;
        next();
      })
      .catch(() => next(new Error("unauthorized")));
  });

  io.on("connection", (socket) => {
    socket.on("ping", () => socket.emit("pong", "pong"));

    // 참여자(구매자/판매자)만 room에 join한다 — 대화가 없거나 비참여자면 join하지 않고
    // 발신자에게 error만 emit한다. join되지 않으므로 이후 해당 room으로의 broadcast를
    // 절대 받지 못한다(엿듣기 방지).
    socket.on("join", (conversationId: string) => {
      void (async () => {
        try {
          const conversation = await repo.getConversation(conversationId);
          const userId = userIdOf(socket);
          if (!conversation || (conversation.buyerId !== userId && conversation.sellerId !== userId)) {
            socket.emit("error", { code: "FORBIDDEN" });
            return;
          }
          await socket.join(roomFor(conversationId));
        } catch {
          socket.emit("error", { code: "INTERNAL" });
        }
      })();
    });

    // 저장/권한/차단/첫메시지/마스킹 규칙은 전부 서비스가 강제한다(WS는 얇은 어댑터).
    // 서비스가 던지는 AppError는 발신자에게만 error로 전달하고, 소켓/서버는 죽지 않는다.
    socket.on("message", (payload: MessagePayload) => {
      void (async () => {
        const userId = userIdOf(socket);
        try {
          const input: SendMessageInput = {
            kind: payload?.kind,
            text: payload?.text,
            imagePath: payload?.imagePath,
          };
          const delivered = await sendMessage(repo, userId, payload?.conversationId, input);
          // room 전체에 한 번에 쏘면 원본 그대로(senderId 포함) 나가므로, 소켓별로 mine을 계산해 따로 보낸다.
          // room에 들어와 있는 소켓만 대상이라 참여자 격리(엿듣기 방지)는 그대로 유지된다.
          const sockets = await io.in(roomFor(payload.conversationId)).fetchSockets();
          for (const target of sockets) {
            target.emit("message", toMessageView(delivered, (target.data as SocketData).userId));
          }
        } catch (err) {
          if (err instanceof AppError) {
            socket.emit("error", { code: err.code });
          } else {
            console.error("[ws][UNHANDLED]", err instanceof Error ? err.name : "unknown");
            socket.emit("error", { code: "INTERNAL" });
          }
        }
      })();
    });
  });

  return {
    io,
    // 실제로 바인딩된 포트를 반환한다 (0을 넘기면 OS가 빈 포트를 골라준다).
    listen: (port: number) =>
      new Promise<number>((resolve) => {
        http.listen(port, () => {
          const address = http.address();
          const boundPort = typeof address === "object" && address ? address.port : port;
          resolve(boundPort);
        });
      }),
    close: () => {
      io.close();
    },
  };
}

// 컨테이너 엔트리: 직접 실행 시 기동
if (process.env.WS_STANDALONE === "1") {
  const env = getEnv();
  createWsServer()
    .listen(env.WS_PORT)
    .then((boundPort) => console.log(`[ws] listening on ${boundPort}`));
}
