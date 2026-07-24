"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { StepUpPrompt } from "./StepUpPrompt";

type Method = "NONE" | "TOTP" | "EMAIL";
type SetupMode = null | "totp" | "email";

function mapSetupErrorCode(code: unknown): "tooSoon" | "failed" {
  return code === "OTP_TOO_SOON" ? "tooSoon" : "failed";
}

export function TwoFactorSettings({ initialMethod }: { initialMethod: Method }) {
  const t = useTranslations("auth.twofactor");
  const router = useRouter();

  const [method, setMethod] = useState<Method>(initialMethod);
  const [setupMode, setSetupMode] = useState<SetupMode>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [uri, setUri] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [needsStepUp, setNeedsStepUp] = useState(false);

  function resetSetup() {
    setSetupMode(null);
    setSecret(null);
    setUri(null);
    setCode("");
  }

  async function startTotp() {
    setError(null);
    if (submitting) return;
    setSubmitting(true);
    try {
      // 로그인 필요(refresh 쿠키) — 미인증이면 서버가 401을 준다.
      const res = await fetch("/api/auth/2fa/totp/start", { method: "POST" });
      if (!res.ok) return setError(t("failed"));
      const body = await res.json();
      // secret/uri는 인증 앱 등록용으로 화면에만 표시한다 — 로그·URL·영속 저장 금지(state에만 보관).
      setSecret(body.secret);
      setUri(body.uri);
      setSetupMode("totp");
    } catch {
      setError(t("failed"));
    } finally {
      setSubmitting(false);
    }
  }

  async function startEmail() {
    setError(null);
    if (submitting) return;
    setSubmitting(true);
    try {
      const res = await fetch("/api/auth/2fa/email/start", { method: "POST" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ code: undefined }));
        return setError(t(mapSetupErrorCode(body.code)));
      }
      setSetupMode("email");
    } catch {
      setError(t("failed"));
    } finally {
      setSubmitting(false);
    }
  }

  async function confirmSetup(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    if (submitting || !setupMode) return;
    setSubmitting(true);
    try {
      const endpoint = setupMode === "totp" ? "/api/auth/2fa/totp/confirm" : "/api/auth/2fa/email/confirm";
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ code: undefined }));
        return setError(t(mapSetupErrorCode(body.code)));
      }
      setMethod(setupMode === "totp" ? "TOTP" : "EMAIL");
      resetSetup();
      router.refresh();
    } catch {
      setError(t("failed"));
    } finally {
      setSubmitting(false);
    }
  }

  async function disable() {
    setError(null);
    if (submitting) return;
    setSubmitting(true);
    try {
      const res = await fetch("/api/auth/2fa/disable", { method: "POST" });
      if (res.ok) {
        setNeedsStepUp(false);
        setMethod("NONE");
        router.refresh();
        return;
      }
      const body = await res.json().catch(() => ({ code: undefined }));
      if (body.code === "STEP_UP_REQUIRED") {
        setNeedsStepUp(true);
        setError(t("stepUpRequired"));
        return;
      }
      setError(t("failed"));
    } catch {
      setError(t("failed"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex w-80 flex-col gap-4">
      {method === "NONE" && !setupMode && (
        <div className="flex flex-col gap-2">
          <p>{t("disabledState")}</p>
          <button type="button" onClick={startTotp} disabled={submitting} className="rounded border px-3 py-2">
            {t("setupTotp")}
          </button>
          <button type="button" onClick={startEmail} disabled={submitting} className="rounded border px-3 py-2">
            {t("setupEmail")}
          </button>
        </div>
      )}

      {setupMode === "totp" && (
        <div className="flex flex-col gap-2">
          <p>{t("totpInstructions")}</p>
          <p className="break-all text-xs text-zinc-500">
            {t("secretLabel")}: {secret}
          </p>
          <p className="break-all text-xs text-zinc-500">
            {t("uriLabel")}: {uri}
          </p>
          <form onSubmit={confirmSetup} className="flex flex-col gap-2" noValidate>
            <label className="flex flex-col gap-1">
              {t("code")}
              <input value={code} onChange={(e) => setCode(e.target.value)} className="rounded border px-2 py-1" />
            </label>
            <button
              type="submit"
              disabled={submitting}
              className="rounded bg-black px-3 py-2 text-white disabled:opacity-50"
            >
              {t("confirm")}
            </button>
          </form>
        </div>
      )}

      {setupMode === "email" && (
        <div className="flex flex-col gap-2">
          <p>{t("emailInstructions")}</p>
          <form onSubmit={confirmSetup} className="flex flex-col gap-2" noValidate>
            <label className="flex flex-col gap-1">
              {t("code")}
              <input value={code} onChange={(e) => setCode(e.target.value)} className="rounded border px-2 py-1" />
            </label>
            <button
              type="submit"
              disabled={submitting}
              className="rounded bg-black px-3 py-2 text-white disabled:opacity-50"
            >
              {t("confirm")}
            </button>
          </form>
        </div>
      )}

      {method !== "NONE" && !needsStepUp && (
        <div className="flex flex-col gap-2">
          <p>{t(method === "TOTP" ? "enabledTotp" : "enabledEmail")}</p>
          <button type="button" onClick={disable} disabled={submitting} className="text-sm text-red-600">
            {t("disable")}
          </button>
        </div>
      )}

      {needsStepUp && <StepUpPrompt onSuccess={disable} />}

      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}
    </div>
  );
}
