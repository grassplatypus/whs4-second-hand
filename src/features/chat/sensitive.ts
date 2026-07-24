/**
 * 채팅 메시지에서 전화번호·계좌번호로 보이는 부분을 찾아낸다.
 *
 * 중고거래 사기는 대개 "채팅 밖으로 데려가기"(전화·계좌 직거래 유도)에서 시작한다.
 * 그래서 숫자를 그대로 쓴 경우뿐 아니라, 필터를 피하려고 바꿔 쓴 표기까지 잡는다:
 *   "영1영-5O14-6@977"  → 0 1 0 - 5 0 1 4 - 6 9 7 7  (한글 수사, 알파벳 O/I/l, 사이 기호)
 *   "공일공 삼2사5 육칠팔구"                          (한글 수사 혼용)
 *
 * 잡아도 차단하지는 않는다 — "전화번호를 보냈어요"라고 알리고 그 부분에 밑줄을 그어
 * 스스로 조심하게 한다.
 *
 * 정확도에 대해: 이 기능은 **틀린 번호를 잡는 것이 못 잡는 것보다 나쁘다.**
 * 감지한 번호로 사기 이력을 조회해 주기 때문에, 엉뚱한 숫자가 섞이면
 * "신고된 적 없는 번호예요"라는 거짓 안심을 주게 된다. 그래서 아래 두 가지를 지킨다.
 *   1. 숫자는 **한 덩어리 안에서만** 이어 붙인다(띄어 쓰면 다른 숫자로 본다).
 *      "15000 13000 어떠세요"(가격 흥정)가 계좌로 둔갑하지 않는다.
 *   2. 띄어 쓴 조각을 합치는 건 **번호를 끊어 적은 형태로 보일 때만** 허용한다.
 *      "010 1234 5678"은 합치고, "45000 40000 35000"은 합치지 않는다.
 */

/** 숫자로 읽힐 수 있는 문자 → 실제 숫자. (한글 수사·발음 유사 알파벳·유사 기호) */
const DIGIT_ALIASES: Record<string, string> = {
  영: "0", 공: "0", 빵: "0", o: "0", O: "0", ｏ: "0", Ｏ: "0", ㅇ: "0",
  일: "1", l: "1", I: "1", i: "1", "|": "1", ｌ: "1",
  이: "2", z: "2", Z: "2",
  삼: "3",
  사: "4", A: "4",
  오: "5", s: "5", S: "5",
  육: "6", b: "6", G: "6",
  칠: "7", T: "7",
  팔: "8", B: "8",
  구: "9", g: "9", q: "9",
};

/** 한글 수사(영/일/이…) — 흔한 일상 글자라 숫자로 읽는 조건이 따로 있다. */
const HANGUL_NUMERALS = new Set("영공빵일이삼사오육칠팔구ㅇ");

/** 한 글자를 숫자로 바꾼다(바꿀 수 없으면 null). */
function toDigit(ch: string): string | null {
  if (ch >= "0" && ch <= "9") return ch;
  return DIGIT_ALIASES[ch] ?? null;
}

function isRealDigit(ch: string): boolean {
  return ch >= "0" && ch <= "9";
}

export interface SensitiveSpan {
  /** 원문에서의 시작 위치(포함). */
  start: number;
  /** 원문에서의 끝 위치(제외). */
  end: number;
  kind: "phone" | "account";
  /** 숫자를 한글·알파벳 등으로 바꿔 쓴 흔적이 있는가(있으면 경고 수위를 올린다). */
  evasive: boolean;
  /** 이 구간에서 읽어낸 숫자만 모은 값 — 사기 이력 조회에 이 값을 쓴다. */
  digits: string;
}

export interface SensitiveScan {
  spans: SensitiveSpan[];
  hasPhone: boolean;
  hasAccount: boolean;
  /** 하나라도 우회 표기가 있으면 true — 단순 안내가 아니라 경고를 띄운다. */
  hasEvasive: boolean;
}

