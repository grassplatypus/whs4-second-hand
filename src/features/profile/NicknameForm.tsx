"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Card, Field, Input, Button } from "@/features/shell/ui";

const ERROR_KEYS: Record<string, string> = {
  NICKNAME_TAKEN: "taken",
};

/** 닉네임 변경 — 민감도가 낮아 step-up 재인증 없이 바로 바꾼다(고유성은 409로 여전히 강제). */
export function NicknameForm({ initialNickname }: { initialNickname: string }) {
  const t = useTranslations("account");
  const router = useRouter();

  const [nickname, setNickname] = useState(initialNickname);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [submitting, setSubmitting] = useState(false);

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
        setSaved(true);
        router.refresh();
        return;
      }

      const body = await res.json().catch(() => ({ code: undefined }));
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
    <Card className="flex flex-col gap-4">
      <h2 className="font-semibold text-zinc-900 dark:text-zinc-50">{t("changeNicknameTitle")}</h2>
      <form onSubmit={onSubmit} className="flex flex-col gap-3" noValidate>
        <Field label={t("nickname")}>
          <Input value={nickname} onChange={(e) => setNickname(e.target.value)} />
        </Field>
        <Button type="submit" disabled={submitting} className="w-full">
          {t("submitNickname")}
        </Button>
      </form>

      {saved && (
        <p aria-live="polite" className="text-sm text-emerald-600">
          {t("nicknameSaved")}
        </p>
      )}

      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}
    </Card>
  );
}
