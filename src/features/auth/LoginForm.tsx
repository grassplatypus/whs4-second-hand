"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { SocialButtons } from "./SocialButtons";

export function LoginForm({ oauthError }: { oauthError?: string } = {}) {
  const t = useTranslations("auth");
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(oauthError ?? null);
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    if (submitting) return; // 이중 제출 방지

    setSubmitting(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password }),
      });

      if (!res.ok) return setError(t("failed")); // 실패 사유는 구분해 보여주지 않는다
      const body = await res.json().catch(() => ({}));
      // 2FA 계정은 세션 없이 챌린지 쿠키만 심어 200을 준다 — twoFactorRequired일 때는 홈이 아니라 챌린지로.
      router.push(body?.twoFactorRequired ? "/login/2fa" : "/");
      // 루트 레이아웃(navbar)은 서버에서 세션을 읽는다 — refresh 없이 client 네비게이션만 하면
      // 로그인 상태가 반영되지 않는다(RSC 캐시). 세션이 바뀌었으니 서버 트리를 무효화한다.
      router.refresh();
    } catch {
      setError(t("failed"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <form onSubmit={submit} className="flex w-80 flex-col gap-3" noValidate>
        <label className="flex flex-col gap-1">
          {t("email")}
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="rounded border px-2 py-1"
          />
        </label>

        <label className="flex flex-col gap-1">
          {t("password")}
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="rounded border px-2 py-1"
          />
        </label>

        {error && <p role="alert" className="text-sm text-red-600">{error}</p>}

        <button type="submit" disabled={submitting} className="rounded bg-black px-3 py-2 text-white disabled:opacity-50">
          {t("submitLogin")}
        </button>
      </form>

      <div className="flex w-80 items-center gap-2 text-sm text-zinc-400">
        <span className="h-px flex-1 bg-zinc-200" />
        {t("oauth.or")}
        <span className="h-px flex-1 bg-zinc-200" />
      </div>
      <SocialButtons />
    </>
  );
}
