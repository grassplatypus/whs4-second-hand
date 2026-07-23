"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { SocialButtons } from "./SocialButtons";

type Availability = "unknown" | "checking" | "available" | "taken";

const REGISTER_ERROR_CODES = ["EMAIL_TAKEN", "NICKNAME_TAKEN", "INVALID_INPUT"] as const;
type RegisterErrorCode = (typeof REGISTER_ERROR_CODES)[number];

function toRegisterErrorCode(value: unknown): RegisterErrorCode | undefined {
  return REGISTER_ERROR_CODES.find((code) => code === value);
}

export function SignupForm() {
  const t = useTranslations("auth");
  const router = useRouter();

  const [form, setForm] = useState({
    email: "",
    phone: "",
    nickname: "",
    password: "",
    passwordConfirm: "",
    consent: false,
  });
  const [nicknameState, setNicknameState] = useState<Availability>("unknown");
  const [emailState, setEmailState] = useState<Availability>("unknown");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const set = (key: keyof typeof form, value: string | boolean) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  async function check(field: "nickname" | "email", value: string, apply: (s: Availability) => void) {
    if (!value) return apply("unknown");
    apply("checking");
    try {
      const res = await fetch("/api/auth/check-availability", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ [field]: value }),
      });
      if (!res.ok) return apply("unknown");
      const body = await res.json();
      apply(body.available ? "available" : "taken");
    } catch {
      apply("unknown");
    }
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    if (form.password !== form.passwordConfirm) return setError(t("mismatch"));
    if (!form.consent) return setError(t("needConsent"));
    if (submitting) return; // 이중 제출 방지(더블클릭 → 가입 2회 전송)

    setSubmitting(true);
    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(form),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({ code: undefined }));
        const registerErrorMessages: Record<RegisterErrorCode, string> = {
          EMAIL_TAKEN: t("emailTaken"),
          NICKNAME_TAKEN: t("nicknameTaken"),
          INVALID_INPUT: t("failed"),
        };
        const code = toRegisterErrorCode(body?.code);
        return setError(code ? registerErrorMessages[code] : t("failed"));
      }
      router.push("/login?signup=done");
    } catch {
      setError(t("failed"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <form onSubmit={submit} className="flex w-80 flex-col gap-3" noValidate>
        <label className="flex flex-col gap-1">
          {t("email")}
          <input
            type="email"
            value={form.email}
            onChange={(e) => set("email", e.target.value)}
            onBlur={(e) => check("email", e.target.value, setEmailState)}
            className="rounded border px-2 py-1"
          />
        </label>
        <div aria-live="polite">
          {emailState === "taken" && <p className="text-sm text-red-600">{t("taken")}</p>}
          {emailState === "available" && <p className="text-sm text-green-700">{t("available")}</p>}
        </div>

        <label className="flex flex-col gap-1">
          {t("phone")}
          <input
            type="tel"
            value={form.phone}
            onChange={(e) => set("phone", e.target.value)}
            className="rounded border px-2 py-1"
          />
        </label>

        <label className="flex flex-col gap-1">
          {t("nickname")}
          <input
            value={form.nickname}
            onChange={(e) => set("nickname", e.target.value)}
            onBlur={(e) => check("nickname", e.target.value, setNicknameState)}
            className="rounded border px-2 py-1"
          />
        </label>
        <div aria-live="polite">
          {nicknameState === "taken" && <p className="text-sm text-red-600">{t("taken")}</p>}
          {nicknameState === "available" && <p className="text-sm text-green-700">{t("available")}</p>}
        </div>

        <label className="flex flex-col gap-1">
          {t("password")}
          <input
            type="password"
            value={form.password}
            onChange={(e) => set("password", e.target.value)}
            className="rounded border px-2 py-1"
          />
        </label>

        <label className="flex flex-col gap-1">
          {t("passwordConfirm")}
          <input
            type="password"
            value={form.passwordConfirm}
            onChange={(e) => set("passwordConfirm", e.target.value)}
            className="rounded border px-2 py-1"
          />
        </label>

        <label className="flex items-center gap-2">
          <input type="checkbox" checked={form.consent} onChange={(e) => set("consent", e.target.checked)} />
          {t("consent")}
        </label>

        {error && <p role="alert" className="text-sm text-red-600">{error}</p>}

        <button type="submit" disabled={submitting} className="rounded bg-black px-3 py-2 text-white disabled:opacity-50">
          {t("submitSignup")}
        </button>
      </form>

      <div className="flex w-80 items-center gap-2 text-sm text-zinc-400">
        <span className="h-px flex-1 bg-zinc-200" />
        {t("oauth.or")}
        <span className="h-px flex-1 bg-zinc-200" />
      </div>
      <SocialButtons />
    </>
  );
}