/**
 * 한 덩어리 안에서 숫자 사이에 끼워 넣는 구분자(무시한다).
 * 공백·줄바꿈·별표는 여기 없다 — 그건 덩어리를 나누는 자리다(아래 참고).
 */
const INNER_SEPARATORS = new Set([
  "-", ".", "/", "_", "#", "(", ")", "[", "]", "{", "}", "'", '"',
  "·", "‑", "–", "—", "@", "+", ":", ";",
]);

/**
 * 덩어리를 나누는 자리 — 여기서 끊고, 나중에 "번호를 끊어 적은 것"으로 보이면 다시 합친다.
 * 별표(*)가 여기 있는 이유: 저장되는 본문은 비속어가 `*`로 가려진 상태라,
 * 이걸 그냥 무시하면 "010-1234-5678 ** 3333011234567"이 한 덩어리로 읽혀 아무것도 아닌 길이가 된다.
 * 반대로 끊기만 하면 "010*1234*5678"을 놓치므로, 끊되 합치기 후보로 남긴다.
 */
const CHUNK_BREAKS = new Set([" ", "\t", "\n", "\r", "*"]);

/** 원문에서 잘라낸 숫자 덩어리 하나. */
interface Chunk {
  start: number;
  /** 끝 위치(제외). */
  end: number;
  digits: string;
  evasive: boolean;
  /** 이 덩어리와 다음 덩어리 사이에 다른 글자가 끼어 있었는가(끼어 있으면 합치지 않는다). */
  brokenAfter: boolean;
  /** 다음 덩어리와의 사이에 하이픈 같은 구분자가 있었는가 — "3333 - 01 - 1234567"을 이어 붙이는 단서. */
  separatorAfter: boolean;
  /** 구분자로 나뉜 마디들의 길이 — "110-234-567890"이면 [3,3,6]. 가격 범위를 걸러내는 데 쓴다. */
  groupSizes: number[];
}

/**
 * 가격 범위를 번호로 오해하지 않게 한다.
 *
 * "15000-20000원"은 마디가 둘이고 둘 다 넉넉히 길다 — 실제 계좌·전화번호는 이렇게 안 쓴다
 * (마디가 셋 이상이거나, 아예 구분자 없이 붙여 쓴다).
 */
function looksLikeNumberRange(groupSizes: number[]): boolean {
  return groupSizes.length === 2 && groupSizes.every((n) => n >= 4);
}

/**
 * 한글 수사를 숫자로 읽어도 되는 자리인지 본다.
 *
 * "공일공"처럼 수사가 세 자 이상 이어지거나, "삼2사5"처럼 **뒤에** 진짜 숫자가 이어지면 번호로 본다.
 * 뒤쪽만 보는 이유는 "5678이에요"의 '이' 때문이다 — 앞에 숫자가 있다고 인정해 버리면
 * 조사·어미가 번호에 붙는다. 같은 이유로 "15000 25000 사이에서"의 "사이"도 그냥 낱말로 남는다.
 */
function hangulRunIsNumeric(text: string, from: number, to: number): boolean {
  if (to - from >= 3) return true;

  let after = to;
  while (after < text.length && INNER_SEPARATORS.has(text[after]!)) after++;
  return after < text.length && isRealDigit(text[after]!);
}

/** 한글 음절인가(수사가 낱말의 일부인지 보는 데 쓴다). */
function isHangulSyllable(ch: string | undefined): boolean {
  return ch !== undefined && ch >= "가" && ch <= "힣";
}

/**
 * 한글 수사 구간에서 **조사·어미로 보이는 끝 글자**를 떼어낸다.
 *
 * "…오육칠팔이에요"의 '이'는 수사가 아니라 서술격 조사다. 이걸 2로 읽으면 번호에 없는 숫자가
 * 하나 더 붙어, 사기 이력 조회가 엉뚱한 번호로 나간다. 구간 뒤에 곧바로 다른 한글이 붙어 있으면
 * 마지막 한 글자는 낱말의 일부로 본다.
 */
