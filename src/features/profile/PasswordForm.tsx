"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Card, Field, PasswordInput, Button } from "@/features/shell/ui";
import { StepUpPrompt } from "@/features/auth/StepUpPrompt";

const ERROR_KEYS: Record<string, string> = {
  PASSWORD_EXISTS: "passwordExists",
  AUTH_FAILED: "currentPasswordWrong",
};

/**
 * 비밀번호 설정(OAuth 전용 계정)/변경 폼. hasPassword로 어느 엔드포인트를 칠지 정한다.
 *
 * 변경(hasPassword=true)은 사용자 요청에 따라 step-up 대신 그 자리에서 현재 비밀번호를
 * 검증하는 표준 재인증 방식을 쓴다 — 틀리면 서버가 401 AUTH_FAILED를 주고, 여기서는
 * 그걸 "현재 비밀번호가 올바르지 않아요"로 보여준다(step-up 플로우 없음).
 *
 * 설정(hasPassword=false, OAuth 전용 계정 최초 설정)은 검증할 기존 비밀번호가 없으므로
 * 여전히 step-up 게이팅을 쓴다 — 401 STEP_UP_REQUIRED면 StepUpPrompt를 띄우고
 * 재인증 성공(onSuccess)에서 같은 제출을 재시도한다.
 */
export function PasswordForm({ hasPassword }: { hasPassword: boolean }) {
  const t = useTranslations("account");
  const router = useRouter();

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [needsStepUp, setNeedsStepUp] = useState(false);

  async function submitPassword() {
    setError(null);
    setSaved(false);
    if (submitting) return;

    if (hasPassword && newPassword !== confirmPassword) {
      setError(t("newPasswordMismatch"));
      return;
    }

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
        setConfirmPassword("");
        setSaved(true);
        router.refresh();
        return;
      }

      const resBody = await res.json().catch(() => ({ code: undefined }));
      // hasPassword=false(설정) 경로만 여전히 step-up을 쓴다 — 검증할 현재 비밀번호가 없어서다.
      if (!hasPassword && resBody.code === "STEP_UP_REQUIRED") {
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
    <Card className="flex flex-col gap-4">
      <h2 className="font-semibold text-zinc-900 dark:text-zinc-50">
        {hasPassword ? t("changePasswordTitle") : t("setPasswordTitle")}
      </h2>
      <form onSubmit={onSubmit} className="flex flex-col gap-3" noValidate>
        {hasPassword && (
          <Field label={t("currentPassword")}>
            <PasswordInput value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} />
          </Field>
        )}
        <Field label={t("newPassword")}>
          <PasswordInput value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
        </Field>
        {hasPassword && (
          <Field label={t("confirmNewPassword")}>
            <PasswordInput value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} />
          </Field>
        )}

        {error && (
          <p role="alert" className="text-sm text-red-600">
            {error}
          </p>
        )}

        <Button type="submit" disabled={submitting} className="w-full">
          {hasPassword ? t("submitChangePassword") : t("submitSetPassword")}
        </Button>
      </form>

      {needsStepUp && <StepUpPrompt onSuccess={submitPassword} />}

      {saved && (
        <p aria-live="polite" className="text-sm text-emerald-600">
          {t("passwordSaved")}
        </p>
      )}
    </Card>
  );
}
