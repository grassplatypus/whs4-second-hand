// @vitest-environment node
import { describe, it, expect } from "vitest";
import { maskProfanity } from "./filter";

/**
 * 외부 비속어 사전(한국어 korcen · 영어 leo-profanity) 결합 확인.
 * 우리 목록에 없던 말도 걸러지고, 평범한 거래 대화는 그대로 지나가야 한다.
 */
describe("외부 사전과 결합한 비속어 가리기", () => {
  it("우리 목록에 없는 한국어 욕도 걸러낸다", () => {
    const { masked, hit } = maskProfanity("이 상품 좆같네");
    expect(hit).toBe(true);
    expect(masked).not.toContain("좆같네");
  });

  it("영어 욕도 걸러낸다", () => {
    const { masked, hit } = maskProfanity("what a shit deal");
    expect(hit).toBe(true);
    expect(masked).not.toContain("shit");
    expect(masked).toContain("what a");
  });

  it("문장부호가 붙어도 알아본다", () => {
    expect(maskProfanity("shit!").hit).toBe(true);
  });

  it("평범한 거래 대화는 건드리지 않는다", () => {
    for (const text of [
      "좋은 상품 감사합니다",
      "가격 15,000원에 팔아요",
      "국민 110-234-567890 으로 보내주세요",
      "내일 잠실역에서 뵐게요",
      "shipping is classic and fast",
    ]) {
      const { masked, hit } = maskProfanity(text);
      expect(hit, text).toBe(false);
      expect(masked).toBe(text);
    }
  });
});