function trimHangulTail(text: string, from: number, to: number): number {
  if (to - from < 2) return to;
  return isHangulSyllable(text[to]) ? to - 1 : to;
}

/** 원문을 훑어 숫자 덩어리들을 찾는다(덩어리 안에서만 숫자를 이어 붙인다). */
function scanChunks(text: string): Chunk[] {
  const chunks: Chunk[] = [];
  let start = -1;
  let digits = "";
  let lastIdx = -1;
  let evasive = false;
  /** 이 덩어리에 진짜 숫자(0-9)가 하나라도 있었는가. */
  let hasRealDigit = false;
  /** 이 덩어리에 한글 수사가 쓰였는가. */
  let usedHangul = false;
  /** 덩어리가 끝난 뒤 지금까지 본 문자가 "나누는 자리"뿐이었는가. */
  let onlyBreaksSinceLastChunk = true;

  let groupSizes: number[] = [];
  let currentGroup = 0;

  /** 구분자를 만났다 — 지금까지 이어진 마디를 닫는다("110-234-567890"이면 3,3,6). */
  const closeGroup = () => {
    if (currentGroup > 0) {
      groupSizes.push(currentGroup);
      currentGroup = 0;
    }
  };

  const flush = (broken: boolean) => {
    closeGroup();
    // 알파벳만 숫자로 읽어 만든 덩어리는 버린다 — 영어 낱말이 번호로 둔갑하지 않게.
    // (한글 수사만으로 쓴 "공일공"은 명백한 우회 표기라 그대로 둔다.)
    const alphaOnly = !hasRealDigit && evasive && !usedHangul;
    if (start >= 0 && digits.length > 0 && !alphaOnly) {
      chunks.push({ start, end: lastIdx + 1, digits, evasive, brokenAfter: broken, separatorAfter: false, groupSizes });
    }
    start = -1;
    digits = "";
    lastIdx = -1;
    evasive = false;
    hasRealDigit = false;
    usedHangul = false;
    groupSizes = [];
    currentGroup = 0;
  };

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;

    if (CHUNK_BREAKS.has(ch)) {
      flush(false); // 띄어 쓴 것뿐이라 합치기 후보로 남긴다
      continue;
    }

    let d: string | null = null;
    if (isRealDigit(ch)) {
      d = ch;
    } else if (HANGUL_NUMERALS.has(ch)) {
      // 이어진 한글 수사 구간은 통째로 판단하고 통째로 소비한다.
      // (글자마다 다시 따지면 "공일공"의 '일'부터가 두 자짜리 구간으로 보여 번호가 잘린다.)
      let runEnd = i;
      while (runEnd < text.length && HANGUL_NUMERALS.has(text[runEnd]!)) runEnd++;
      const consumedEnd = runEnd; // 낱말 판정과 무관하게 이 구간은 통째로 지나간다
      const end = trimHangulTail(text, i, runEnd); // 끝에 붙은 조사·어미는 뗀다
      if (end <= i || !hangulRunIsNumeric(text, i, end)) {
        flush(true); // 낱말이다 — 여기서 끊고 합치기도 막는다
        i = consumedEnd - 1;
        onlyBreaksSinceLastChunk = false;
        continue;
      }
      if (start < 0) {
        start = i;
        if (chunks.length > 0 && !onlyBreaksSinceLastChunk) {
          chunks[chunks.length - 1].brokenAfter = true;
        }
        onlyBreaksSinceLastChunk = true;
      }
      for (let k = i; k < end; k++) {
        digits += toDigit(text[k]!)!;
        currentGroup += 1;
        evasive = true; // 한글로 바꿔 썼다면 우회 표기
        usedHangul = true;
      }
      lastIdx = end - 1;
      if (end < consumedEnd) {
        // 뒤에 조사가 붙어 있었다 — 여기서 덩어리를 닫는다.
        flush(true);
        i = consumedEnd - 1;
        onlyBreaksSinceLastChunk = false;
        continue;
      }
      i = end - 1;
      continue;
    } else if (toDigit(ch) !== null) {
      d = toDigit(ch);
    }

    if (d !== null) {
      if (start < 0) {
        start = i;
        // 직전 덩어리와 이 덩어리 사이에 다른 글자가 있었으면 합치지 않는다.
        if (chunks.length > 0 && !onlyBreaksSinceLastChunk) {
          chunks[chunks.length - 1].brokenAfter = true;
        }
        onlyBreaksSinceLastChunk = true;
      }
      if (isRealDigit(ch)) hasRealDigit = true;
      else evasive = true;
      digits += d;
      currentGroup += 1;
      lastIdx = i;
      continue;
    }

    // 구분자는 덩어리 안이든 밖이든 그냥 지나간다.
    // (밖에서 끊어 버리면 "010 - 1234 - 5678"처럼 하이픈 양옆을 띄어 쓴 표기를 통째로 놓친다.)
    if (INNER_SEPARATORS.has(ch)) {
      closeGroup();
      if (start < 0 && chunks.length > 0) chunks[chunks.length - 1].separatorAfter = true;
      continue;
    }
    flush(true); // 다른 글자를 만났다 — 여기서 끊고 합치기도 막는다
    onlyBreaksSinceLastChunk = false;
  }
  flush(true);
  return chunks;
}

