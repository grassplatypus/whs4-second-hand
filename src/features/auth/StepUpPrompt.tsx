"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Card, Field, Input, PasswordInput, Button } from "@/features/shell/ui";

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
    <Card className="flex flex-col gap-4">
      <div>
        <h2 className="font-semibold text-zinc-900 dark:text-zinc-50">{t("stepUpTitle")}</h2>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">{t("stepUpDescription")}</p>
      </div>

      <div className="flex gap-2 text-sm">
        <Button
          type="button"
          variant={method === "password" ? "primary" : "secondary"}
          onClick={() => setMethod("password")}
          aria-pressed={method === "password"}
        >
          {t("stepUpUsePassword")}
        </Button>
        <Button
          type="button"
          variant={method === "totp" ? "primary" : "secondary"}
          onClick={() => setMethod("totp")}
          aria-pressed={method === "totp"}
        >
          {t("stepUpUseCode")}
        </Button>
        <Button
          type="button"
          variant={method === "email" ? "primary" : "secondary"}
          onClick={() => setMethod("email")}
          aria-pressed={method === "email"}
        >
          {t("stepUpUseEmail")}
        </Button>
      </div>

      {method === "email" && (
        <div className="flex flex-col gap-2">
          <Button type="button" variant="ghost" onClick={sendEmailOtp} className="self-start px-0">
            {t("stepUpSendEmail")}
          </Button>
          {emailSent && (
            <p aria-live="polite" className="text-sm text-emerald-600">
              {t("stepUpEmailSent")}
            </p>
          )}
        </div>
      )}

      <form onSubmit={submit} className="flex flex-col gap-3" noValidate>
        {method === "password" ? (
          <Field label={t("stepUpPassword")}>
            <PasswordInput value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>
        ) : (
          <Field label={t("stepUpCode")}>
            <Input value={code} onChange={(e) => setCode(e.target.value)} />
          </Field>
        )}

        {error && (
          <p role="alert" className="text-sm text-red-600">
            {error}
          </p>
        )}

        <Button type="submit" disabled={submitting} className="w-full">
          {t("stepUpSubmit")}
        </Button>
      </form>
    </Card>
  );
}
