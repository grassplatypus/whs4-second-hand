"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { StepUpPrompt } from "@/features/auth/StepUpPrompt";

const ERROR_KEYS: Record<string, string> = {
  NICKNAME_TAKEN: "taken",
};

/** 닉네임 변경 — 민감 작업. 401 STEP_UP_REQUIRED면 StepUpPrompt로 재인증 후 재시도한다. */
export function NicknameForm({ initialNickname }: { initialNickname: string }) {
  const t = useTranslations("account");
  const router = useRouter();

  const [nickname, setNickname] = useState(initialNickname);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [needsStepUp, setNeedsStepUp] = useState(false);

  async function submitNickname() {
    setError(null);
    setSaved(false);
    if (submitting) return;
    setSubmitting(true);
    try {
      const res = await fetch("/api/profile/nickname", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ nickname }),
      });

      if (res.ok) {
        setNeedsStepUp(false);
        setSaved(true);
        router.refresh();
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

  function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    void submitNickname();
  }

  return (
    <div className="flex w-80 flex-col gap-3">
      <h2 className="font-semibold">{t("changeNicknameTitle")}</h2>
      <form onSubmit={onSubmit} className="flex flex-col gap-2" noValidate>
        <label className="flex flex-col gap-1">
          {t("nickname")}
          <input value={nickname} onChange={(e) => setNickname(e.target.value)} className="rounded border px-2 py-1" />
        </label>
        <button
          type="submit"
          disabled={submitting}
          className="rounded bg-black px-3 py-2 text-white disabled:opacity-50"
        >
          {t("submitNickname")}
        </button>
      </form>

      {needsStepUp && <StepUpPrompt onSuccess={submitNickname} />}

      {saved && (
        <p aria-live="polite" className="text-sm text-green-700">
          {t("nicknameSaved")}
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
