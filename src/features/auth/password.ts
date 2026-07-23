import bcrypt from "bcryptjs";

// bcryptjs는 순수 JS 구현이라 네이티브 대비 느리다. 10 라운드가 보안/응답시간 균형점.
const ROUNDS = 10;

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, ROUNDS);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

/**
 * "timing-equalizer"라는 공개 문자열을 ROUNDS(10)로 미리 해시해 둔 상수.
 * 비밀도 아니고 어떤 계정도 지키지 않는다 — 매 호출마다 bcrypt.hash를 새로 치르면
 * (특히 콜드스타트 서버리스에서) 첫 호출이 오히려 더 느려져 타이밍 이퀄라이저의
 * 목적이 뒤집히므로, hash 단계를 없애고 compare 한 번만 치르게 고정해 둔다.
 */
export const DUMMY_HASH = "$2b$10$YTpVs9QimIPiJ7cSPntHRuQy1lvp0.VSTyLk0qNKkDc4OvzShCB6C";

/**
 * 계정이 없거나 로컬 비번이 없는 경우에도 같은 bcrypt 비용을 치르게 한다.
 * 응답시간 차이로 "그 이메일은 가입돼 있다"를 추론하지 못하게 하기 위함.
 */
export async function dummyVerify(plain: string): Promise<false> {
  await verifyPassword(plain, DUMMY_HASH);
  return false;
}
