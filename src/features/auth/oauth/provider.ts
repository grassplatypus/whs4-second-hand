import { getEnv } from "@/features/_shared/env";
import { AppError } from "@/features/_shared/error";
import { GoogleAdapter } from "./google";
import { makeMockAdapter } from "./mock";

export type ProviderName = "GOOGLE" | "KAKAO" | "NAVER";

export interface OAuthUserInfo {
  providerUserId: string;
  email: string;
}

export interface OAuthAdapter {
  readonly provider: ProviderName;
  authorizeUrl(state: string, mockHint?: string): string;
  exchange(code: string): Promise<OAuthUserInfo>;
}

const SLUGS: Record<string, ProviderName> = { google: "GOOGLE", kakao: "KAKAO", naver: "NAVER" };

export function getAdapter(slug: string): OAuthAdapter {
  const name = SLUGS[slug.toLowerCase()];
  if (!name) throw new AppError("UNKNOWN_PROVIDER", "지원하지 않는 로그인 방식이에요.", 400);
  if (name === "GOOGLE") {
    const env = getEnv();
    if (env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET && env.GOOGLE_REDIRECT_URI) {
      return new GoogleAdapter(env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET, env.GOOGLE_REDIRECT_URI);
    }
    return makeMockAdapter("GOOGLE");
  }
  return makeMockAdapter(name);
}
