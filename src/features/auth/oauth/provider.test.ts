// @vitest-environment node
import { describe, it, expect } from "vitest";
import { getAdapter } from "./provider";
import { AppError } from "@/features/_shared/error";

describe("getAdapter", () => {
  it("returns an adapter per known provider", () => {
    expect(getAdapter("google").provider).toBe("GOOGLE");
    expect(getAdapter("kakao").provider).toBe("KAKAO");
    expect(getAdapter("naver").provider).toBe("NAVER");
  });

  it("is case-insensitive on the provider slug", () => {
    expect(getAdapter("GOOGLE").provider).toBe("GOOGLE");
  });

  it("rejects an unknown provider", () => {
    expect(() => getAdapter("facebook")).toThrow(AppError);
  });
});

describe("mock adapter", () => {
  it("maps the same hint to the same identity (stable re-login)", async () => {
    const a = await getAdapter("kakao").exchange("abc");
    const b = await getAdapter("kakao").exchange("abc");
    expect(a).toEqual(b);
    expect(a.providerUserId).toContain("kakao");
    expect(a.email).toContain("@");
  });

  it("maps different hints to different identities", async () => {
    const a = await getAdapter("kakao").exchange("u1");
    const b = await getAdapter("kakao").exchange("u2");
    expect(a.providerUserId).not.toBe(b.providerUserId);
  });

  it("authorizeUrl round-trips the mock hint into the callback code", async () => {
    const url = new URL(getAdapter("naver").authorizeUrl("state123", "u9"));
    expect(url.pathname).toBe("/api/auth/oauth/naver/callback");
    expect(url.searchParams.get("state")).toBe("state123");
    const code = url.searchParams.get("code")!;
    const info = await getAdapter("naver").exchange(code);
    expect(info).toEqual(await getAdapter("naver").exchange("u9"));
  });

  it("google falls back to mock when keys are absent", async () => {
    // 테스트 env엔 GOOGLE_* 없음 → 목 동작
    const url = new URL(getAdapter("google").authorizeUrl("s", "g1"));
    expect(url.pathname).toBe("/api/auth/oauth/google/callback");
    expect((await getAdapter("google").exchange("g1")).providerUserId).toContain("google");
  });
});
