"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";

/**
 * 로그인 2FA 챌린지. challenge 쿠키(HttpOnly)는 서버가 이미 심어둔 상태라고 가정한다 —
 * 이 컴포넌트는 그 안의 method를 읽을 수 없으므로(그리고 읽을 필요도 없으므로) 코드
 * 입력은 항상 보여주고, "이메일로 코드 받기"도 항상 보여준다(TOTP 챌린지에서 눌러도
 * 서버가 EMAIL이 아니면 조용히 아무 메일도 보내지 않고 {ok:true}만 응답한다).
 */
export function TwoFactorChallenge() {
  const t = useTranslations("auth.twofactor");
  const router = useRouter();

  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [resent, setResent] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    if (submitting) return; // 이중 제출 방지

    setSubmitting(true);
    try {
      const res = await fetch("/api/auth/2fa/verify-login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code }),
      });

      if (!res.ok) return setError(t("failed")); // 실패 사유는 구분해 보여주지 않는다
      router.push("/");
    } catch {
      setError(t("failed"));
    } finally {
      setSubmitting(false);
    }
  }

  async function resend() {
    setError(null);
    setResent(false);
    try {
      const res = await fetch("/api/auth/2fa/resend", { method: "POST" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ code: undefined }));
        return setError(t(body.code === "OTP_TOO_SOON" ? "tooSoon" : "failed"));
      }
      setResent(true);
    } catch {
      setError(t("failed"));
    }
  }

  return (
    <div className="flex w-80 flex-col gap-3">
      <p>{t("challengeDescription")}</p>

      <form onSubmit={submit} className="flex flex-col gap-3" noValidate>
        <label className="flex flex-col gap-1">
          {t("code")}
          <input value={code} onChange={(e) => setCode(e.target.value)} className="rounded border px-2 py-1" />
        </label>

        {error && (
          <p role="alert" className="text-sm text-red-600">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={submitting}
          className="rounded bg-black px-3 py-2 text-white disabled:opacity-50"
        >
          {t("confirm")}
        </button>
      </form>

      <button type="button" onClick={resend} className="text-sm text-blue-600">
        {t("resend")}
      </button>
      {resent && (
        <p aria-live="polite" className="text-sm text-green-700">
          {t("resendDone")}
        </p>
      )}
    </div>
  );
}
