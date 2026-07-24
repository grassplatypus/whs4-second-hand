"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";

type StepUpMethod = "password" | "totp";

/**
 * 민감 작업(2FA 해제, 소셜 연동 해제 등) 전 재인증. 성공하면 step_up 쿠키가 발급되고
 * onSuccess가 호출된다 — 호출자는 그 안에서 원래 하려던 작업을 재시도한다.
 *
 * 코드 검증은 항상 TOTP로 보낸다: STEP_UP 목적 이메일 코드는 발급 라우트가 없어(백엔드
 * 범위 밖) UI에서 실제로 받을 방법이 없다 — email을 선택지로 노출하면 항상 실패하는
 * 버튼이 된다. 향후 이메일 재발급 라우트가 추가되면 이 부분을 확장한다.
 */
export function StepUpPrompt({ onSuccess }: { onSuccess: () => void }) {
  const t = useTranslations("auth.twofactor");
  const [method, setMethod] = useState<StepUpMethod>("password");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    if (submitting) return; // 이중 제출 방지

    setSubmitting(true);
    try {
      const body = method === "password" ? { method, password } : { method: "totp", code };
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
      </div>

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
