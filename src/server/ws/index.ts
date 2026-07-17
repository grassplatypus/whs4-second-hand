import { Server } from "socket.io";
import { createServer, type Server as HttpServer } from "node:http";
import { verifyTokenStub } from "./auth-stub";

export function createWsServer() {
  const http: HttpServer = createServer();
  const io = new Server(http, { cors: { origin: "*" } });

  io.use((socket, next) => {
    const { userId } = verifyTokenStub(socket.handshake.auth?.token);
    (socket.data as { userId: string | null }).userId = userId; // #1에서 미인증 거부로 강화
    next();
  });

  io.on("connection", (socket) => {
    socket.on("ping", () => socket.emit("pong", "pong"));
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
  const port = Number(process.env.WS_PORT ?? 4000);
  createWsServer()
    .listen(port)
    .then((boundPort) => console.log(`[ws] listening on ${boundPort}`));
}
