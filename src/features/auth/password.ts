import bcrypt from "bcryptjs";

// bcryptjs는 순수 JS 구현이라 네이티브 대비 느리다. 10 라운드가 보안/응답시간 균형점.
const ROUNDS = 10;

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, ROUNDS);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

let dummyHash: string | null = null;

/**
 * 계정이 없거나 로컬 비번이 없는 경우에도 같은 bcrypt 비용을 치르게 한다.
 * 응답시간 차이로 "그 이메일은 가입돼 있다"를 추론하지 못하게 하기 위함.
 */
export async function dummyVerify(plain: string): Promise<false> {
  dummyHash ??= await hashPassword("timing-equalizer");
  await verifyPassword(plain, dummyHash);
  return false;
}
