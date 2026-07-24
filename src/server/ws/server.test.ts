// @vitest-environment node
import { describe, it, expect, afterEach } from "vitest";
import { io as Client, type Socket } from "socket.io-client";
import { signAccessToken } from "@/features/auth/tokens";
import { InMemoryChatRepo } from "@/features/chat/repo";
import { createWsServer } from "./index";

let server: ReturnType<typeof createWsServer> | null = null;
let client: Socket | null = null;

afterEach(() => {
  client?.close();
  server?.close();
});

describe("ws server", () => {
  it("responds pong to ping (authenticated with a real JWT)", async () => {
    server = createWsServer({ repo: new InMemoryChatRepo() });
    // 고정 포트(45123) 대신 임의 빈 포트(0)를 사용해 Windows 환경에서의 포트 충돌을 피한다.
    // listen()이 실제로 바인딩된 포트를 반환하도록 구현되어 있다 (deviation, see task-7-report.md).
    const port = await server.listen(0);
    const token = await signAccessToken({ userId: "user-1", role: "USER" });
    client = Client(`http://localhost:${port}`, {
      transports: ["websocket"],
      auth: { token },
    });
    const pong = await new Promise<string>((resolve) => {
      client!.on("pong", (msg: string) => resolve(msg));
      client!.on("connect", () => client!.emit("ping"));
    });
    expect(pong).toBe("pong");
  });

  it("rejects a connection with no token (real auth replaces the accept-all stub)", async () => {
    server = createWsServer({ repo: new InMemoryChatRepo() });
    const port = await server.listen(0);
    client = Client(`http://localhost:${port}`, { transports: ["websocket"] });
    const err = await new Promise<Error>((resolve) => {
      client!.on("connect_error", (e: Error) => resolve(e));
      client!.on("connect", () => resolve(new Error("should not have connected")));
    });
    expect(err.message).toBe("unauthorized");
    expect(client!.connected).toBe(false);
  });

  it("rejects a connection with a garbage token", async () => {
    server = createWsServer({ repo: new InMemoryChatRepo() });
    const port = await server.listen(0);
    client = Client(`http://localhost:${port}`, {
      transports: ["websocket"],
      auth: { token: "not-a-jwt" },
    });
    const err = await new Promise<Error>((resolve) => {
      client!.on("connect_error", (e: Error) => resolve(e));
      client!.on("connect", () => resolve(new Error("should not have connected")));
    });
    expect(err.message).toBe("unauthorized");
    expect(client!.connected).toBe(false);
  });
});
