import { describe, expect, it } from "vitest";
import { isChoseongQuery, toChoseong } from "./choseong";

describe("toChoseong", () => {
  it("converts a Hangul word to its initial consonants", () => {
    expect(toChoseong("사과")).toBe("ㅅㄱ");
  });

  it("passes non-Hangul characters through unchanged in a mixed string", () => {
    expect(toChoseong("아이폰12")).toBe("ㅇㅇㅍ12");
  });

  it("returns an empty string for empty input", () => {
    expect(toChoseong("")).toBe("");
  });

  it("passes through pure ASCII/digit strings unchanged", () => {
    expect(toChoseong("iphone12")).toBe("iphone12");
  });
});

describe("isChoseongQuery", () => {
  it("is true for a query made entirely of initial consonants", () => {
    expect(isChoseongQuery("ㅅㄱ")).toBe(true);
  });

  it("is false for a full Hangul word", () => {
    expect(isChoseongQuery("사과")).toBe(false);
  });

  it("is false for an empty string", () => {
    expect(isChoseongQuery("")).toBe(false);
  });

  it("is false when mixed with non-choseong characters", () => {
    expect(isChoseongQuery("ㅅㄱ12")).toBe(false);
  });
});
