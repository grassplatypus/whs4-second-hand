// @vitest-environment node
import { describe, it, expect, vi, afterEach } from "vitest";
import { signState, verifyState, stateCookie, readStateCookie, STATE_COOKIE } from "./state";

describe("state sign/verify", () => {
  it("round-trips a login payload", () => {
    const raw = signState({ mode: "login", provider: "GOOGLE" });
    const p = verifyState(raw, "GOOGLE");
    expect(p?.mode).toBe("login");
    expect(p?.provider).toBe("GOOGLE");
  });

  it("carries userId for link mode", () => {
    const raw = signState({ mode: "link", provider: "KAKAO", userId: "u1" });
    expect(verifyState(raw, "KAKAO")?.userId).toBe("u1");
  });

  it("rejects a tampered payload", () => {
    const raw = signState({ mode: "login", provider: "GOOGLE" });
    const [body, sig] = raw.split(".");
    const forged = Buffer.from('{"mode":"login","provider":"GOOGLE","nonce":"x","exp":9999999999999}').toString("base64url");
    expect(verifyState(`${forged}.${sig}`, "GOOGLE")).toBeNull();
    expect(verifyState(`${body}.deadbeef`, "GOOGLE")).toBeNull();
  });

  it("rejects a provider mismatch", () => {
    const raw = signState({ mode: "login", provider: "GOOGLE" });
    expect(verifyState(raw, "KAKAO")).toBeNull();
  });

  it("rejects garbage and null", () => {
    expect(verifyState(null, "GOOGLE")).toBeNull();
    expect(verifyState("nope", "GOOGLE")).toBeNull();
    expect(verifyState("a.b", "GOOGLE")).toBeNull();
  });

  it("rejects an expired state", () => {
    const raw = signState({ mode: "login", provider: "GOOGLE" });
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 11 * 60 * 1000); // TTL은 10분
    expect(verifyState(raw, "GOOGLE")).toBeNull();
  });

  afterEach(() => {
    vi.useRealTimers();
  });
});

describe("state cookie", () => {
  it("is HttpOnly SameSite=Lax with a 10-minute max-age", () => {
    const h = stateCookie("s1");
    expect(h).toContain(`${STATE_COOKIE}=s1`);
    expect(h).toContain("HttpOnly");
    expect(h).toContain("SameSite=Lax");
    expect(h).toContain("Max-Age=600");
  });

  it("reads the cookie back from a request", () => {
    const req = new Request("http://x/cb", { headers: { cookie: `a=1; ${STATE_COOKIE}=s1; b=2` } });
    expect(readStateCookie(req)).toBe("s1");
  });
});
