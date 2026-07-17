import { describe, it, expect, afterEach } from "vitest";
import { io as Client, type Socket } from "socket.io-client";
import { createWsServer } from "./index";

let server: ReturnType<typeof createWsServer> | null = null;
let client: Socket | null = null;

afterEach(() => {
  client?.close();
  server?.close();
});

describe("ws server", () => {
  it("responds pong to ping", async () => {
    server = createWsServer();
    // 고정 포트(45123) 대신 임의 빈 포트(0)를 사용해 Windows 환경에서의 포트 충돌을 피한다.
    // listen()이 실제로 바인딩된 포트를 반환하도록 구현되어 있다 (deviation, see task-7-report.md).
    const port = await server.listen(0);
    client = Client(`http://localhost:${port}`, { transports: ["websocket"] });
    const pong = await new Promise<string>((resolve) => {
      client!.on("pong", (msg: string) => resolve(msg));
      client!.on("connect", () => client!.emit("ping"));
    });
    expect(pong).toBe("pong");
  });
});
