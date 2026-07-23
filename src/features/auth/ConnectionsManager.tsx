"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";

const PROVIDERS = [
  { slug: "google", name: "GOOGLE" },
  { slug: "kakao", name: "KAKAO" },
  { slug: "naver", name: "NAVER" },
] as const;

const ERROR_KEYS: Record<string, string> = {
  LAST_CREDENTIAL: "lastCredential",
  IDENTITY_TAKEN: "identityTaken",
};

export function ConnectionsManager({
  connected,
  initialError,
}: {
  connected: string[];
  initialError?: string;
}) {
  const t = useTranslations("auth.oauth");
  const router = useRouter();
  const [error, setError] = useState<string | null>(initialError ?? null);

  async function unlink(slug: string) {
    setError(null);
    const res = await fetch(`/api/auth/oauth/${slug}/unlink`, { method: "POST" });
    if (!res.ok) {
      const body = await res.json().catch(() => ({ code: undefined }));
      return setError(t(ERROR_KEYS[body.code] ?? "failed"));
    }
    router.refresh();
  }

  return (
    <div className="flex w-80 flex-col gap-3">
      {PROVIDERS.map((p) => {
        const isConnected = connected.includes(p.name);
        return (
          <div key={p.slug} className="flex items-center justify-between rounded border px-3 py-2">
            {isConnected ? (
              <>
                <span>{t(p.slug)}</span>
                <span className="flex items-center gap-2">
                  <span className="text-xs text-zinc-400">{t("connected")}</span>
                  <button type="button" onClick={() => unlink(p.slug)} className="text-sm text-red-600">
                    {t("unlink")}
                  </button>
                </span>
              </>
            ) : (
              <a href={`/api/auth/oauth/${p.slug}/start?link=1`} className="text-sm text-blue-600">
                {t(p.slug)}
              </a>
            )}
          </div>
        );
      })}
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
    </div>
  );
}