/** 한국 휴대폰/지역번호로 보이는 자릿수 패턴. */
function looksLikePhone(digits: string): boolean {
  if (digits.length === 11 && digits.startsWith("01")) return true;
  if (digits.length === 10 && digits.startsWith("0")) return true;
  if (digits.length === 9 && digits.startsWith("02")) return true;
  // 국가번호를 붙인 표기(+82 10 1234 5678).
  if ((digits.length === 12 || digits.length === 11) && digits.startsWith("82")) return true;
  return false;
}

/** 계좌번호로 보이는 자릿수(은행마다 10~16자리, 전화번호로 보이지 않는 긴 숫자). */
function looksLikeAccount(digits: string): boolean {
  return digits.length >= 10 && digits.length <= 16 && !looksLikePhone(digits);
}

/**
 * 은행 이름 — "우리·하나·기업·부산" 같은 일상어는 넣지 않는다.
 * (넣으면 "우리 집 앞 12345678"처럼 평범한 문장이 계좌로 둔갑한다.)
 */
const BANK_NAMES = [
  "국민은행", "kb국민", "신한은행", "우리은행", "하나은행", "농협", "nh은행", "기업은행", "ibk",
  "카카오뱅크", "카뱅", "토스뱅크", "토스", "케이뱅크", "케뱅", "새마을금고", "수협", "우체국",
  "산업은행", "씨티은행", "부산은행", "대구은행", "광주은행", "전북은행", "경남은행", "제주은행",
  "신협", "은행", "계좌",
];

/** 메시지에 은행 이름(또는 "계좌")이 등장하는가(대소문자 무시). */
function mentionsBank(text: string): boolean {
  const lower = text.toLowerCase();
  return BANK_NAMES.some((b) => lower.includes(b));
}

/**
 * 이 자릿수가 전화번호·계좌번호로 보이는가.
 *
 * 운송장 번호를 계좌로 오해하는 경우가 있지만, "택배로 보낼게요 + 계좌 알려드릴게요"는
 * 사기에서 가장 흔한 문장이라 택배 얘기가 나왔다고 계좌 판정을 끄지는 않는다.
 * (알림만 뜨는 기능이라, 놓치는 쪽이 훨씬 위험하다.)
 */
