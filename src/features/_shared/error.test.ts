import { describe, it, expect } from "vitest";
import { AppError, toClientError, withErrorHandling } from "./error";

describe("toClientError", () => {
  it("passes through AppError code and message", () => {
    const { body, status } = toClientError(new AppError("NOT_FOUND", "찾을 수 없어요", 404));
    expect(body).toEqual({ code: "NOT_FOUND", message: "찾을 수 없어요" });
    expect(status).toBe(404);
  });

  it("masks unknown errors (no internal detail)", () => {
    const { body, status } = toClientError(new Error("DB stack trace: table users column secret"));
    expect(status).toBe(500);
    expect(body.code).toBe("INTERNAL");
    expect(body.message).not.toContain("stack");
    expect(body.message).not.toContain("users");
  });

  it("does not leak raw message in client body", () => {
    const { body } = toClientError(new Error("raw internal"));
    // 클라이언트 바디엔 raw 미포함 (로그로만)
    expect(body.message).not.toContain("raw internal");
  });
});

describe("withErrorHandling", () => {
  it("passes AppError with correct status and body", async () => {
    const handler = withErrorHandling(async () => {
      throw new AppError("NOT_FOUND", "찾을 수 없어요", 404);
    });
    const response = await handler(new Request("http://x"));
    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body).toEqual({ code: "NOT_FOUND", message: "찾을 수 없어요" });
  });

  it("masks unknown errors to internal with 500", async () => {
    const handler = withErrorHandling(async () => {
      throw new Error("secret db detail");
    });
    const response = await handler(new Request("http://x"));
    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.code).toBe("INTERNAL");
    expect(body.message).not.toContain("secret");
    expect(body.message).not.toContain("db");
  });

  it("passes through normal responses unchanged", async () => {
    const handler = withErrorHandling(async () => {
      return Response.json({ ok: true });
    });
    const response = await handler(new Request("http://x"));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ ok: true });
  });
});
