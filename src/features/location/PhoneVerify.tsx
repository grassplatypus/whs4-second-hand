"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";

function mapErrorCode(code: unknown): "failed" | "taken" | "tooSoon" | "noPhone" {
  if (code === "OTP_TOO_SOON") return "tooSoon";
  if (code === "PHONE_TAKEN") return "taken";
  if (code === "NO_PHONE") return "noPhone";
  return "failed";
}

export function PhoneVerify({ initialVerified }: { initialVerified: boolean }) {
  const t = useTranslations("phone");
  const router = useRouter();

  const [verified, setVerified] = useState(initialVerified);
  const [sent, setSent] = useState(false);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function send() {
    setError(null);
    if (submitting) return;
    setSubmitting(true);
    try {
      const res = await fetch("/api/auth/phone/send", { method: "POST" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ code: undefined }));
        return setError(t(mapErrorCode(body.code)));
      }
      setSent(true);
    } catch {
      setError(t("failed"));
    } finally {
      setSubmitting(false);
    }
  }

  async function confirm(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    if (submitting) return;
    setSubmitting(true);
    try {
      const res = await fetch("/api/auth/phone/verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ code: undefined }));
        return setError(t(mapErrorCode(body.code)));
      }
      setVerified(true);
      setSent(false);
      setCode("");
      router.refresh();
    } catch {
      setError(t("failed"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex w-full max-w-sm flex-col gap-4">
      {verified ? (
        <p>{t("verified")}</p>
      ) : (
        <>
          {!sent && (
            <button type="button" onClick={send} disabled={submitting} className="rounded border px-3 py-2">
              {t("verify")}
            </button>
          )}

          {sent && (
            <form onSubmit={confirm} className="flex flex-col gap-2" noValidate>
              <label className="flex flex-col gap-1">
                {t("codeLabel")}
                <input value={code} onChange={(e) => setCode(e.target.value)} className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 dark:border-zinc-700 dark:bg-zinc-950" />
              </label>
              <button
                type="submit"
                disabled={submitting}
                className="rounded bg-emerald-600 hover:bg-emerald-700 px-3 py-2 text-white disabled:opacity-50"
              >
                {t("confirm")}
              </button>
              <button type="button" onClick={send} disabled={submitting} className="text-sm text-emerald-600 hover:underline">
                {t("resend")}
              </button>
            </form>
          )}
        </>
      )}

      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}
    </div>
  );
}