function classify(digits: string, bankMentioned: boolean): "phone" | "account" | null {
  if (looksLikePhone(digits)) return "phone";
  if (looksLikeAccount(digits)) return "account";
  // 은행 이름이 함께 적혔더라도 10자리는 넘어야 한다 —
  // 그러지 않으면 "계좌이체는 2026.07.24에" 같은 날짜·금액이 계좌로 잡힌다.
  if (bankMentioned && digits.length >= 10 && digits.length <= 16) return "account";
  return null;
}

/** 번호를 끊어 적은 것으로 보이는가 — 조각이 짧아야 하고, 사이에 다른 글자가 없어야 한다. */
function looksSplitApart(chunks: Chunk[], maxPieceLength: number): boolean {
  if (chunks.length < 2) return false;
  for (let i = 0; i < chunks.length; i++) {
    if (chunks[i].digits.length > maxPieceLength) return false;
    if (i < chunks.length - 1 && chunks[i].brokenAfter) return false;
  }
  return true;
}

function toSpan(group: Chunk[], kind: "phone" | "account"): SensitiveSpan {
  return {
    start: group[0].start,
    end: group[group.length - 1].end,
    kind,
    evasive: group.some((c) => c.evasive),
    digits: group.map((c) => c.digits).join(""),
  };
}

/**
 * 메시지에서 전화번호·계좌번호로 보이는 구간을 찾는다.
 * 반환된 span은 원문 인덱스라, 화면에서 그 부분만 밑줄로 강조할 수 있다.
 */
export function scanSensitive(text: string): SensitiveScan {
  const bankMentioned = mentionsBank(text);
  const chunks = scanChunks(text);
  const spans: SensitiveSpan[] = [];

  let i = 0;
  while (i < chunks.length) {
    // 1) 덩어리 하나로 번호가 되는가 — 가장 흔한 경우다("010-1234-5678", "110-234-567890").
    //    단 "15000-20000원" 같은 가격 범위는 번호로 보지 않는다.
    const single = looksLikeNumberRange(chunks[i].groupSizes)
      ? null
      : classify(chunks[i].digits, bankMentioned);
    if (single) {
      spans.push(toSpan([chunks[i]], single));
      i += 1;
      continue;
    }

    // 2) 안 되면 "번호를 끊어 적었나" 본다 — 짧은 조각이 이어질 때만, 최대 네 조각까지.
    //    전화번호에만 허용한다. 계좌까지 합치면 "25000 20000" 같은 가격 흥정이
    //    한 덩어리 계좌로 둔갑하는데, 그 오탐이 놓치는 것보다 나쁘다.
    let matched = false;
    for (let take = Math.min(4, chunks.length - i); take >= 2; take--) {
      const group = chunks.slice(i, i + take);
      const digits = group.map((c) => c.digits).join("");
      const pieceSizes = group.map((c) => c.digits.length);
      if (looksSplitApart(group, 4) && looksLikePhone(digits)) {
        spans.push(toSpan(group, "phone"));
        i += take;
        matched = true;
        break;
      }
      // 계좌를 "3333 - 01 - 1234567"처럼 띄어 적은 경우 — 조각 사이에 하이픈 같은 구분자가
      // 있을 때만 이어 붙인다. 그냥 띄어 쓴 숫자("25000 20000")까지 합치면 가격 흥정이 계좌가 된다.
      if (
        bankMentioned &&
        looksSplitApart(group, 7) &&
        group.slice(0, -1).every((c) => c.separatorAfter) &&
        !looksLikeNumberRange(pieceSizes) &&
        classify(digits, true) === "account"
      ) {
        spans.push(toSpan(group, "account"));
        i += take;
        matched = true;
        break;
      }
    }
    if (!matched) i += 1;
  }

  return {
    spans,
    hasPhone: spans.some((s) => s.kind === "phone"),
    hasAccount: spans.some((s) => s.kind === "account"),
    hasEvasive: spans.some((s) => s.evasive),
  };
}
