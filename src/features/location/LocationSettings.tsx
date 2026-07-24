"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";

export function LocationSettings({ initialRegion }: { initialRegion: string | null }) {
  const t = useTranslations("location");
  const router = useRouter();

  const [sido, setSido] = useState("");
  const [sigungu, setSigungu] = useState("");
  const [dong, setDong] = useState("");
  const [region, setRegion] = useState<string | null>(initialRegion);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setSaved(false);
    if (submitting) return;
    setSubmitting(true);
    try {
      const res = await fetch("/api/auth/location", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sido, sigungu, dong }),
      });
      if (!res.ok) return setError(t("failed"));
      // 응답에는 region 문자열만 있고 좌표는 오지 않는다 — 화면엔 절대 좌표를 표시하지 않는다.
      const body = await res.json();
      setRegion(body.region);
      setSaved(true);
      router.refresh();
    } catch {
      setError(t("failed"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex w-80 flex-col gap-4">
      <p>
        {t("currentRegion")}: {region ?? t("notSet")}
      </p>
      <form onSubmit={submit} className="flex flex-col gap-2" noValidate>
        <label className="flex flex-col gap-1">
          {t("sido")}
          <input value={sido} onChange={(e) => setSido(e.target.value)} className="rounded border px-2 py-1" />
        </label>
        <label className="flex flex-col gap-1">
          {t("sigungu")}
          <input value={sigungu} onChange={(e) => setSigungu(e.target.value)} className="rounded border px-2 py-1" />
        </label>
        <label className="flex flex-col gap-1">
          {t("dong")}
          <input value={dong} onChange={(e) => setDong(e.target.value)} className="rounded border px-2 py-1" />
        </label>
        <button
          type="submit"
          disabled={submitting}
          className="rounded bg-black px-3 py-2 text-white disabled:opacity-50"
        >
          {t("save")}
        </button>
      </form>

      {saved && <p>{t("saved")}</p>}

      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}
    </div>
  );
}
