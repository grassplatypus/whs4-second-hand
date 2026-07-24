import { describe, it, expect } from "vitest";
import { scanSensitive } from "./sensitive";

describe("scanSensitive — 전화번호 탐지", () => {
  it("평범한 휴대폰 번호를 찾는다", () => {
    const r = scanSensitive("연락처는 010-1234-5678이에요");
    expect(r.hasPhone).toBe(true);
    expect(r.spans).toHaveLength(1);
  });

  it("띄어쓰기·점으로 나눠 써도 찾는다", () => {
    expect(scanSensitive("010 1234 5678").hasPhone).toBe(true);
    expect(scanSensitive("010.1234.5678").hasPhone).toBe(true);
  });

  it("필터를 피하려고 바꿔 쓴 표기도 찾는다(영1영-5O14-6@977)", () => {
    const r = scanSensitive("영1영-5O14-6@977 로 연락 주세요");
    expect(r.hasPhone).toBe(true);
  });

  it("한글 수사로만 써도 찾는다(공일공 삼2사5 육칠팔구)", () => {
    expect(scanSensitive("공일공 삼2사5 육칠팔구").hasPhone).toBe(true);
  });

  it("강조할 구간이 원문 위치와 맞는다", () => {
    const text = "번호 010-1234-5678 여기요";
    const { spans } = scanSensitive(text);
    expect(text.slice(spans[0].start, spans[0].end)).toBe("010-1234-5678");
  });
});

describe("scanSensitive — 계좌번호 탐지", () => {
  it("긴 숫자열을 계좌번호 후보로 본다", () => {
    const r = scanSensitive("우리 1002-345-678901 로 보내주세요");
    expect(r.hasAccount).toBe(true);
  });

  it("전화번호는 계좌번호로 세지 않는다", () => {
    const r = scanSensitive("01012345678");
    expect(r.hasPhone).toBe(true);
    expect(r.hasAccount).toBe(false);
  });
});

describe("scanSensitive — 오탐 방지", () => {
  it("가격·짧은 숫자는 잡지 않는다", () => {
    expect(scanSensitive("15만원에 드릴게요").spans).toHaveLength(0);
    expect(scanSensitive("3시에 만나요").spans).toHaveLength(0);
    expect(scanSensitive("가격 150000원").spans).toHaveLength(0);
  });

  it("일반 대화는 잡지 않는다", () => {
    expect(scanSensitive("안녕하세요 오늘 저녁에 가능할까요?").spans).toHaveLength(0);
  });
});

describe("scanSensitive — 은행 이름과 함께", () => {
  it("은행 이름이 있으면 짧은 계좌 형태도 잡는다", () => {
    const r = scanSensitive("국민 123-456-78901 로 입금 부탁해요");
    expect(r.hasAccount).toBe(true);
  });

  it("은행 이름이 없고 짧은 숫자면 잡지 않는다", () => {
    expect(scanSensitive("사이즈 123-456").spans).toHaveLength(0);
  });
});
