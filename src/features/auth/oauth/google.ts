import { AppError } from "@/features/_shared/error";
import type { OAuthAdapter, OAuthUserInfo } from "./provider";

const AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const USERINFO_ENDPOINT = "https://openidconnect.googleapis.com/v1/userinfo";

/** 실제 Google OAuth. 키 3종이 있을 때만 provider.ts가 이걸 쓴다. */
export class GoogleAdapter implements OAuthAdapter {
  readonly provider = "GOOGLE" as const;
  constructor(
    private clientId: string,
    private clientSecret: string,
    private redirectUri: string,
  ) {}

  authorizeUrl(state: string): string {
    const p = new URLSearchParams({
      client_id: this.clientId,
      redirect_uri: this.redirectUri,
      response_type: "code",
      scope: "openid email",
      state,
    });
    return `${AUTH_ENDPOINT}?${p.toString()}`;
  }

  async exchange(code: string): Promise<OAuthUserInfo> {
    const tokenRes = await fetch(TOKEN_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: this.clientId,
        client_secret: this.clientSecret,
        redirect_uri: this.redirectUri,
        grant_type: "authorization_code",
      }),
    });
    if (!tokenRes.ok) throw new AppError("OAUTH_EXCHANGE_FAILED", "소셜 로그인에 실패했어요.", 502);
    const { access_token } = (await tokenRes.json()) as { access_token?: string };
    if (!access_token) throw new AppError("OAUTH_EXCHANGE_FAILED", "소셜 로그인에 실패했어요.", 502);

    const infoRes = await fetch(USERINFO_ENDPOINT, {
      headers: { authorization: `Bearer ${access_token}` },
    });
    if (!infoRes.ok) throw new AppError("OAUTH_EXCHANGE_FAILED", "소셜 로그인에 실패했어요.", 502);
    const info = (await infoRes.json()) as { sub?: string; email?: string };
    if (!info.sub || !info.email) throw new AppError("OAUTH_EXCHANGE_FAILED", "소셜 로그인에 실패했어요.", 502);
    return { providerUserId: info.sub, email: info.email };
  }
}
