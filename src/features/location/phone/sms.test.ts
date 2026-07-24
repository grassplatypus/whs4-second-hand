// @vitest-environment node
import { describe, it, expect, vi, afterEach } from "vitest";
import { MemorySms, getSms, setSmsForTest } from "./sms";

describe("MemorySms", () => {
  it("captures the sent code for test inspection (no phone number kept)", async () => {
    const sms = new MemorySms();
    await sms.send("01012345678", "123456");
    expect(sms.sent).toHaveLength(1);
    expect(sms.sent[0]).toEqual({ code: "123456" });
  });

  it("keeps the code only in the captured entry, never logged", async () => {
    const consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const sms = new MemorySms();
    await sms.send("01012345678", "654321");
    expect(consoleLogSpy).not.toHaveBeenCalled();
    expect(consoleErrorSpy).not.toHaveBeenCalled();
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });
});

describe("getSms", () => {
  afterEach(() => setSmsForTest(null));

  it("returns the mock (console) sms adapter when OCTOMO_API_KEY is absent", () => {
    expect(process.env.OCTOMO_API_KEY).toBeFalsy();
    const sms = getSms();
    expect(sms).not.toBeInstanceOf(MemorySms);
  });

  it("caches the instance across calls", () => {
    const a = getSms();
    const b = getSms();
    expect(a).toBe(b);
  });

  it("setSmsForTest overrides the cached instance", () => {
    const mem = new MemorySms();
    setSmsForTest(mem);
    expect(getSms()).toBe(mem);
  });
});
