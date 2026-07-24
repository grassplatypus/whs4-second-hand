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

export function maskProfanity(text: string): { masked: string; hit: boolean } {
  const { text: normalized, spans } = normalizeWithSpans(text);

  const maskOriginalIndex = new Array<boolean>(text.length).fill(false);
  let hit = false;

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
