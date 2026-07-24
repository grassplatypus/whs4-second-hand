/**
 * 채팅 메시지에서 전화번호·계좌번호로 보이는 부분을 찾아낸다.
 *
 * 중고거래 사기는 대개 "채팅 밖으로 데려가기"(전화·계좌 직거래 유도)에서 시작한다.
 * 그래서 숫자를 그대로 쓴 경우뿐 아니라, 필터를 피하려고 바꿔 쓴 표기까지 잡는다:
 *   "영1영-5O14-6@977"  → 0 1 0 - 5 0 1 4 - 6 9 7 7  (한글 수사, 알파벳 O/I/l, 사이 기호)
 *   "공일공 삼2사5 육칠팔구"                          (한글 수사 혼용)
 * 잡아도 차단하지는 않는다 — 사용자에게 "전화번호를 보냈어요"라고 알리고 그 부분에 밑줄을 그어
 * 스스로 조심하게 한다(오탐이 있어도 대화가 막히지 않게).
 */

/** 숫자로 읽힐 수 있는 문자 → 실제 숫자. (한글 수사·발음 유사 알파벳·유사 기호) */
const DIGIT_ALIASES: Record<string, string> = {
  영: "0", 공: "0", 빵: "0", o: "0", O: "0", ｏ: "0", Ｏ: "0", ㅇ: "0",
  일: "1", 하나: "1", l: "1", I: "1", i: "1", "|": "1", ｌ: "1",
  이: "2", 둘: "2", z: "2", Z: "2",
  삼: "3", 셋: "3",
  사: "4", 넷: "4", A: "4",
  오: "5", 다섯: "5", s: "5", S: "5",
  육: "6", 여섯: "6", b: "6", G: "6",
  칠: "7", 일곱: "7", T: "7",
  팔: "8", 여덟: "8", B: "8",
  구: "9", 아홉: "9", g: "9", q: "9",
};

/** 한 글자를 숫자로 바꾼다(바꿀 수 없으면 null). */
function toDigit(ch: string): string | null {
  if (ch >= "0" && ch <= "9") return ch;
  return DIGIT_ALIASES[ch] ?? null;
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

/** 숫자 사이에 흔히 끼워 넣는 구분자·장식 문자(무시한다). */
const SEPARATORS = new Set([
  " ", "-", ".", ",", "/", "_", "*", "#", "~", "(", ")", "[", "]", "{", "}", "'", '"',
  "·", "‑", "–", "—", "@", "+", ":", ";", "!", "?", "\t",
]);

/**
 * 원문을 훑어 "숫자로 읽히는 문자"가 길게 이어지는 구간을 찾는다.
 * 구간 안의 실제 자릿수가 기준을 넘으면 전화번호/계좌번호 후보로 본다.
 */
/** 한글 수사(영/일/이…)는 흔한 일상 글자라, 이어서 여러 개 나올 때만 숫자로 읽는다. */
const HANGUL_NUMERALS = new Set("영공빵일이삼사오육칠팔구ㅇ");

function scanRuns(text: string): { start: number; end: number; digits: string; evasive: boolean }[] {
  const runs: { start: number; end: number; digits: string; evasive: boolean }[] = [];
  let start = -1;
  let digits = "";
  let lastDigitIdx = -1;
  let hangulStreak = 0; // 지금까지 이어진 한글 수사 개수
  let evasive = false; // 숫자 아닌 문자를 숫자로 읽은 적이 있는가(우회 표기 흔적)

  const flush = () => {
    if (start >= 0 && digits.length > 0 && lastDigitIdx >= start) {
      runs.push({ start, end: lastDigitIdx + 1, digits, evasive });
    }
    start = -1;
    digits = "";
    lastDigitIdx = -1;
    hangulStreak = 0;
    evasive = false;
  };

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    const d = toDigit(ch);
    if (d !== null) {
      const isHangul = HANGUL_NUMERALS.has(ch);
      if (isHangul) {
        // 한글 수사는 "다음 글자도 숫자로 읽히는" 경우에만 숫자로 본다.
        // 그래야 "5678이에요"의 '이'(뒤가 '에')가 번호에 붙지 않는다.
        let j = i + 1;
        while (j < text.length && SEPARATORS.has(text[j]!)) j++;
        const next = text[j];
        const nextIsNumeric = next !== undefined && toDigit(next) !== null;
        if (!nextIsNumeric) {
          flush();
          continue;
        }
        hangulStreak += 1;
      } else {
        hangulStreak = 0;
      }
      if (start < 0) start = i;
      if (!(ch >= "0" && ch <= "9")) evasive = true; // 한글·알파벳을 숫자로 읽었다면 우회 표기
      digits += d;
      lastDigitIdx = i;
      continue;
    }
    if (start >= 0 && SEPARATORS.has(ch)) continue; // 구간 안의 구분자는 건너뛴다
    flush();
  }
  flush();
  return runs;
}

/** 한국 휴대폰/지역번호로 보이는 자릿수 패턴. */
function looksLikePhone(digits: string): boolean {
  if (digits.length === 11 && digits.startsWith("01")) return true;
  if (digits.length === 10 && (digits.startsWith("01") || digits.startsWith("02") || digits.startsWith("0"))) return true;
  if (digits.length === 9 && digits.startsWith("02")) return true;
  return false;
}

/** 계좌번호로 보이는 자릿수(은행마다 10~16자리, 전화번호로 보이지 않는 긴 숫자). */
function looksLikeAccount(digits: string): boolean {
  return digits.length >= 10 && digits.length <= 16 && !looksLikePhone(digits);
}

/** 은행 이름이 함께 적히면 자릿수가 짧아도 계좌로 본다(예: "국민 123-456-78901"). */
const BANK_NAMES = [
  "국민", "kb", "신한", "우리", "하나", "농협", "nh", "기업", "ibk", "카카오뱅크", "카뱅",
  "토스", "토스뱅크", "케이뱅크", "케뱅", "새마을", "수협", "우체국", "산업", "sc", "씨티", "부산", "대구", "광주", "전북", "경남", "제주",
];

/** 메시지에 은행 이름이 등장하는가(대소문자 무시). */
function mentionsBank(text: string): boolean {
  const lower = text.toLowerCase();
  return BANK_NAMES.some((b) => lower.includes(b));
}

/**
 * 메시지에서 전화번호·계좌번호로 보이는 구간을 찾는다.
 * 반환된 span은 원문 인덱스라, 화면에서 그 부분만 밑줄로 강조할 수 있다.
 */
export function scanSensitive(text: string): SensitiveScan {
  const spans: SensitiveSpan[] = [];
  const bankMentioned = mentionsBank(text);
  for (const run of scanRuns(text)) {
    if (looksLikePhone(run.digits)) {
      spans.push({ start: run.start, end: run.end, kind: "phone", evasive: run.evasive, digits: run.digits });
    } else if (looksLikeAccount(run.digits)) {
      spans.push({ start: run.start, end: run.end, kind: "account", evasive: run.evasive, digits: run.digits });
    } else if (bankMentioned && run.digits.length >= 8 && run.digits.length <= 16) {
      // 은행 이름이 함께 적혔다면 자릿수가 조금 짧아도 계좌로 본다.
      spans.push({ start: run.start, end: run.end, kind: "account", evasive: run.evasive, digits: run.digits });
    }
  }
  return {
    spans,
    hasPhone: spans.some((s) => s.kind === "phone"),
    hasAccount: spans.some((s) => s.kind === "account"),
    hasEvasive: spans.some((s) => s.evasive),
  };
}
