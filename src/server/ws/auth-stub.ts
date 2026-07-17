// #0 스텁: 실제 JWT 검증은 #1에서 교체.
export function verifyTokenStub(token?: string): { userId: string | null } {
  if (!token) return { userId: null };
  return { userId: "stub-user" };
}
