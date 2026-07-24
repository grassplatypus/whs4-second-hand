"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { StepUpPrompt } from "@/features/auth/StepUpPrompt";

const ERROR_KEYS: Record<string, string> = {
  PASSWORD_EXISTS: "passwordExists",
};

/**
 * 비밀번호 설정(OAuth 전용 계정)/변경 폼. hasPassword로 어느 엔드포인트를 칠지 정한다.
 * 두 엔드포인트 모두 step-up 게이팅 — 401 STEP_UP_REQUIRED면 StepUpPrompt를 띄우고
 * 재인증 성공(onSuccess)에서 같은 제출을 재시도한다.
 */
export function PasswordForm({ hasPassword }: { hasPassword: boolean }) {
  const t = useTranslations("account");
  const router = useRouter();

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [needsStepUp, setNeedsStepUp] = useState(false);

  async function submitPassword() {
    setError(null);
    setSaved(false);
    if (submitting) return;
    setSubmitting(true);
    try {
      const endpoint = hasPassword ? "/api/auth/password/change" : "/api/auth/password/set";
      const body = hasPassword ? { currentPassword, newPassword } : { password: newPassword };
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });

      if (res.ok) {
        setNeedsStepUp(false);
        setCurrentPassword("");
        setNewPassword("");
        setSaved(true);
        router.refresh();
        return;
      }

      const resBody = await res.json().catch(() => ({ code: undefined }));
      if (resBody.code === "STEP_UP_REQUIRED") {
        setNeedsStepUp(true);
        setError(t("stepUpRequired"));
        return;
      }
      setError(t(ERROR_KEYS[resBody.code] ?? "failed"));
    } catch {
      setError(t("failed"));
    } finally {
      setSubmitting(false);
    }
  }

  function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    void submitPassword();
  }

  return (
    <div className="flex w-80 flex-col gap-3">
      <h2 className="font-semibold">{hasPassword ? t("changePasswordTitle") : t("setPasswordTitle")}</h2>
      <form onSubmit={onSubmit} className="flex flex-col gap-2" noValidate>
        {hasPassword && (
          <label className="flex flex-col gap-1">
            {t("currentPassword")}
            <input
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              className="rounded border px-2 py-1"
            />
          </label>
        )}
        <label className="flex flex-col gap-1">
          {t("newPassword")}
          <input
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            className="rounded border px-2 py-1"
          />
        </label>
        <button
          type="submit"
          disabled={submitting}
          className="rounded bg-black px-3 py-2 text-white disabled:opacity-50"
        >
          {hasPassword ? t("submitChangePassword") : t("submitSetPassword")}
        </button>
      </form>

      {needsStepUp && <StepUpPrompt onSuccess={submitPassword} />}

      {saved && (
        <p aria-live="polite" className="text-sm text-green-700">
          {t("passwordSaved")}
        </p>
      )}

      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}
    </div>
  );
}
