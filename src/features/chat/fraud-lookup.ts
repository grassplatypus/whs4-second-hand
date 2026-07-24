/**
 * 사기 이력 조회(더치트류) — 데모용 목업.
 *
 * 실제 서비스라면 외부 사기 신고 데이터베이스에 계좌/전화번호를 조회한다. 여기서는 네트워크 없이
 * 결정적으로 동작하는 목을 둔다(같은 번호는 늘 같은 결과). 어댑터만 갈아끼우면 실제 연동이 된다 —
 * 이메일·문자·결제와 같은 방식이다.
 */

export interface FraudLookupResult {
  /** 신고 이력이 있는가. */
  reported: boolean;
  /** 신고 건수(데모: 결정적 해시). */
  count: number;
  /** 조회한 값의 종류. */
  kind: "phone" | "account";
}

export interface FraudLookup {
  check(kind: "phone" | "account", digits: string): Promise<FraudLookupResult>;
}

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

/**
 * 목 어댑터 — 숫자 해시로 결정적 결과를 만든다.
 * 데모에서 "이력 있음"을 보여줄 수 있게, 일부 번호(해시 20% 구간)는 신고 이력이 있다고 답한다.
 */
export const mockFraudLookup: FraudLookup = {
  async check(kind, digits) {
    const h = hash(digits);
    const reported = h % 5 === 0; // 약 20%
    return { reported, count: reported ? (h % 7) + 1 : 0, kind };
  },
};

let lookup: FraudLookup = mockFraudLookup;

/** 테스트·실연동 교체 지점. */
export function setFraudLookup(next: FraudLookup): void {
  lookup = next;
}

export function getFraudLookup(): FraudLookup {
  return lookup;
}
