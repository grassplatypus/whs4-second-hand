import { describe, it, expect, vi } from "vitest";
import { AppError, toClientError } from "./error";

describe("toClientError", () => {
  it("passes through AppError code and message", () => {
    const { body, status } = toClientError(new AppError("NOT_FOUND", "찾을 수 없어요", 404), true);
    expect(body).toEqual({ code: "NOT_FOUND", message: "찾을 수 없어요" });
    expect(status).toBe(404);
  });

  it("masks unknown errors in prod (no internal detail)", () => {
    const { body, status } = toClientError(new Error("DB stack trace: table users column secret"), true);
    expect(status).toBe(500);
    expect(body.code).toBe("INTERNAL");
    expect(body.message).not.toContain("stack");
    expect(body.message).not.toContain("users");
  });

  it("does not leak raw message even in dev body", () => {
    const { body } = toClientError(new Error("raw internal"), false);
    // dev도 클라이언트 바디엔 raw 미포함 (로그로만)
    expect(body.message).not.toContain("raw internal");
  });
});
