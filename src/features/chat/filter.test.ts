import { describe, expect, it } from "vitest";
import { maskProfanity, normalize } from "./filter";

describe("normalize", () => {
  it("removes whitespace", () => {
    expect(normalize("시 발")).toBe("시발");
  });

  it("removes punctuation/special chars", () => {
    expect(normalize("ㅅ.ㅂ")).toBe("ㅅㅂ");
    expect(normalize("시-발!")).toBe("시발");
  });

  it("case-folds latin letters", () => {
    expect(normalize("ABC")).toBe("abc");
  });

  it("strips digits interspersed as evasion", () => {
    expect(normalize("시1발")).toBe("시발");
  });

  it("collapses runs of 2+ repeated chars to a single char", () => {
    expect(normalize("ㅋㅋㅋㅋ")).toBe("ㅋ");
    expect(normalize("시이이이발")).toBe("시이발");
  });

  it("leaves already-clean text unchanged (aside from case-fold)", () => {
    expect(normalize("안녕하세요")).toBe("안녕하세요");
  });
});

describe("maskProfanity", () => {
  it("detects and masks a direct profanity", () => {
    const { masked, hit } = maskProfanity("시발");
    expect(hit).toBe(true);
    expect(masked).not.toContain("시발");
    expect(masked).toContain("*");
  });

  it("detects the ㅅㅂ initial-consonant evasion", () => {
    const { masked, hit } = maskProfanity("ㅅㅂ");
    expect(hit).toBe(true);
    expect(masked).toBe("**");
  });

  it("detects the '시 발' spacing evasion", () => {
    const { masked, hit } = maskProfanity("시 발");
    expect(hit).toBe(true);
    expect(masked).not.toContain("시발");
    expect(masked).toBe("***");
  });

  it("detects the '시1발' digit-insertion evasion", () => {
    const { masked, hit } = maskProfanity("시1발");
    expect(hit).toBe(true);
    expect(masked).not.toContain("시발");
  });

  it("detects the vowel-elongation evasion '시이이발'", () => {
    const { masked, hit } = maskProfanity("시이이발");
    expect(hit).toBe(true);
    expect(masked).not.toContain("시발");
  });

  it("masks multiple profanities in one message, independently", () => {
    const { masked, hit } = maskProfanity("시발 병신");
    expect(hit).toBe(true);
    expect(masked).not.toContain("시발");
    expect(masked).not.toContain("병신");
    expect(masked).toBe("** **");
  });

  it("leaves clean text fully unchanged", () => {
    const input = "안녕하세요 반갑습니다";
    const { masked, hit } = maskProfanity(input);
    expect(hit).toBe(false);
    expect(masked).toBe(input);
  });

  it("does not false-positive on an obviously benign word", () => {
    const { masked, hit } = maskProfanity("행복");
    expect(hit).toBe(false);
    expect(masked).toBe("행복");
  });

  it("masks only the profane part of a mixed clean+profane message", () => {
    const { masked, hit } = maskProfanity("안녕 시발 이야");
    expect(hit).toBe(true);
    expect(masked).toBe("안녕 ** 이야");
  });
});
