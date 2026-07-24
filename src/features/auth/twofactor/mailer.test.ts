// @vitest-environment node
import { describe, it, expect, vi } from "vitest";
import { MemoryMailer } from "./mailer";

describe("MemoryMailer", () => {
  it("captures sent mail (to/subject/body) for test inspection", async () => {
    const mailer = new MemoryMailer();
    await mailer.send("user@example.com", "인증 코드", "인증 코드: 123456 (5분 안에 입력해 주세요)");
    expect(mailer.sent).toHaveLength(1);
    expect(mailer.sent[0]).toEqual({
      to: "user@example.com",
      subject: "인증 코드",
      body: "인증 코드: 123456 (5분 안에 입력해 주세요)",
    });
  });

  it("keeps the code only in the captured body, never logged", async () => {
    const consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const mailer = new MemoryMailer();
    await mailer.send("user@example.com", "인증 코드", "인증 코드: 654321 (5분 안에 입력해 주세요)");
    expect(consoleLogSpy).not.toHaveBeenCalled();
    expect(consoleErrorSpy).not.toHaveBeenCalled();
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });
});
