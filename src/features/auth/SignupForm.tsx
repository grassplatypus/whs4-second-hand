"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";

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

  const set = (key: keyof typeof form, value: string | boolean) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  async function check(field: "nickname" | "email", value: string, apply: (s: Availability) => void) {
    if (!value) return apply("unknown");
    apply("checking");
    const res = await fetch(`/api/auth/check-availability?${field}=${encodeURIComponent(value)}`);
    if (!res.ok) return apply("unknown");
    const body = await res.json();
    apply(body.available ? "available" : "taken");
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    if (form.password !== form.passwordConfirm) return setError(t("mismatch"));
    if (!form.consent) return setError(t("needConsent"));

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
  }

  return (
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
      {emailState === "taken" && <p className="text-sm text-red-600">{t("taken")}</p>}
      {emailState === "available" && <p className="text-sm text-green-700">{t("available")}</p>}

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
      {nicknameState === "taken" && <p className="text-sm text-red-600">{t("taken")}</p>}
      {nicknameState === "available" && <p className="text-sm text-green-700">{t("available")}</p>}

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

      <button type="submit" className="rounded bg-black px-3 py-2 text-white">
        {t("submitSignup")}
      </button>
    </form>
  );
}
