import korcen from "korcen";
import leoProfanity from "leo-profanity";
import { PROFANITY } from "./profanity-words";

/**
 * Korean chat profanity/evasion filter.
 *
 * `normalize()` maps a message toward a canonical form so that common
 * evasion tactics collapse onto the same text a plain banned-word substring
 * search can catch:
 *
 *  - case-folds (`toLowerCase`)
 *  - strips whitespace, punctuation/symbols, and digits — keeps only Hangul
 *    syllables (가-힣), Hangul compatibility jamo (ㄱ-ㅎ, ㅏ-ㅣ — this is
 *    what lets initial-consonant evasions like "ㅅㅂ" match), and latin
 *    letters. Defeats spacing evasion ("시 발") and digit-insertion evasion
 *    ("시1발").
 *  - collapses any run of 2+ identical *consecutive* characters down to a
 *    single character. Defeats simple repetition spam ("ㅋㅋㅋㅋ" → "ㅋ")
 *    and, combined with the explicit "시이발"/"씨이발" entries in
 *    PROFANITY, catches arbitrary-length vowel-elongation evasion
 *    ("시이이이발" → "시이발" → matches the "시이발" list entry).
 *
 * Known limitations (acceptable at demo scale, per task brief):
 *  - This is a substring search over a small demo word list, not real NLP.
 *    A benign word that happens to *contain* a banned substring would be
 *    over-masked (e.g. a hypothetical word containing "좆" or "니미" as a
 *    substring). No such collisions are known among common Korean words
 *    exercised by this project, but this is a known, documented tradeoff.
 *  - Repetition-collapse only defeats *consecutive identical character*
 *    spam; it does not do general phonetic/morphological normalization, so
 *    more exotic evasions (leetspeak, homophones, mixed-script tricks
 *    beyond what's listed above) are not guaranteed to be caught.
 */

/** Inclusive [start, end] character-index range in the *original* text. */
interface Span {
  start: number;
  end: number;
}

interface NormalizedResult {
  text: string;
  /** spans[i] = original-text range consumed to produce normalized text[i] */
  spans: Span[];
}

// Hangul syllables (가-힣), Hangul compatibility jamo (ㄱ-ㆎ incl. ㅏ-ㅣ), latin letters.
const KEEP_CHAR = /[a-zㄱ-ㆎ가-힣]/;

function normalizeWithSpans(text: string): NormalizedResult {
  const lowered = text.toLowerCase();

  // Step 1: drop whitespace/punctuation/digits, remembering each surviving
  // char's index in the original text.
  const kept: { ch: string; index: number }[] = [];
  for (let i = 0; i < lowered.length; i++) {
    const ch = lowered[i];
    if (KEEP_CHAR.test(ch)) {
      kept.push({ ch, index: i });
    }
  }

  // Step 2: collapse runs of 2+ identical consecutive kept chars into one,
  // tracking the original-index range each collapsed run consumed.
  const chars: string[] = [];
  const spans: Span[] = [];
  let i = 0;
  while (i < kept.length) {
    let j = i;
    while (j + 1 < kept.length && kept[j + 1].ch === kept[i].ch) {
      j++;
    }
    chars.push(kept[i].ch);
    spans.push({ start: kept[i].index, end: kept[j].index });
    i = j + 1;
  }

  return { text: chars.join(""), spans };
}

export function normalize(text: string): string {
  return normalizeWithSpans(text).text;
}

/**
 * 낱말 단위로 외부 비속어 사전에 물어본다 — 한국어는 korcen, 영어는 leo-profanity.
 *
 * 위의 목록 검사는 띄어쓰기를 넘나드는 우회("씨 발")를 잡는 대신 목록이 작다.
 * 라이브러리는 반대로 목록이 넓지만 낱말 단위라 위치를 알려주지 않는다.
 * 그래서 낱말마다 물어보고, 걸린 낱말의 원문 위치를 그대로 돌려준다 — 두 방식이 서로를 메운다.
 *
 * 문장부호가 붙으면(`Shit!`) 사전이 못 알아보므로, 검사용 사본에서만 글자·숫자만 남긴다.
 */
function libraryFlaggedSpans(text: string): Span[] {
  const found: Span[] = [];
  const wordPattern = /\S+/g;
  let match: RegExpExecArray | null;
  while ((match = wordPattern.exec(text)) !== null) {
    const raw = match[0];
    const probe = raw.toLowerCase().replace(/[^0-9a-zㄱ-ㆎ가-힣]/g, "");
    if (probe.length < 2) continue;
    let flagged = false;
    try {
      flagged = korcen.check(probe) || leoProfanity.check(probe);
    } catch {
      flagged = false; // 사전이 어떤 입력에 놀라더라도 대화가 막히면 안 된다.
    }
    if (flagged) found.push({ start: match.index, end: match.index + raw.length - 1 });
  }
  return found;
}

export function maskProfanity(text: string): { masked: string; hit: boolean } {
  const { text: normalized, spans } = normalizeWithSpans(text);

  const maskOriginalIndex = new Array<boolean>(text.length).fill(false);
  let hit = false;

  for (const span of libraryFlaggedSpans(text)) {
    hit = true;
    for (let k = span.start; k <= span.end; k++) maskOriginalIndex[k] = true;
  }

  for (const word of PROFANITY) {
    if (!word) continue;
    let fromIndex = 0;
    let idx: number;
    while ((idx = normalized.indexOf(word, fromIndex)) !== -1) {
      hit = true;
      const startSpan = spans[idx];
      const endSpan = spans[idx + word.length - 1];
      for (let k = startSpan.start; k <= endSpan.end; k++) {
        maskOriginalIndex[k] = true;
      }
      fromIndex = idx + word.length;
    }
  }

  if (!hit) {
    return { masked: text, hit: false };
  }

  const maskedChars = text.split("").map((ch, i) => (maskOriginalIndex[i] ? "*" : ch));
  return { masked: maskedChars.join(""), hit: true };
}
