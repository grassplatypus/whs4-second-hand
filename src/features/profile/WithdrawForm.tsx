"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Card, Button } from "@/features/shell/ui";
import { StepUpPrompt } from "@/features/auth/StepUpPrompt";

const ERROR_KEYS: Record<string, string> = {
  WITHDRAW_BLOCKED: "blocked",
};

/**
 * 회원 탈퇴 — 민감 작업이라 확인 프롬프트를 한 번 거친 뒤에만 실제 요청을 보낸다.
 * 401 STEP_UP_REQUIRED면 StepUpPrompt로 재인증 후 재시도. 성공하면 세션이 이미
 * 서버에서 전부 폐기됐으므로 홈으로 보낸다.
 */
export function WithdrawForm() {
  const t = useTranslations("account");
  const router = useRouter();

  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [needsStepUp, setNeedsStepUp] = useState(false);

  async function doWithdraw() {
    setError(null);
    if (submitting) return;
    setSubmitting(true);
    try {
      const res = await fetch("/api/auth/withdraw", { method: "POST" });

      if (res.ok) {
        setNeedsStepUp(false);
        router.push("/");
        router.refresh(); // 탈퇴 후 navbar가 로그아웃 상태를 반영하도록
        return;
      }

      const body = await res.json().catch(() => ({ code: undefined }));
      if (body.code === "STEP_UP_REQUIRED") {
        setNeedsStepUp(true);
        setError(t("stepUpRequired"));
        return;
      }
      setError(t(ERROR_KEYS[body.code] ?? "failed"));
    } catch {
      setError(t("failed"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card className="flex flex-col gap-4">
      <h2 className="font-semibold text-zinc-900 dark:text-zinc-50">{t("withdrawTitle")}</h2>

      {!confirming ? (
        <Button type="button" variant="danger" onClick={() => setConfirming(true)} className="self-start">
          {t("withdrawButton")}
        </Button>
      ) : (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-zinc-600 dark:text-zinc-300">{t("withdrawConfirm")}</p>
          <div className="flex gap-2">
            <Button type="button" variant="danger" onClick={doWithdraw} disabled={submitting}>
              {t("withdrawConfirmButton")}
            </Button>
            <Button type="button" variant="secondary" onClick={() => setConfirming(false)}>
              {t("withdrawCancel")}
            </Button>
          </div>
        </div>
      )}

      {needsStepUp && <StepUpPrompt onSuccess={doWithdraw} />}

      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}
    </Card>
  );
}
