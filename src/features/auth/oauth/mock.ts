import { getEnv } from "@/features/_shared/env";
import type { OAuthAdapter, OAuthUserInfo, ProviderName } from "./provider";

/**
 * 실 네트워크 없는 목 어댑터. 키 없이 전 플로우·테스트 동작(#1a 어댑터 원칙).
 * 신원은 code(=mockHint)에서 결정적으로 파생 → 같은 hint=같은 유저(재로그인 재현),
 * 다른 hint=다른 유저(E2E가 실행마다 고유 신원 사용).
 */
export function makeMockAdapter(provider: ProviderName): OAuthAdapter {
  const slug = provider.toLowerCase();
  return {
    provider,
    authorizeUrl(state, mockHint) {
      const base = getEnv().APP_BASE_URL;
      const code = encodeURIComponent(mockHint ?? "default");
      return `${base}/api/auth/oauth/${slug}/callback?code=${code}&state=${encodeURIComponent(state)}`;
    },
    async exchange(code) {
      const handle = code || "default";
      const info: OAuthUserInfo = {
        providerUserId: `${slug}-${handle}`,
        email: `${slug}.${handle}@example.com`,
      };
      return info;
    },
  };
}
