/**
 * Demo-scale Korean banned-word list for the chat profanity filter.
 *
 * NOT an exhaustive moderation dictionary — this is intentionally small and
 * meant to demonstrate `normalize()` + `maskProfanity()` behavior. Extend
 * this array to add coverage; no other code needs to change.
 *
 * Contents:
 *  - base literal forms: 시발, 씨발, 개새끼, 병신, 지랄, 좆, 니미
 *  - initial-consonant ("초성") evasions: ㅅㅂ, ㅄ, ㄲㅈ
 *  - explicit vowel-elongation evasion forms: 시이발, 씨이발
 *    (an arbitrary-length run of repeated "이", e.g. "시이이이발", collapses
 *    down to this form via normalize()'s repetition-collapse step — see
 *    filter.ts for details)
 */
export const PROFANITY: string[] = [
  "시발",
  "씨발",
  "개새끼",
  "병신",
  "지랄",
  "좆",
  "니미",
  "ㅅㅂ",
  "ㅄ",
  "ㄲㅈ",
  "시이발",
  "씨이발",
];
