"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Field, Input, Button } from "@/features/shell/ui";

/**
 * 로그인 2FA 챌린지. challenge 쿠키(HttpOnly)는 서버가 이미 심어둔 상태라고 가정한다 —
 * 이 컴포넌트는 그 안의 method를 읽을 수 없으므로(그리고 읽을 필요도 없으므로) 코드
 * 입력은 항상 보여주고, "이메일로 코드 받기"도 항상 보여준다.
 * 앱 코드(TOTP)를 쓰던 사람이 휴대폰을 잃어버렸을 때 들어올 길이 필요해서,
 * 어떤 방식으로 챌린지가 걸렸든 이 버튼은 실제로 이메일 코드를 보낸다.
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
      router.refresh(); // 루트 레이아웃(navbar)이 새 세션을 반영하도록 서버 트리 무효화
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
    <div className="flex flex-col gap-4">
      <p className="text-sm text-zinc-500 dark:text-zinc-400">{t("challengeDescription")}</p>

      <form onSubmit={submit} className="flex flex-col gap-3" noValidate>
        <Field label={t("code")}>
          <Input value={code} onChange={(e) => setCode(e.target.value)} />
        </Field>

        {error && (
          <p role="alert" className="text-sm text-red-600">
            {error}
          </p>
        )}

        <Button type="submit" disabled={submitting} className="w-full">
          {t("confirm")}
        </Button>
      </form>

      <Button type="button" variant="ghost" onClick={resend} className="self-start px-0">
        {t("resend")}
      </Button>
      {resent && (
        <p aria-live="polite" className="text-sm text-emerald-600">
          {t("resendDone")}
        </p>
      )}
    </div>
  );
}
