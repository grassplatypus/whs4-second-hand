/**
 * 한글 음절 → 초성(ㄱㄴㄷ…) 변환. 상품 검색용(제목 선계산 + 쿼리 정규화).
 * 순수 함수: DB/네트워크 접근 없음.
 */
const CHO = [
  "ㄱ",
  "ㄲ",
  "ㄴ",
  "ㄷ",
  "ㄸ",
  "ㄹ",
  "ㅁ",
  "ㅂ",
  "ㅃ",
  "ㅅ",
  "ㅆ",
  "ㅇ",
  "ㅈ",
  "ㅉ",
  "ㅊ",
  "ㅋ",
  "ㅌ",
  "ㅍ",
  "ㅎ",
];

export function toChoseong(text: string): string {
  let out = "";
  for (const ch of text) {
    const code = ch.charCodeAt(0);
    if (code >= 0xac00 && code <= 0xd7a3) out += CHO[Math.floor((code - 0xac00) / 588)];
    else out += ch;
  }
  return out;
}

export function isChoseongQuery(q: string): boolean {
  return q.length > 0 && [...q].every((c) => CHO.includes(c));
}
