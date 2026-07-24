"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";

type StepUpMethod = "password" | "totp" | "email";

/**
 * 민감 작업(2FA 해제, 소셜 연동 해제 등) 전 재인증. 성공하면 step_up 쿠키가 발급되고
 * onSuccess가 호출된다 — 호출자는 그 안에서 원래 하려던 작업을 재시도한다.
 *
 * password/totp 외에 email도 지원한다: 비번이 없는(OAuth-only) 계정, TOTP를 설정하지
 * 않은 계정도 재인증할 수 있도록 "이메일로 코드 받기" 버튼이 `/api/auth/step-up/send-otp`로
 * STEP_UP 목적 코드를 발송하고, 받은 코드를 같은 `/api/auth/step-up`에 `{method:"email", code}`로 보낸다.
 */
export function StepUpPrompt({ onSuccess }: { onSuccess: () => void }) {
  const t = useTranslations("auth.twofactor");
  const [method, setMethod] = useState<StepUpMethod>("password");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [emailSent, setEmailSent] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    if (submitting) return; // 이중 제출 방지

    setSubmitting(true);
    try {
      const body = method === "password" ? { method, password } : { method, code };
      const res = await fetch("/api/auth/step-up", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) return setError(t("failed")); // 실패 사유는 구분해 보여주지 않는다
      onSuccess();
    } catch {
      setError(t("failed"));
    } finally {
      setSubmitting(false);
    }
  }

  async function sendEmailOtp() {
    setError(null);
    setEmailSent(false);
    try {
      const res = await fetch("/api/auth/step-up/send-otp", { method: "POST" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ code: undefined }));
        return setError(t(body.code === "OTP_TOO_SOON" ? "tooSoon" : "failed"));
      }
      setEmailSent(true);
    } catch {
      setError(t("failed"));
    }
  }

  return (
    <div className="flex w-80 flex-col gap-3 rounded border p-3">
      <h2 className="font-semibold">{t("stepUpTitle")}</h2>
      <p className="text-sm text-zinc-500">{t("stepUpDescription")}</p>

      <div className="flex gap-2 text-sm">
        <button
          type="button"
          onClick={() => setMethod("password")}
          aria-pressed={method === "password"}
          className="rounded border px-2 py-1"
        >
          {t("stepUpUsePassword")}
        </button>
        <button
          type="button"
          onClick={() => setMethod("totp")}
          aria-pressed={method === "totp"}
          className="rounded border px-2 py-1"
        >
          {t("stepUpUseCode")}
        </button>
        <button
          type="button"
          onClick={() => setMethod("email")}
          aria-pressed={method === "email"}
          className="rounded border px-2 py-1"
        >
          {t("stepUpUseEmail")}
        </button>
      </div>

      {method === "email" && (
        <div className="flex flex-col gap-2">
          <button type="button" onClick={sendEmailOtp} className="self-start text-sm text-blue-600">
            {t("stepUpSendEmail")}
          </button>
          {emailSent && (
            <p aria-live="polite" className="text-sm text-green-700">
              {t("stepUpEmailSent")}
            </p>
          )}
        </div>
      )}

      <form onSubmit={submit} className="flex flex-col gap-3" noValidate>
        {method === "password" ? (
          <label className="flex flex-col gap-1">
            {t("stepUpPassword")}
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="rounded border px-2 py-1"
            />
          </label>
        ) : (
          <label className="flex flex-col gap-1">
            {t("stepUpCode")}
            <input value={code} onChange={(e) => setCode(e.target.value)} className="rounded border px-2 py-1" />
          </label>
        )}

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
          {t("stepUpSubmit")}
        </button>
      </form>
    </div>
  );
}
